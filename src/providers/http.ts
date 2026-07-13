export type ProviderName = "token_router" | "you" | "deepgram" | "lyria" | "band" | "source_website" | "remotion" | "filesystem";
export type ProviderErrorCode = "configuration" | "authentication" | "rate_limit" | "timeout" | "invalid_response" | "unavailable";

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const request = async (
  provider: ProviderName,
  fetcher: Fetcher,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(input, { ...init, signal: controller.signal });
    if (response.ok) return response;
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(provider, "authentication", false, `${provider} authentication failed`);
    }
    if (response.status === 429) {
      throw new ProviderError(provider, "rate_limit", true, `${provider} rate limit exceeded`);
    }
    throw new ProviderError(provider, "unavailable", response.status >= 500, `${provider} request failed with HTTP ${response.status}`);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) throw new ProviderError(provider, "timeout", true, `${provider} request timed out`, { cause: error });
    throw new ProviderError(provider, "unavailable", true, `${provider} request failed`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
};
