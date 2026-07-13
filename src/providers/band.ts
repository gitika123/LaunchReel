import { z } from "zod";
import {
  agentRoleSchema,
  collaborationPayloadSchema,
  bandTaskAssignmentStatusSchema,
  type AgentRole,
  type BandCampaignTask,
  type BandCampaignTaskKey,
  type BandTaskAssignmentStatus,
  type CollaborationPayload,
} from "../contracts";
import type { BandTaskIdentity, BandTaskProvider } from "../band-tasks";
import { ProviderError, request, type Fetcher } from "./http";

const bandTaskSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive().optional(),
  subject: z.string().min(1),
  detail: z.string(),
  assignments: z.array(z.object({
    assignee: z.object({ id: z.string().min(1) }).passthrough(),
    status: bandTaskAssignmentStatusSchema,
  }).passthrough()).default([]),
}).passthrough();

const bandTaskResponseSchema = z.object({ data: bandTaskSchema }).passthrough();
const bandTaskListResponseSchema = z.object({
  data: z.array(bandTaskSchema),
  metadata: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable() }).passthrough().optional(),
}).passthrough();

const bandResponseSchema = z.object({
  data: z.object({
    success: z.literal(true),
    id: z.string().min(1).optional(),
  }).passthrough(),
}).passthrough();

// Band's production-control API is beta. Keep its assumptions together so a
// documented schema change fails at this boundary instead of leaking drift.
const bandIdSchema = z.string().uuid();
const bandTimestampSchema = z.iso.datetime({ offset: true });
const taskActorSchema = z.object({
  id: bandIdSchema,
  name: z.string(),
  type: z.enum(["User", "Agent"]),
  handle: z.string().nullable().optional(),
}).passthrough();
const taskStatusSchema = z.enum(["pending", "in_progress", "blocked", "in_review", "failed", "completed"]);
const taskStateSchema = z.enum(["active", "cancelled", "superseded", "archived"]);
const taskEventSchema = z.object({
  actor: taskActorSchema,
  at: bandTimestampSchema,
  event: z.enum(["created", "edited", "status_changed", "commented", "dropped", "cancelled", "superseded", "archived", "unarchived"]),
  payload: z.object({}).passthrough(),
}).passthrough();
const boardEventSchema = z.object({
  actor: taskActorSchema,
  at: bandTimestampSchema,
  event: z.enum(["goal_set", "goal_edited"]),
  payload: z.object({}).passthrough(),
}).passthrough();
const taskAssignmentSchema = z.object({
  active_form: z.string(),
  assignee: taskActorSchema,
  linked_native_id: z.string(),
  status: taskStatusSchema,
  updated_at: bandTimestampSchema,
}).passthrough();
const taskSchema = z.object({
  assignments: z.array(taskAssignmentSchema),
  chat_room_id: bandIdSchema,
  created_by: taskActorSchema,
  detail: z.string(),
  id: bandIdSchema,
  inserted_at: bandTimestampSchema,
  number: z.number().int(),
  overall_status: taskStatusSchema,
  state: taskStateSchema,
  subject: z.string(),
  superseded_by_id: bandIdSchema.nullable(),
  updated_at: bandTimestampSchema,
  history: z.array(taskEventSchema).optional(),
  history_truncated: z.boolean().optional(),
}).passthrough();
const boardSchema = z.object({
  chat_room_id: bandIdSchema,
  created_by: taskActorSchema.nullable(),
  goal_summary: z.string().nullable(),
  goal_title: z.string().nullable(),
  inserted_at: bandTimestampSchema.nullable(),
  updated_at: bandTimestampSchema.nullable(),
  updated_by: taskActorSchema.nullable(),
  history: z.array(boardEventSchema).optional(),
  history_truncated: z.boolean().optional(),
}).passthrough();
const paginationSchema = z.object({
  has_more: z.boolean(),
  limit: z.number().int(),
  next_cursor: z.string().nullable(),
}).passthrough();
const boardResponseSchema = z.object({ data: boardSchema }).passthrough();
const taskResponseSchema = z.object({ data: taskSchema }).passthrough();
const taskListResponseSchema = z.object({ data: z.array(taskSchema), metadata: paginationSchema }).passthrough();
const taskHistoryResponseSchema = z.object({ data: z.array(taskEventSchema), metadata: paginationSchema }).passthrough();

