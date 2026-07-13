import { z } from "zod";
import { agentRoleSchema, agentRunSchema, type AgentRole, type AgentRun } from "../contracts";
import { ProviderError, request, type Fetcher } from "./http";

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() }).passthrough(),
    finish_reason: z.string().nullable().optional(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();

export interface AgentPrompt {
  version: string;
  system: string;
  user: string;
}

export type TokenRouterModels = Record<AgentRole, string>;

export interface TokenRouterClientOptions {
  apiKey: string;
  baseUrl: string;
  models: TokenRouterModels;
  fetcher?: Fetcher;
  timeoutMs?: number;
  modelProfile?: string;
  now?: () => Date;
}

const jsonContent = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const parsed = JSON.parse(fenced?.[1] ?? content) as unknown;
  return parsed && typeof parsed === "object" && "artifact" in parsed ? (parsed as { artifact: unknown }).artifact : parsed;
};

export class TokenRouterClient {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly modelProfile: string;
  private readonly now: () => Date;

  constructor(private readonly options: TokenRouterClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.modelProfile = options.modelProfile ?? "demo";
    this.now = options.now ?? (() => new Date());
    if (!options.apiKey || !options.baseUrl) throw new ProviderError("token_router", "configuration", false, "Token Router is not configured");
    agentRoleSchema.options.forEach((role) => {
      if (!options.models[role]) throw new ProviderError("token_router", "configuration", false, `Token Router model is missing for ${role}`);
    });
  }

  async generate<T>(role: AgentRole, prompt: AgentPrompt, artifactSchema: z.ZodType<T>): Promise<{ artifact: T; run: AgentRun }> {
    const startedAt = this.now().toISOString();
    const modelId = this.options.models[role];
    const outputSchema = z.toJSONSchema(artifactSchema);
    const response = await request("token_router", this.fetcher, `${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: `${prompt.system}\nReturn one JSON object matching this exact JSON Schema. Do not add keys outside the schema:\n${JSON.stringify(outputSchema)}` },
          { role: "user", content: prompt.user },
        ],
        response_format: { type: "json_object" },
        temperature: role === "creative_director" ? 0.7 : 0.2,
        max_tokens: 4096,
      }),
    }, this.timeoutMs);

    try {
      const completion = completionSchema.parse(await response.json());
      const artifact = artifactSchema.parse(jsonContent(completion.choices[0]!.message.content));
      return {
        artifact,
        run: agentRunSchema.parse({
          role,
          providerMode: "live",
          validation: "passed",
          modelProfile: this.modelProfile,
          modelId,
          promptVersion: prompt.version,
          startedAt,
          completedAt: this.now().toISOString(),
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
          toolCalls: [{
            provider: "token_router",
            operation: "chat.completions",
            status: "completed",
            summary: `${role} produced a validated Campaign Artifact`,
            startedAt,
            completedAt: this.now().toISOString(),
          }],
        }),
      };
    } catch (error) {
      const detail = error instanceof z.ZodError
        ? error.issues.slice(0, 5).map(({ path, message }) => `${path.join(".") || "artifact"}: ${message}`).join("; ")
        : error instanceof SyntaxError ? "response was not valid JSON" : "completion envelope was invalid";
      throw new ProviderError("token_router", "invalid_response", true, `Token Router returned an invalid Campaign Artifact (${detail})`, { cause: error });
    }
  }
}
