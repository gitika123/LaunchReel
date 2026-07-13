import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const VERIFICATION_NAMESPACE = "launchreel.band-wave1.live-check.v1";
export const REQUIRED_BAND_VARIABLES = [
  "BAND_CHAT_ID",
  "BAND_ANALYST_AGENT_ID",
  "BAND_ANALYST_AGENT_API_KEY",
  "BAND_DIRECTOR_AGENT_ID",
  "BAND_DIRECTOR_AGENT_API_KEY",
] as const;
export const OPTIONAL_BAND_VARIABLES = ["BAND_REST_URL"] as const;

const GOAL_TITLE = `[${VERIFICATION_NAMESPACE}] Verify orchestration`;
const GOAL_SUMMARY = "Bounded verification of one task, one substantive agent handoff, its delivery receipt, and one explicit recipient-to-sender orchestration acknowledgement message.";
const TASK_SUBJECT = `[${VERIFICATION_NAMESPACE}] deterministic orchestration check`;
const TASK_DETAIL = "Verify the documented Band room goal, task lifecycle, agent handoff, receipt, acknowledgement, and append-only history contracts without deleting room history.";
const HANDOFF_MARKER = `[${VERIFICATION_NAMESPACE}:handoff]`;
export const ACKNOWLEDGEMENT_MARKER = `[${VERIFICATION_NAMESPACE}:orchestration-ack]`;
export const ACKNOWLEDGEMENT_LABEL = "LaunchReel orchestration receipt";
const MAX_REQUESTS = 24;
const PAGE_LIMIT = 100;

type JsonRecord = Record<string, unknown>;
type Outcome = "success" | "degraded";

export interface ConfigPresence {
  name: string;
  required: boolean;
  present: boolean;
}

export interface EndpointCheck {
  method: string;
  endpoint: string;
  status?: number;
  outcome: Outcome;
  at: string;
  note?: string;
  returnedId?: string;
}

export interface VerificationReport {
  schemaVersion: 1;
  namespace: string;
  mode: "config-only" | "live";
  outcome: Outcome;
  startedAt: string;
  completedAt: string;
  config: ConfigPresence[];
  endpoints: EndpointCheck[];
  ids: {
    chatId?: string;
    taskId?: string;
    taskNumber?: number;
    handoffMessageId?: string;
    acknowledgementMessageId?: string;
  };
  checks: Record<string, boolean | string | number>;
  notes: string[];
}

type Environment = Record<string, string | undefined>;