const boardGoalInputSchema = z.object({
  goal_title: z.string().optional(),
  goal_summary: z.string().optional(),
}).strict().refine((value) => value.goal_title !== undefined || value.goal_summary !== undefined, "At least one goal field is required");
const createTaskInputSchema = z.object({
  subject: z.string().min(1),
  detail: z.string().optional(),
  supersedes_id: z.string().min(1).optional(),
}).strict();
const updateTaskInputSchema = z.object({
  active_form: z.string().optional(),
  comment: z.string().optional(),
  detail: z.string().optional(),
  linked_native_id: z.string().optional(),
  state: z.enum(["cancelled", "archived", "active"]).optional(),
  status: taskStatusSchema.optional(),
  subject: z.string().optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), "At least one task update field is required");
const listTasksInputSchema = z.object({
  state: z.enum(["active", "cancelled", "superseded", "archived", "all"]).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();
const pageInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

export type BandBoard = z.infer<typeof boardSchema>;
export type BandTask = z.infer<typeof taskSchema>;
export type BandTaskEvent = z.infer<typeof taskEventSchema>;
export type BandPageMetadata = z.infer<typeof paginationSchema>;
export type BandBoardGoalInput = z.input<typeof boardGoalInputSchema>;
export type BandCreateTaskInput = z.input<typeof createTaskInputSchema>;
export type BandUpdateTaskInput = z.input<typeof updateTaskInputSchema>;
export type BandListTasksInput = z.input<typeof listTasksInputSchema>;
export type BandPageInput = z.input<typeof pageInputSchema>;

export interface BandProductionControl {
  getRoomGoal(options?: { includeHistory?: boolean }): Promise<BandBoard>;
  setRoomGoal(input: BandBoardGoalInput): Promise<BandBoard>;
  listTasks(input?: BandListTasksInput): Promise<{ tasks: BandTask[]; metadata: BandPageMetadata }>;
  createTask(input: BandCreateTaskInput): Promise<BandTask>;
  getTask(taskId: string, options?: { includeHistory?: boolean }): Promise<BandTask>;
  updateTask(taskId: string, input: BandUpdateTaskInput): Promise<BandTask>;
  getTaskHistory(taskId: string, input?: BandPageInput): Promise<{ events: BandTaskEvent[]; metadata: BandPageMetadata }>;
}

export interface BandProductionControlOptions {
  apiKey: string;
  chatId: string;
  baseUrl?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

export type BandProductionControlConfiguration =
  | { capability: "production_control"; status: "configured"; provider: BandProductionControlClient }
  | { capability: "production_control"; status: "unsupported"; reason: string }
  | { capability: "production_control"; status: "degraded"; reason: string };

export class BandProductionControlClient implements BandProductionControl {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly chatPath: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(options: BandProductionControlOptions) {
    if (!options.apiKey || !options.chatId) throw new ProviderError("band", "configuration", false, "Band production control is not configured");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://app.band.ai").replace(/\/$/, "");
    this.chatPath = `/api/v1/agent/chats/${encodeURIComponent(options.chatId)}`;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async getRoomGoal(options: { includeHistory?: boolean } = {}) {
    const query = options.includeHistory ? "?include=history" : "";
    return (await this.call(`${this.chatPath}/board${query}`, { method: "GET" }, boardResponseSchema, "room goal")).data;
  }

  async setRoomGoal(input: BandBoardGoalInput) {
    const goal = boardGoalInputSchema.parse(input);
    return (await this.call(`${this.chatPath}/board`, this.jsonRequest("PUT", goal), boardResponseSchema, "room goal update")).data;
  }

  async listTasks(input: BandListTasksInput = {}) {
    const filters = listTasksInputSchema.parse(input);
    const query = new URLSearchParams();
    if (filters.state) query.set("state", filters.state);
    if (filters.cursor) query.set("cursor", filters.cursor);
    if (filters.limit !== undefined) query.set("limit", String(filters.limit));
    const result = await this.call(`${this.chatPath}/tasks${query.size ? `?${query}` : ""}`, { method: "GET" }, taskListResponseSchema, "task list");
    return { tasks: result.data, metadata: result.metadata };
  }

  async createTask(input: BandCreateTaskInput) {
    const task = createTaskInputSchema.parse(input);
    return (await this.call(`${this.chatPath}/tasks`, this.jsonRequest("POST", task), taskResponseSchema, "task creation")).data;
  }

  async getTask(taskId: string, options: { includeHistory?: boolean } = {}) {
    const path = this.taskPath(taskId);
    const query = options.includeHistory ? "?include=history" : "";
    return (await this.call(`${path}${query}`, { method: "GET" }, taskResponseSchema, "task read")).data;
  }

  async updateTask(taskId: string, input: BandUpdateTaskInput) {
    const update = updateTaskInputSchema.parse(input);
    return (await this.call(this.taskPath(taskId), this.jsonRequest("POST", update), taskResponseSchema, "task update")).data;
  }

  async getTaskHistory(taskId: string, input: BandPageInput = {}) {
    const page = pageInputSchema.parse(input);
    const query = new URLSearchParams();
    if (page.cursor) query.set("cursor", page.cursor);
    if (page.limit !== undefined) query.set("limit", String(page.limit));
    const result = await this.call(`${this.taskPath(taskId)}/history${query.size ? `?${query}` : ""}`, { method: "GET" }, taskHistoryResponseSchema, "task history");
    return { events: result.data, metadata: result.metadata };
  }

  private taskPath(taskId: string) {
    const id = z.string().trim().min(1).parse(taskId);
    return `${this.chatPath}/tasks/${encodeURIComponent(id)}`;
  }

  private jsonRequest(method: "POST" | "PUT", body: unknown): RequestInit {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  }

  private async call<T>(path: string, init: RequestInit, schema: z.ZodType<T>, operation: string): Promise<T> {
    const response = await request("band", this.fetcher, `${this.baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, "X-API-Key": this.apiKey },
    }, this.timeoutMs);
    try {
      return schema.parse(await response.json());
    } catch (error) {
      throw new ProviderError("band", "invalid_response", true, `Band beta API returned an invalid ${operation} response; retry after checking the current Band contract`, { cause: error });
    }
  }
}

export const configureBandProductionControl = (
  environment: NodeJS.ProcessEnv,
  options: Pick<BandProductionControlOptions, "fetcher" | "timeoutMs"> = {},
): BandProductionControlConfiguration => {
  const apiKey = environment.BAND_PRODUCTION_AGENT_API_KEY;
  const chatId = environment.BAND_CHAT_ID;
  if (!apiKey && !chatId) return { capability: "production_control", status: "unsupported", reason: "Band production control is not configured" };
  if (!apiKey || !chatId) return { capability: "production_control", status: "degraded", reason: "Band production control requires BAND_PRODUCTION_AGENT_API_KEY and BAND_CHAT_ID" };
  return {
    capability: "production_control",
    status: "configured",
    provider: new BandProductionControlClient({
      ...options,
      apiKey,
      chatId,
      baseUrl: environment.BAND_REST_URL ?? "https://app.band.ai",
    }),
  };
};

export interface BandAgentCredentials {
  id: string;
  apiKey: string;
  name: string;
}

export type BandAgents = Record<AgentRole, BandAgentCredentials>;

export interface BandCollaborationMirrorOptions {
  baseUrl: string;
  chatId: string;
  agents: BandAgents;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

export interface BandMirrorReceipt {
  resource: "message" | "event";
  originalResponseId?: string;
  acknowledgmentState?: "completed" | "degraded";
  acknowledgmentResponseId?: string;
}

const labels: Record<AgentRole, string> = {
  brand_market_analyst: "LaunchReel Analyst",
  creative_director: "LaunchReel Creative Director",
  video_producer: "LaunchReel Video Producer",
  creative_critic: "LaunchReel Creative Critic",
};

const artifactLabels: Record<CollaborationPayload["artifactType"], string> = {
  source_profile: "Source Profile",
  brand_market_brief: "BrandMarketBrief",
  concept_set: "CreativeConceptSet",
  concept_approval: "Concept Approval",
  storyboard: "Storyboard",
  storyboard_approval: "Storyboard Approval",
  render_manifest: "RenderManifest",
  critic_report: "CriticReport",
  package_manifest: "PackageManifest",
  correction_request: "Targeted Correction Request",
  correction_authorization: "Correction Rerender Authorization",
};

const participantLabel = (participant: CollaborationPayload["sender"] | CollaborationPayload["recipient"]) => participant === "human" ? "Human Approver" : labels[participant];

const payloadContent = (payload: CollaborationPayload) => [
  `Campaign ID: ${payload.campaignId}`,
  `Campaign type: ${payload.campaignType}`,
  `Duration: ${payload.durationSeconds} seconds`,
  `Provider mode: ${payload.providerMode}`,
  `Sender: ${participantLabel(payload.sender)}`,
  `Recipient: ${participantLabel(payload.recipient)}`,
  `Artifact: ${artifactLabels[payload.artifactType]}`,
  `Summary: ${payload.summary}`,
  ...(payload.counts ? [`Counts: ${Object.entries(payload.counts).map(([key, value]) => `${key}=${value}`).join(", ")}`] : []),
  ...(payload.approval ? [`Approval: ${payload.approval}`] : []),
].join("\n");

const acknowledgmentContent = (payload: CollaborationPayload) => [
  "LaunchReel orchestration receipt",
  "Automated delivery acknowledgment; no LLM reasoning or artifact review performed.",
  `Campaign ID: ${payload.campaignId}`,
  `Artifact: ${artifactLabels[payload.artifactType]}`,
  `Sender: ${participantLabel(payload.recipient)}`,
  `Recipient: ${participantLabel(payload.sender)}`,
].join("\n");

export class BandCollaborationMirror {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(private readonly options: BandCollaborationMirrorOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!options.baseUrl || !options.chatId) throw new ProviderError("band", "configuration", false, "Band is not configured");
    agentRoleSchema.options.forEach((role) => {
      if (!options.agents[role]?.id || !options.agents[role]?.apiKey) {
        throw new ProviderError("band", "configuration", false, `Band credentials are missing for ${role}`);
      }
    });
  }

  async mirror(input: CollaborationPayload): Promise<BandMirrorReceipt> {
    const payload = collaborationPayloadSchema.parse(input);
    const content = payloadContent(payload);
    if (payload.sender !== "human" && payload.recipient !== "human") {
      const sender = this.options.agents[payload.sender];
      const recipient = this.options.agents[payload.recipient];
      const originalResponseId = await this.post(sender.apiKey, "messages", {
        message: {
          content: `@${recipient.name}\n${content}`,
          mentions: [{ id: recipient.id, kind: "mention", name: recipient.name }],
        },
      });
      try {
        const acknowledgmentResponseId = await this.acknowledge(payload);
        return {
          resource: "message",
          ...(originalResponseId ? { originalResponseId } : {}),
          acknowledgmentState: "completed",
          ...(acknowledgmentResponseId ? { acknowledgmentResponseId } : {}),
        };
      } catch {
        return { resource: "message", ...(originalResponseId ? { originalResponseId } : {}), acknowledgmentState: "degraded" };
      }
    }

    const agentRole = payload.sender === "human" ? payload.recipient : payload.sender;
    if (agentRole === "human") throw new ProviderError("band", "invalid_response", false, "A Band collaboration event requires an Agent participant");
    const agent = this.options.agents[agentRole];
    const originalResponseId = await this.post(agent.apiKey, "events", {
      event: {
        content,
        message_type: "attention",
        metadata: { kind: "review", blocking: true },
      },
    });
    return { resource: "event", ...(originalResponseId ? { originalResponseId } : {}) };
  }

  async acknowledge(input: CollaborationPayload) {
    const payload = collaborationPayloadSchema.parse(input);
    if (payload.sender === "human" || payload.recipient === "human") {
      throw new ProviderError("band", "invalid_response", false, "Only Agent-to-Agent Handoffs receive orchestration acknowledgments");
    }
    const sender = this.options.agents[payload.sender];
    const recipient = this.options.agents[payload.recipient];
    return this.post(recipient.apiKey, "messages", {
      message: {
        content: `@${sender.name}\n${acknowledgmentContent(payload)}`,
        mentions: [{ id: sender.id, kind: "mention", name: sender.name }],
      },
    });
  }

  private async post(apiKey: string, resource: "messages" | "events", body: unknown) {
    const response = await request("band", this.fetcher, `${this.options.baseUrl.replace(/\/$/, "")}/api/v1/agent/chats/${encodeURIComponent(this.options.chatId)}/${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
    }, this.timeoutMs);
    try {
      const parsed = bandResponseSchema.parse(await response.json());
      return parsed.data.id;
    } catch (error) {
      throw new ProviderError("band", "invalid_response", true, "Band returned an invalid collaboration response", { cause: error });
    }
  }
}

const taskMarker = (campaignId: string, key: BandCampaignTaskKey) => `launchreel:${campaignId}:${key}`;

export class BandTaskBoard implements BandTaskProvider {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(private readonly options: BandCollaborationMirrorOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async syncGoal(goal: { title: string; summary: string }) {
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/api/v1/agent/chats/${encodeURIComponent(this.options.chatId)}/board`;
    const apiKey = this.options.agents.brand_market_analyst.apiKey;
    const current = await request("band", this.fetcher, url, { method: "GET", headers: { "X-API-Key": apiKey } }, this.timeoutMs);
    const board = boardResponseSchema.parse(await current.json()).data;
    if (board.goal_title === goal.title && board.goal_summary === goal.summary) return;
    const updated = await request("band", this.fetcher, url, {
      method: "PUT",
      headers: { "content-type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ goal_title: goal.title, goal_summary: goal.summary }),
    }, this.timeoutMs);
    boardResponseSchema.parse(await updated.json());
  }

  async findTask(campaignId: string, key: BandCampaignTaskKey, owner: AgentRole): Promise<BandTaskIdentity | undefined> {
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ state: "all", limit: "100", ...(cursor ? { cursor } : {}) });
      const response = await request("band", this.fetcher, `${this.taskUrl()}?${query}`, {
        headers: { "X-API-Key": this.options.agents[owner].apiKey },
      }, this.timeoutMs);
      const parsed = bandTaskListResponseSchema.parse(await response.json());
      const task = parsed.data.find(({ detail }) => detail.includes(taskMarker(campaignId, key)));
      if (task) return this.identity(task, owner);
      cursor = parsed.metadata?.has_more ? parsed.metadata.next_cursor ?? undefined : undefined;
    } while (cursor);
    return undefined;
  }

  async createTask(task: BandCampaignTask, owner: AgentRole) {
    const response = await request("band", this.fetcher, this.taskUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": this.options.agents[owner].apiKey },
      body: JSON.stringify({ subject: task.label, detail: `${taskMarker(task.campaignId, task.key)}\nLocal stage: ${task.stage}; local owner: ${task.owner.kind === "agent" ? task.owner.role : task.owner.assignment}.` }),
    }, this.timeoutMs);
    return this.identity(bandTaskResponseSchema.parse(await response.json()).data, owner);
  }

  async updateTask(task: BandCampaignTask, identity: BandTaskIdentity, owner: AgentRole, status: BandTaskAssignmentStatus) {
    const response = await request("band", this.fetcher, `${this.taskUrl()}/${encodeURIComponent(identity.id)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": this.options.agents[owner].apiKey },
      body: JSON.stringify({ status, linked_native_id: taskMarker(task.campaignId, task.key), active_form: status === "in_progress" ? `Working on ${task.label}` : "" }),
    }, this.timeoutMs);
    return this.identity(bandTaskResponseSchema.parse(await response.json()).data, owner);
  }

  private taskUrl() {
    return `${this.options.baseUrl.replace(/\/$/, "")}/api/v1/agent/chats/${encodeURIComponent(this.options.chatId)}/tasks`;
  }

  private identity(task: z.infer<typeof bandTaskSchema>, owner: AgentRole): BandTaskIdentity {
    const assignmentStatus = task.assignments.find(({ assignee }) => assignee.id === this.options.agents[owner].id)?.status;
    return { id: task.id, ...(task.number ? { number: task.number } : {}), ...(assignmentStatus ? { assignmentStatus } : {}) };
  }
}

const credential = (environment: NodeJS.ProcessEnv, role: AgentRole, prefix: string): BandAgentCredentials => {
  const id = environment[`BAND_${prefix}_AGENT_ID`];
  const apiKey = environment[`BAND_${prefix}_AGENT_API_KEY`];
  if (!id || !apiKey) throw new ProviderError("band", "configuration", false, `Band credentials are missing for ${role}`);
  return { id, apiKey, name: labels[role] };
};

const optionsFromEnvironment = (environment: NodeJS.ProcessEnv): BandCollaborationMirrorOptions => ({
  baseUrl: environment.BAND_REST_URL ?? "https://app.band.ai",
  chatId: environment.BAND_CHAT_ID ?? "",
  agents: {
    brand_market_analyst: credential(environment, "brand_market_analyst", "ANALYST"),
    creative_director: credential(environment, "creative_director", "DIRECTOR"),
    video_producer: credential(environment, "video_producer", "PRODUCER"),
    creative_critic: credential(environment, "creative_critic", "CRITIC"),
  },
});

export const bandMirrorFromEnvironment = (environment: NodeJS.ProcessEnv) => new BandCollaborationMirror(optionsFromEnvironment(environment));
export const bandTaskBoardFromEnvironment = (environment: NodeJS.ProcessEnv) => new BandTaskBoard(optionsFromEnvironment(environment));

export const validBandRoomUrl = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const privateHostname = hostname === "localhost" || hostname.endsWith(".localhost") || /^(0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) || hostname === "::1" || /^(fc|fd|fe80):/i.test(hostname);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || privateHostname) return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:api[-_]?key|auth|credential|password|secret|signature|token)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return undefined;
  }
};
