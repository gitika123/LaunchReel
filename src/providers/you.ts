import { z } from "zod";
import {
  evidenceItemSchema,
  researchIntentSchema,
  type EvidenceItem,
  type ResearchIntent,
  type ToolCall,
} from "../contracts";
import { ProviderError, request, type Fetcher } from "./http";

const searchResultSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  description: z.string().optional(),
  snippets: z.array(z.string()).optional().default([]),
}).passthrough();

const youSearchResponseSchema = z.object({
  results: z.object({
    web: z.array(searchResultSchema).optional().default([]),
    news: z.array(searchResultSchema).optional().default([]),
  }).passthrough(),
  metadata: z.object({
    search_uuid: z.string().min(1).optional(),
    query: z.string().optional(),
    latency: z.number().nonnegative().optional(),
  }).passthrough().optional().default({}),
}).passthrough();

const researchSearchRequestSchema = z.object({
  intent: researchIntentSchema,
  query: z.string().trim().min(1).max(500),
  count: z.number().int().min(1).max(3),
  freshness: z.enum(["day", "week", "month", "year"]).optional(),
}).strict();

export const YOU_RESEARCH_QUERY_COUNT = 4;
export const YOU_RESULTS_PER_QUERY = 3;

export interface YouSearchClientOptions {
  apiKey: string;
  baseUrl: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

export interface ResearchSearchRequest {
  intent: ResearchIntent;
  query: string;
  count: number;
  freshness?: "day" | "week" | "month" | "year";
}

export interface ResearchSearchResult {
  intent: ResearchIntent;
  items: EvidenceItem[];
  searchId?: string;
  providerLatency?: number;
}

export interface ResearchProvider {
  search(input: ResearchSearchRequest): Promise<ResearchSearchResult>;
}

export interface YouResearchContext {
  targetAudience: string;
  productContext: string;
}

export interface YouResearchResult {
  evidence: EvidenceItem[];
  toolCalls: ToolCall[];
}

const intentLabels: Record<ResearchIntent, string> = {
  audience_pain_points: "Audience pain points",
  category_market_language: "Category and market language",
  competitor_positioning: "Competitor positioning",
  launch_hooks_current_signals: "Launch hooks and current signals",
};

const boundedContext = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 160);

export const createYouResearchQueries = ({ targetAudience, productContext }: YouResearchContext): ResearchSearchRequest[] => {
  const audience = boundedContext(targetAudience);
  const product = boundedContext(productContext);
  return [
    { intent: "audience_pain_points", query: `"${audience}" software workflow pain points`, count: YOU_RESULTS_PER_QUERY },
    { intent: "category_market_language", query: `"${product}" "${audience}" SaaS category market terminology`, count: YOU_RESULTS_PER_QUERY },
    { intent: "competitor_positioning", query: `"${product}" alternatives competitors positioning "${audience}"`, count: YOU_RESULTS_PER_QUERY },
    { intent: "launch_hooks_current_signals", query: `"${product}" SaaS launch messaging trends "${audience}"`, count: YOU_RESULTS_PER_QUERY, freshness: "year" },
  ];
};

export const canonicalResearchUrl = (value: string) => {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
};

const claimWords = (claim: string) => new Set(claim.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2));

export const materiallySimilarClaims = (left: string, right: string) => {
  const leftWords = claimWords(left);
  const rightWords = claimWords(right);
  if (!leftWords.size || !rightWords.size) return left.trim().toLowerCase() === right.trim().toLowerCase();
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size;
  return intersection / union >= 0.8 || intersection / Math.min(leftWords.size, rightWords.size) >= 0.9;
};

export const dedupeResearchEvidence = (items: EvidenceItem[]) => {
  const retained: EvidenceItem[] = [];
  for (const item of items) {
    const duplicateIndex = retained.findIndex((candidate) => canonicalResearchUrl(candidate.sourceUrl) === canonicalResearchUrl(item.sourceUrl)
      || materiallySimilarClaims(candidate.claim, item.claim));
    if (duplicateIndex === -1) {
      retained.push(item);
      continue;
    }
    const duplicate = retained[duplicateIndex];
    retained[duplicateIndex] = evidenceItemSchema.parse({
      ...duplicate,
      researchIntents: [...new Set([...(duplicate.researchIntents ?? []), ...(item.researchIntents ?? [])])],
    });
  }
  return retained;
};