export interface BandWave1Options {
  live: boolean;
  environment?: Environment;
  fetcher?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export const parseBandWave1Args = (args: string[]) => {
  const unknown = args.filter((argument) => argument !== "--live");
  const liveCount = args.filter((argument) => argument === "--live").length;
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  if (liveCount > 1) throw new Error("--live may be provided only once");
  return { live: liveCount === 1 };
};

interface LiveConfig {
  baseUrl: string;
  chatId: string;
  analystId: string;
  analystKey: string;
  directorId: string;
  directorKey: string;
}

export interface AgentIdentity {
  id: string;
  name: string;
  handle: string;
}

interface Task {
  id: string;
  number: number;
  subject: string;
  state: "active" | "cancelled" | "superseded" | "archived";
  overall_status: "pending" | "in_progress" | "blocked" | "in_review" | "failed" | "completed";
}

interface Message {
  id: string;
  content: string;
  sender_id: string;
}

class BandRequestError extends Error {
  constructor(
    readonly method: string,
    readonly endpoint: string,
    readonly status: number | undefined,
    readonly code: string,
  ) {
    super(`${method} ${endpoint} failed${status ? ` with HTTP ${status}` : ""} (${code})`);
  }
}

const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const stringField = (value: unknown, field: string) => isRecord(value) && typeof value[field] === "string" ? value[field] as string : undefined;
const numberField = (value: unknown, field: string) => isRecord(value) && typeof value[field] === "number" ? value[field] as number : undefined;
const dataField = (value: unknown) => isRecord(value) ? value.data : undefined;
const dataArray = (value: unknown) => Array.isArray(dataField(value)) ? dataField(value) as unknown[] : [];
const hasMore = (value: unknown) => isRecord(value) && isRecord(value.metadata) && value.metadata.has_more === true;
const safeErrorCode = (value: unknown) => {
  const error = isRecord(value) && isRecord(value.error) ? value.error : undefined;
  return error && typeof error.code === "string" ? error.code : "request_failed";
};

export const inspectBandConfig = (environment: Environment): ConfigPresence[] => [
  ...REQUIRED_BAND_VARIABLES.map((name) => ({ name, required: true, present: Boolean(environment[name]?.trim()) })),
  ...OPTIONAL_BAND_VARIABLES.map((name) => ({ name, required: false, present: Boolean(environment[name]?.trim()) })),
];

const liveConfig = (environment: Environment): LiveConfig => {
  const missing = REQUIRED_BAND_VARIABLES.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) throw new Error(`Live mode requires: ${missing.join(", ")}`);
  const baseUrl = (environment.BAND_REST_URL?.trim() || "https://app.band.ai").replace(/\/$/, "");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
    throw new Error("BAND_REST_URL must use HTTPS (HTTP is allowed only for localhost)");
  }
  return {
    baseUrl,
    chatId: environment.BAND_CHAT_ID!.trim(),
    analystId: environment.BAND_ANALYST_AGENT_ID!.trim(),
    analystKey: environment.BAND_ANALYST_AGENT_API_KEY!.trim(),
    directorId: environment.BAND_DIRECTOR_AGENT_ID!.trim(),
    directorKey: environment.BAND_DIRECTOR_AGENT_API_KEY!.trim(),
  };
};

class BandWave1Adapter {
  private requests = 0;

  constructor(
    private readonly config: LiveConfig,
    private readonly fetcher: typeof fetch,
    private readonly timeoutMs: number,
    private readonly record: (check: EndpointCheck) => void,
    private readonly timestamp: () => string,
  ) {}

