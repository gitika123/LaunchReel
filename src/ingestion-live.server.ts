import type { LookupAddress, LookupAllOptions } from "node:dns";
import { lookup as nodeLookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type {
  DnsResolver,
  IngestionDependencies,
  PageLoader,
  PageLoadRequest,
  PageLoadResponse,
} from "./ingestion";

export type LiveDnsLookup = (
  hostname: string,
  options: LookupAllOptions,
) => Promise<readonly LookupAddress[]>;

export interface LiveSourceWebsiteIngestionAdapterOptions {
  dnsLookup?: LiveDnsLookup;
}

export type LivePageLoadErrorCode =
  | "invalid_request"
  | "response_aborted"
  | "response_too_large";

export class LivePageLoadError extends Error {
  constructor(
    readonly code: LivePageLoadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LivePageLoadError";
  }
}

const defaultDnsLookup: LiveDnsLookup = (hostname, options) => nodeLookup(hostname, options);

export class NodeDnsResolver implements DnsResolver {
  constructor(private readonly dnsLookup: LiveDnsLookup = defaultDnsLookup) {}

  async resolve(hostname: string): Promise<string[]> {
    const results = await this.dnsLookup(hostname, { all: true, verbatim: true });
    return [...new Set(results.map(({ address }) => address))];
  }
}

const invalidRequest = (message: string, options?: ErrorOptions) =>
  new LivePageLoadError("invalid_request", message, options);

const responseAborted = (url: string, options?: ErrorOptions) =>
  new LivePageLoadError("response_aborted", `Response from ${url} ended before it was complete`, options);

const abortError = (signal: AbortSignal) => {
  if (signal.reason instanceof Error && signal.reason.name === "AbortError") return signal.reason;
  const error = new Error("Page load aborted", { cause: signal.reason });
  error.name = "AbortError";
  return error;
};

const normalizeHostname = (hostname: string) => hostname.replace(/^\[|\]$/g, "");

const familyNumber = (family: LookupAllOptions["family"]) => {
  if (family === 4 || family === "IPv4") return 4;
  if (family === 6 || family === "IPv6") return 6;
  return 0;
};

const pinnedLookup = (expectedHostname: string, suppliedAddresses: readonly string[]): LookupFunction => {
  const addresses = [...new Set(suppliedAddresses)].map((address) => {
    const family = isIP(address);
    if (family !== 4 && family !== 6) throw invalidRequest(`Pinned address ${address} is not a valid IP address`);
    return { address, family };
  });
  if (addresses.length === 0) throw invalidRequest("At least one pinned address is required");

  return (hostname, options, callback) => {
    queueMicrotask(() => {
      if (normalizeHostname(hostname).toLowerCase() !== expectedHostname.toLowerCase()) {
        const error = Object.assign(
          new Error(`Refused to resolve unexpected hostname ${hostname}`),
          { code: "ENOTFOUND" },
        );
        callback(error, "");
        return;
      }

      const requestedFamily = familyNumber(options.family);
      const matches = requestedFamily === 0
        ? addresses
        : addresses.filter(({ family }) => family === requestedFamily);
      if (matches.length === 0) {
        const error = Object.assign(
          new Error(`No pinned address is available for IPv${requestedFamily}`),
          { code: "ENOTFOUND" },
        );
        callback(error, "");
        return;
      }

      if (options.all) {
        callback(null, matches);
      } else {
        callback(null, matches[0].address, matches[0].family);
      }
    });
  };
};

const normalizeHeaders = (headers: http.IncomingHttpHeaders): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) normalized[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return normalized;
};

const parseRequestUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw invalidRequest("Page URL must be valid", { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidRequest("Page URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) throw invalidRequest("Page URL must not contain credentials");
  return url;
};

const validateByteLimit = (maxResponseBytes: number) => {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
    throw invalidRequest("maxResponseBytes must be a non-negative safe integer");
  }
};

export class NodePageLoader implements PageLoader {
  async load(request: PageLoadRequest): Promise<PageLoadResponse> {
    const url = parseRequestUrl(request.url);
    validateByteLimit(request.maxResponseBytes);
    if (request.signal.aborted) throw abortError(request.signal);

    const hostname = normalizeHostname(url.hostname);
    const lookup = pinnedLookup(hostname, request.addresses);
    const options: https.RequestOptions = {
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { host: url.host },
      lookup,
      signal: request.signal,
      agent: false,
      ...(url.protocol === "https:" && isIP(hostname) === 0 ? { servername: hostname } : {}),
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const succeed = (response: PageLoadResponse) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };
      const onResponse = (response: http.IncomingMessage) => {
        if (response.statusCode === undefined) {
          const error = responseAborted(url.href);
          fail(error);
          response.destroy(error);
          return;
        }

        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;
        response.on("data", (chunk: Buffer | Uint8Array | string) => {
          if (settled) return;
          const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          receivedBytes += bytes.byteLength;
          if (receivedBytes > request.maxResponseBytes) {
            const error = new LivePageLoadError(
              "response_too_large",
              `Response from ${url.href} exceeded ${request.maxResponseBytes} bytes`,
            );
            fail(error);
            response.destroy(error);
            clientRequest.destroy();
            return;
          }
          chunks.push(bytes);
        });
        response.once("aborted", () => fail(responseAborted(url.href)));
        response.once("error", (error) => fail(error));
        response.once("end", () => {
          if (request.signal.aborted) {
            fail(abortError(request.signal));
            return;
          }
          const body = Uint8Array.from(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), receivedBytes));
          succeed({
            status: response.statusCode!,
            headers: normalizeHeaders(response.headers),
            body,
          });
        });
      };

      const clientRequest = url.protocol === "https:"
        ? https.request(options, onResponse)
        : http.request(options, onResponse);
      clientRequest.once("error", (error) => fail(error));
      clientRequest.end();
    });
  }
}

export const createLiveSourceWebsiteIngestionDependencies = (
  options: LiveSourceWebsiteIngestionAdapterOptions = {},
): IngestionDependencies => ({
  dns: new NodeDnsResolver(options.dnsLookup),
  pages: new NodePageLoader(),
});