export const runYouResearch = async (provider: ResearchProvider, context: YouResearchContext): Promise<YouResearchResult> => {
  const queries = createYouResearchQueries(context);
  const settled = await Promise.allSettled(queries.map((query) => provider.search(query)));
  const evidence: EvidenceItem[] = [];
  const toolCalls = settled.map((result, index): ToolCall => {
    const query = queries[index];
    const label = intentLabels[query.intent];
    if (result.status === "rejected") {
      return {
        provider: "you",
        operation: `search:${query.intent}`,
        status: "failed",
        summary: `${label} search failed with 0 results`,
        resultCount: 0,
        degradation: "Search unavailable; no cached or generic substitute was used",
      };
    }
    evidence.push(...result.value.items);
    if (!result.value.items.length) {
      return {
        provider: "you",
        operation: `search:${query.intent}`,
        status: "degraded",
        summary: `${label} search returned 0 attributable results`,
        resultCount: 0,
        degradation: "No attributable claim was retained; no substitute evidence was used",
        ...(result.value.searchId ? { searchId: result.value.searchId } : {}),
        ...(result.value.providerLatency !== undefined ? { providerLatency: result.value.providerLatency } : {}),
      };
    }
    return {
      provider: "you",
      operation: `search:${query.intent}`,
      status: "completed",
      summary: `${label} search retained ${result.value.items.length} results`,
      resultCount: result.value.items.length,
      ...(result.value.searchId ? { searchId: result.value.searchId } : {}),
      ...(result.value.providerLatency !== undefined ? { providerLatency: result.value.providerLatency } : {}),
    };
  });
  return { evidence: dedupeResearchEvidence(evidence), toolCalls };
};

export class YouSearchClient implements ResearchProvider {
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(private readonly options: YouSearchClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (!options.apiKey || !options.baseUrl) throw new ProviderError("you", "configuration", false, "You.com is not configured");
  }

  async search(input: ResearchSearchRequest): Promise<ResearchSearchResult> {
    const search = researchSearchRequestSchema.parse(input);
    const url = new URL("/v1/search", this.options.baseUrl);
    url.searchParams.set("query", search.query);
    url.searchParams.set("count", String(search.count));
    if (search.freshness) url.searchParams.set("freshness", search.freshness);
    const response = await request("you", this.fetcher, url, {
      method: "GET",
      headers: { "X-API-Key": this.options.apiKey },
    }, this.timeoutMs);

    try {
      const result = youSearchResponseSchema.parse(await response.json());
      const items = [...result.results.web, ...result.results.news].slice(0, search.count).flatMap((item, index) => {
        const claim = item.description?.trim() || item.snippets.find((snippet) => snippet.trim())?.trim();
        if (!claim) return [];
        return [evidenceItemSchema.parse({
          id: result.metadata.search_uuid
            ? `you-${result.metadata.search_uuid}${index === 0 ? "" : `-${index + 1}`}`
            : `you-${search.intent}-${index + 1}`,
          claim,
          sourceUrl: item.url,
          sourceKind: "external_research",
          ...(item.title?.trim() ? { title: item.title.trim() } : {}),
          researchIntents: [search.intent],
          ...(result.metadata.search_uuid ? { searchId: result.metadata.search_uuid } : {}),
          ...(result.metadata.latency !== undefined ? { providerLatency: result.metadata.latency } : {}),
        })];
      });
      return {
        intent: search.intent,
        items,
        ...(result.metadata.search_uuid ? { searchId: result.metadata.search_uuid } : {}),
        ...(result.metadata.latency !== undefined ? { providerLatency: result.metadata.latency } : {}),
      };
    } catch (error) {
      throw new ProviderError("you", "invalid_response", true, "You.com returned invalid research evidence", { cause: error });
    }
  }
}