  async request(method: string, endpoint: string, apiKey: string, body?: JsonRecord) {
    this.requests += 1;
    if (this.requests > MAX_REQUESTS) throw new BandRequestError(method, endpoint, undefined, "request_budget_exceeded");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.config.baseUrl}${endpoint}`, {
        method,
        headers: {
          "X-API-Key": apiKey,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
      if (!response.ok) {
        const code = safeErrorCode(payload);
        this.record({ method, endpoint, status: response.status, outcome: "degraded", at: this.timestamp(), note: code });
        throw new BandRequestError(method, endpoint, response.status, code);
      }
      this.record({ method, endpoint, status: response.status, outcome: "success", at: this.timestamp() });
      return payload;
    } catch (error) {
      if (error instanceof BandRequestError) throw error;
      const code = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      this.record({ method, endpoint, outcome: "degraded", at: this.timestamp(), note: code });
      throw new BandRequestError(method, endpoint, undefined, code);
    } finally {
      clearTimeout(timer);
    }
  }

  identity(apiKey: string) {
    return this.request("GET", "/api/v1/agent/me", apiKey);
  }

  board(method: "GET" | "PUT", apiKey: string, body?: JsonRecord) {
    return this.request(method, `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/board`, apiKey, body);
  }

  tasks(apiKey: string) {
    return this.request("GET", `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/tasks?state=all&limit=${PAGE_LIMIT}`, apiKey);
  }

  createTask(apiKey: string) {
    return this.request("POST", `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/tasks`, apiKey, { subject: TASK_SUBJECT, detail: TASK_DETAIL });
  }

  task(apiKey: string, taskId: string) {
    return this.request("GET", `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/tasks/${encodeURIComponent(taskId)}`, apiKey);
  }

  updateTask(apiKey: string, taskId: string, body: JsonRecord) {
    return this.request("POST", `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/tasks/${encodeURIComponent(taskId)}`, apiKey, body);
  }

  taskHistory(apiKey: string, taskId: string) {
    return this.request("GET", `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/tasks/${encodeURIComponent(taskId)}/history?limit=${PAGE_LIMIT}`, apiKey);
  }

  context(apiKey: string) {
    return this.request("GET", `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/context?limit=${PAGE_LIMIT}`, apiKey);
  }

  sendMessage(apiKey: string, identity: AgentIdentity, content: string) {
    return this.request("POST", `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/messages`, apiKey, {
      message: { content, mentions: [{ id: identity.id, handle: identity.handle, kind: "mention", name: identity.name }] },
    });
  }

  messages(apiKey: string, status: "processed" | "all") {
    return this.request("GET", `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/messages?status=${status}&limit=${PAGE_LIMIT}`, apiKey);
  }

  messageStatus(apiKey: string, messageId: string, status: "processing" | "processed") {
    return this.request("POST", `/api/v1/agent/chats/${encodeURIComponent(this.config.chatId)}/messages/${encodeURIComponent(messageId)}/${status}`, apiKey);
  }
}

const parseIdentity = (payload: unknown): AgentIdentity => {
  const data = dataField(payload);
  const id = stringField(data, "id");
  const name = stringField(data, "name");
  const handle = stringField(data, "handle");
  if (!id || !name || !handle) throw new Error("Band returned an invalid agent identity response");
  return { id, name, handle };
};

const parseTask = (value: unknown): Task | undefined => {
  const id = stringField(value, "id");
  const number = numberField(value, "number");
  const subject = stringField(value, "subject");
  const state = stringField(value, "state");
  const overallStatus = stringField(value, "overall_status");
  if (!id || number === undefined || !subject || !["active", "cancelled", "superseded", "archived"].includes(state ?? "") || !["pending", "in_progress", "blocked", "in_review", "failed", "completed"].includes(overallStatus ?? "")) return undefined;
  return { id, number, subject, state: state as Task["state"], overall_status: overallStatus as Task["overall_status"] };
};

const parseMessage = (value: unknown): Message | undefined => {
  const id = stringField(value, "id");
  const content = stringField(value, "content");
  const senderId = stringField(value, "sender_id");
  return id && content && senderId ? { id, content, sender_id: senderId } : undefined;
};

const handoffContent = (director: AgentIdentity, task: Task) => [
  `@${director.handle}`,
  HANDOFF_MARKER,
  `Goal: ${GOAL_TITLE}`,
  `Task: #${task.number} ${TASK_SUBJECT}`,
  "Status: orchestration contract verified through the documented task board API.",
  "Evidence: deterministic task lookup, explicit status transitions, and append-only history read.",
  "Requested handoff: send an explicit LaunchReel orchestration receipt after confirming this message was delivered.",
  "Boundary: this verifier does not delete messages or room history.",
].join("\n");

export const buildBandWave1Acknowledgement = (analyst: AgentIdentity, taskNumber: number, handoffMessageId: string) => [
  `@${analyst.handle}`,
  ACKNOWLEDGEMENT_MARKER,
  ACKNOWLEDGEMENT_LABEL,
  `Original handoff receipt: ${handoffMessageId}`,
  `Task: #${taskNumber} ${TASK_SUBJECT}`,
  "Acknowledgement: LaunchReel Creative Director confirmed the original handoff was delivered and records this explicit orchestration receipt for LaunchReel Analyst.",
  "Boundary: this receipt acknowledges orchestration delivery only; it does not claim additional work or delete room history.",
].join("\n");

const addReturnedId = (checks: EndpointCheck[], id: string) => {
  const check = [...checks].reverse().find((candidate) => candidate.method === "POST" && candidate.endpoint.endsWith("/messages"));
  if (check) check.returnedId = id;
};

export const runBandWave1Verification = async (options: BandWave1Options): Promise<VerificationReport> => {
  const environment = options.environment ?? process.env;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const config = inspectBandConfig(environment);
  const report: VerificationReport = {
    schemaVersion: 1,
    namespace: VERIFICATION_NAMESPACE,
    mode: options.live ? "live" : "config-only",
    outcome: "success",
    startedAt,
    completedAt: startedAt,
    config,
    endpoints: [],
    ids: {},
    checks: { explicitLiveOptIn: options.live, networkCalls: 0, credentialsReported: false },
    notes: [],
  };

  if (!options.live) {
    const missing = config.filter((item) => item.required && !item.present).length;
    report.outcome = missing === 0 ? "success" : "degraded";
    report.checks.requiredConfigPresent = missing === 0;
    report.notes.push("Config-only mode inspected variable names and presence; it did not read values or make network calls.");
    report.completedAt = now().toISOString();
    return report;
  }

  const missing = config.filter((item) => item.required && !item.present);
  if (missing.length > 0) {
    report.outcome = "degraded";
    report.checks.requiredConfigPresent = false;
    report.notes.push(`Live mode requires: ${missing.map((item) => item.name).join(", ")}`);
    report.completedAt = now().toISOString();
    return report;
  }

  let cfg: LiveConfig;
  try {
    cfg = liveConfig(environment);
  } catch (error) {
    report.outcome = "degraded";
    report.notes.push(error instanceof Error ? error.message : "Invalid live configuration");
    report.completedAt = now().toISOString();
    return report;
  }
  report.checks.requiredConfigPresent = true;
  report.ids.chatId = cfg.chatId;
  const timestamp = () => now().toISOString();
  const adapter = new BandWave1Adapter(cfg, options.fetcher ?? fetch, options.timeoutMs ?? 10_000, (check) => report.endpoints.push(check), timestamp);

  try {
    const analyst = parseIdentity(await adapter.identity(cfg.analystKey));
    const director = parseIdentity(await adapter.identity(cfg.directorKey));
    if (analyst.id !== cfg.analystId || director.id !== cfg.directorId) throw new Error("Configured Band agent ID does not match the authenticated agent identity");
    report.checks.identitiesVerified = true;

    await adapter.board("PUT", cfg.analystKey, { goal_title: GOAL_TITLE, goal_summary: GOAL_SUMMARY });
    const board = dataField(await adapter.board("GET", cfg.analystKey));
    report.checks.goalVerified = stringField(board, "goal_title") === GOAL_TITLE && stringField(board, "goal_summary") === GOAL_SUMMARY;
    if (!report.checks.goalVerified) throw new Error("Room goal did not match after update");

    const taskListResponse = await adapter.tasks(cfg.analystKey);
    const matchingTasks = dataArray(taskListResponse).map(parseTask).filter((task): task is Task => Boolean(task && task.subject === TASK_SUBJECT));
    if (hasMore(taskListResponse) && matchingTasks.length === 0) throw new Error("Task lookup was truncated; creation was refused to prevent an uncontrolled duplicate");
    if (matchingTasks.length > 1) {
      report.outcome = "degraded";
      report.notes.push("Multiple deterministic tasks already exist; the lowest board number was recovered and no additional task was created.");
    }
    let task: Task;
    const recoveredTask = matchingTasks.sort((a, b) => a.number - b.number)[0];
    if (!recoveredTask) {
      const createdTask = parseTask(dataField(await adapter.createTask(cfg.analystKey)));
      if (!createdTask) throw new Error("Band returned an invalid created task");
      task = createdTask;
      report.checks.taskDisposition = "created";
    } else {
      task = recoveredTask;
      report.checks.taskDisposition = "recovered";
    }
    report.ids.taskId = task.id;
    report.ids.taskNumber = task.number;

    if (task.state === "archived") {
      task = parseTask(dataField(await adapter.updateTask(cfg.analystKey, task.id, { state: "active" }))) ?? task;
    }
    if (task.state !== "active") {
      report.outcome = "degraded";
      report.notes.push(`Recovered task is ${task.state}; the official contract does not permit restoring that lifecycle state.`);
    } else {
      await adapter.updateTask(cfg.analystKey, task.id, { status: "in_progress", active_form: "Verifying the bounded Band Wave 1 orchestration contract", linked_native_id: VERIFICATION_NAMESPACE });
      await adapter.updateTask(cfg.analystKey, task.id, { status: "completed", active_form: "Completed the bounded Band Wave 1 orchestration check", comment: "Deterministic verification completed; handoff delivery and the explicit orchestration acknowledgement receipt are checked separately." });
      report.checks.taskStatusUpdated = true;
    }

    const contextResponse = await adapter.context(cfg.analystKey);
    const contextMessages = dataArray(contextResponse).map(parseMessage).filter((message): message is Message => Boolean(message));
    let handoff = contextMessages.find((message) => message.sender_id === analyst.id && message.content.includes(HANDOFF_MARKER));
    if (!handoff && hasMore(contextResponse)) throw new Error("Handoff lookup was truncated; send was refused to prevent an uncontrolled duplicate");
    if (!handoff) {
      const sent = dataField(await adapter.sendMessage(cfg.analystKey, director, handoffContent(director, task)));
      const id = stringField(sent, "id");
      if (!id) throw new Error("Band did not return a handoff message receipt ID");
      handoff = { id, content: handoffContent(director, task), sender_id: analyst.id };
      addReturnedId(report.endpoints, id);
      report.checks.handoffDisposition = "created";
    } else {
      report.checks.handoffDisposition = "recovered";
    }
    report.ids.handoffMessageId = handoff.id;
    report.checks.receiptCaptured = true;

    let deliveryConfirmed = false;
    const processedResponse = await adapter.messages(cfg.directorKey, "processed");
    const alreadyProcessed = dataArray(processedResponse).map(parseMessage).filter((message): message is Message => Boolean(message)).some((message) => message.id === handoff!.id && message.sender_id === analyst.id);
    if (alreadyProcessed) {
      deliveryConfirmed = true;
      report.checks.deliveryLifecycleDisposition = "recovered";
    } else {
      if (hasMore(processedResponse)) throw new Error("Processed-message lookup was truncated; another delivery lifecycle update was refused");
      const recipientResponse = await adapter.messages(cfg.directorKey, "all");
      const recipientMessages = dataArray(recipientResponse).map(parseMessage).filter((message): message is Message => Boolean(message));
      const delivered = recipientMessages.find((message) => message.id === handoff!.id && message.sender_id === analyst.id);
      if (!delivered) {
        report.outcome = "degraded";
        report.notes.push("The original handoff receipt was not present in the recipient's bounded message-history read; no acknowledgement message was invented.");
      } else {
        const processing = dataField(await adapter.messageStatus(cfg.directorKey, delivered.id, "processing"));
        const processed = dataField(await adapter.messageStatus(cfg.directorKey, delivered.id, "processed"));
        deliveryConfirmed = stringField(processing, "status") === "processing" && stringField(processed, "status") === "processed";
        report.checks.deliveryLifecycleDisposition = "created";
      }
    }
    report.checks.originalDeliveryConfirmed = deliveryConfirmed;

    if (deliveryConfirmed) {
      const acknowledgementContent = buildBandWave1Acknowledgement(analyst, task.number, handoff.id);
      const directorContextResponse = await adapter.context(cfg.directorKey);
      const acknowledgements = dataArray(directorContextResponse)
        .map(parseMessage)
        .filter((message): message is Message => Boolean(message && message.sender_id === director.id && message.content.includes(ACKNOWLEDGEMENT_MARKER) && message.content.includes(`Original handoff receipt: ${handoff.id}`)));
      if (acknowledgements.length > 1) {
        report.outcome = "degraded";
        report.notes.push("Multiple deterministic orchestration acknowledgements already exist; the earliest receipt was recovered and no additional message was sent.");
      }
      let acknowledgement = acknowledgements[0];
      if (!acknowledgement && hasMore(directorContextResponse)) throw new Error("Acknowledgement lookup was truncated; send was refused to prevent an uncontrolled duplicate");
      if (!acknowledgement) {
        const sent = dataField(await adapter.sendMessage(cfg.directorKey, analyst, acknowledgementContent));
        const id = stringField(sent, "id");
        if (!id) throw new Error("Band did not return an orchestration acknowledgement receipt ID");
        acknowledgement = { id, content: acknowledgementContent, sender_id: director.id };
        addReturnedId(report.endpoints, id);
        report.checks.acknowledgementDisposition = "created";
      } else {
        report.checks.acknowledgementDisposition = "recovered";
      }
      report.ids.acknowledgementMessageId = acknowledgement.id;
      report.checks.orchestrationAcknowledged = true;
    } else {
      report.checks.orchestrationAcknowledged = false;
    }

    const readTask = parseTask(dataField(await adapter.task(cfg.analystKey, task.id)));
    const history = dataArray(await adapter.taskHistory(cfg.analystKey, task.id));
    report.checks.taskRead = Boolean(readTask);
    report.checks.taskHistoryRead = history.length > 0;
    report.checks.roomContextRead = contextMessages.length >= 0;

    if (task.state === "active") {
      await adapter.updateTask(cfg.analystKey, task.id, { state: "archived" });
      report.checks.taskArchived = true;
    } else {
      report.checks.taskArchived = false;
    }
  } catch (error) {
    report.outcome = "degraded";
    report.notes.push(error instanceof BandRequestError ? error.message : error instanceof Error ? error.message : "Unknown verification failure");
  }

  report.checks.networkCalls = report.endpoints.length;
  report.completedAt = now().toISOString();
  return report;
};

const markdownReport = (report: VerificationReport) => {
  const configRows = report.config.map((item) => `| \`${item.name}\` | ${item.required ? "required" : "optional"} | ${item.present ? "present" : "missing"} |`).join("\n");
  const endpointRows = report.endpoints.map((item) => `| ${item.at} | ${item.method} | \`${item.endpoint}\` | ${item.status ?? "n/a"} | ${item.outcome} | ${item.returnedId ?? item.note ?? ""} |`).join("\n");
  return `# Band Wave 1 verification\n\n- Namespace: \`${report.namespace}\`\n- Mode: **${report.mode}**\n- Outcome: **${report.outcome}**\n- Started: ${report.startedAt}\n- Completed: ${report.completedAt}\n\n## Configuration presence\n\n| Variable | Requirement | Presence |\n|---|---|---|\n${configRows}\n\n## Endpoint checks\n\n| Timestamp | Method | Endpoint | HTTP | Outcome | Nonsecret receipt / note |\n|---|---|---|---|---|---|\n${endpointRows || "| — | — | — | — | — | No network calls |"}\n\n## Checks\n\n\`\`\`json\n${JSON.stringify(report.checks, null, 2)}\n\`\`\`\n\n## Nonsecret returned IDs\n\n\`\`\`json\n${JSON.stringify(report.ids, null, 2)}\n\`\`\`\n\n## Notes\n\n${report.notes.map((note) => `- ${note}`).join("\n") || "- None"}\n`;
};

export const writeBandWave1Report = async (report: VerificationReport, outputRoot = resolve("output", "band-wave1-verification")) => {
  await mkdir(outputRoot, { recursive: true });
  const suffix = report.mode === "live" ? "live" : "config-only";
  const jsonPath = resolve(outputRoot, `latest-${suffix}.json`);
  const markdownPath = resolve(outputRoot, `latest-${suffix}.md`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, markdownReport(report), "utf8"),
  ]);
  return { jsonPath, markdownPath };
};
