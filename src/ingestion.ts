import { isIP } from "node:net";

export interface DnsResolver {
  resolve(hostname: string): Promise<string[]>;
}

export interface PageLoadRequest {
  url: string;
  addresses: string[];
  signal: AbortSignal;
  maxResponseBytes: number;
}

export interface PageLoadResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  screenshot?: { uri: string; mediaType: string };
}

export interface PageLoader {
  load(request: PageLoadRequest): Promise<PageLoadResponse>;
}

export type ReplacementImage =
  | { kind: "upload"; name: string; mediaType?: string; bytes: Uint8Array }
  | { kind: "remote_url"; url: string };

export interface SourceWebsiteInput {
  sourceWebsite: string;
  featurePage?: string;
  replacementImages?: ReplacementImage[];
}

export interface IngestionDependencies {
  dns: DnsResolver;
  pages: PageLoader;
  now?: () => number;
}

export interface IngestionOptions {
  maxPages?: number;
  pageTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

export interface Attribution {
  sourcePageUrl: string;
  sourceUrl?: string;
  selector?: string;
}

export interface AttributedText {
  value: string;
  attribution: Attribution;
}

export interface AttributedAsset {
  url: string;
  kind: "image" | "social_image" | "logo" | "icon" | "screenshot";
  mediaType?: string;
  alt?: string;
  attribution: Attribution;
}

export interface ValidatedReplacementImage {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  bytes: Uint8Array;
  attribution: { kind: "uploaded"; fileName: string };
}

export type IngestionWarningCode =
  | "page_load_failed"
  | "page_timeout"
  | "total_timeout"
  | "http_error"
  | "unsupported_content_type"
  | "response_too_large";

export interface IngestionWarning {
  code: IngestionWarningCode;
  url: string;
  message: string;
}

export interface SourceWebsiteResult {
  sourceWebsite: string;
  pages: Array<{ url: string; status: number; title?: AttributedText }>;
  metadata: { title?: AttributedText; description?: AttributedText };
  headings: AttributedText[];
  body: AttributedText[];
  claims: AttributedText[];
  callsToAction: AttributedText[];
  images: AttributedAsset[];
  logoCandidates: AttributedAsset[];
  screenshots: AttributedAsset[];
  colors: AttributedText[];
  replacementImages: ValidatedReplacementImage[];
  warnings: IngestionWarning[];
}

export class IngestionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IngestionError";
  }
}

class PageTimeoutError extends Error {}

const defaults = {
  maxPages: 5,
  pageTimeoutMs: 5_000,
  totalTimeoutMs: 15_000,
  maxResponseBytes: 1024 * 1024,
  maxRedirects: 5,
} as const;

export const MAX_REPLACEMENT_IMAGES = 10;
export const MAX_REPLACEMENT_IMAGE_BYTES = 10 * 1024 * 1024;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const allowedContentTypes = new Set(["text/html", "application/xhtml+xml"]);

const parseIpv4 = (address: string) => {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return undefined;
  return parts.map(Number);
};

const isPublicIpv4 = (address: string) => {
  const parts = parseIpv4(address);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  return true;
};

const expandIpv6 = (address: string) => {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (!ipv4) return undefined;
    address = `${normalized.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  } else {
    address = normalized;
  }
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.map((group) => Number.parseInt(group, 16));
};

const isPublicIpv6 = (address: string) => {
  const groups = expandIpv6(address);
  if (!groups) return false;
  if (groups.slice(0, 6).every((group) => group === 0)) return false;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isPublicIpv4(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`);
  }
  if ((groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80 || (groups[0] & 0xffc0) === 0xfec0 || (groups[0] & 0xff00) === 0xff00) return false;
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups[2] === 1 || groups[0] === 0x0100 && groups.slice(1, 4).every((group) => group === 0)) return false;
  if (groups[0] === 0x2001 && (groups[1] <= 0x01ff || groups[1] === 0x0db8) || groups[0] === 0x2002) return false;
  return true;
};

const isPublicAddress = (address: string) => {
  const version = isIP(address.split("%")[0]);
  return version === 4 ? isPublicIpv4(address) : version === 6 ? isPublicIpv6(address) : false;
};

const parsePublicUrl = (value: string, label: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new IngestionError(`${label} must be a valid public HTTP or HTTPS address`, { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new IngestionError(`${label} must use HTTP or HTTPS`);
  if (url.username || url.password) throw new IngestionError(`${label} must not contain credentials`);
  url.hash = "";
  return url;
};

const resolvePublicAddresses = async (url: URL, dns: DnsResolver) => {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const directVersion = isIP(hostname);
  let addresses: string[];
  try {
    addresses = directVersion ? [hostname] : await dns.resolve(hostname);
  } catch (error) {
    throw new IngestionError(`Could not resolve ${hostname} to a public address`, { cause: error });
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new IngestionError(`${hostname} must resolve only to public addresses`);
  }
  return [...new Set(addresses)];
};

const header = (headers: Record<string, string>, name: string) => {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match?.[1];
};

const withTimeout = async <T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number) => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new PageTimeoutError("Page load timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), expired]);
  } finally {
    clearTimeout(timeout!);
  }
};

const loadWithRedirects = async (
  initialUrl: URL,
  dependencies: IngestionDependencies,
  options: Required<IngestionOptions>,
  timeoutMs: number,
  allowedOrigin?: string,
) => withTimeout(async (signal) => {
  let url = initialUrl;
  for (let redirects = 0; redirects <= options.maxRedirects; redirects += 1) {
    if (allowedOrigin && url.origin !== allowedOrigin) throw new IngestionError(`Redirect target ${url.href} must remain on the same origin`);
    const addresses = await resolvePublicAddresses(url, dependencies.dns);
    if (signal.aborted) throw new PageTimeoutError("Page load timed out");
    const response = await dependencies.pages.load({ url: url.href, addresses, signal, maxResponseBytes: options.maxResponseBytes });
    if (signal.aborted) throw new PageTimeoutError("Page load timed out");
    if (!redirectStatuses.has(response.status)) return { url, response };
    if (redirects === options.maxRedirects) throw new IngestionError(`Redirect limit exceeded for ${initialUrl.href}`);
    const location = header(response.headers, "location");
    if (!location) throw new IngestionError(`Redirect from ${url.href} did not include a Location header`);
    url = parsePublicUrl(new URL(location, url).href, "Redirect target");
  }
  throw new IngestionError(`Redirect limit exceeded for ${initialUrl.href}`);
}, timeoutMs);

const decodeHtml = (value: string) => value
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, "\"")
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));

const cleanText = (value: string) => decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const attributes = (value: string) => {
  const result: Record<string, string> = {};
  for (const match of value.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
};

const attributedText = (value: string, sourcePageUrl: string, selector: string, sourceUrl?: string): AttributedText => ({
  value,
  attribution: { sourcePageUrl, ...(sourceUrl ? { sourceUrl } : {}), selector },
});

const resolveAssetUrl = (value: string, pageUrl: string) => {
  try {
    const url = new URL(value, pageUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};

interface ExtractedPage {
  title?: AttributedText;
  description?: AttributedText;
  headings: AttributedText[];
  body: AttributedText[];
  callsToAction: AttributedText[];
  images: AttributedAsset[];
  logos: AttributedAsset[];
  colors: AttributedText[];
  links: URL[];
}

const extractPage = (html: string, pageUrl: string): ExtractedPage => {
  const withoutHidden = html.replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const titleValue = cleanText(withoutHidden.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const title = titleValue ? attributedText(titleValue, pageUrl, "title") : undefined;
  let description: AttributedText | undefined;
  const images: AttributedAsset[] = [];
  const logos: AttributedAsset[] = [];
  for (const match of withoutHidden.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = attributes(match[1]);
    const key = (attrs.name || attrs.property || "").toLowerCase();
    if (!description && (key === "description" || key === "og:description") && attrs.content?.trim()) {
      description = attributedText(cleanText(attrs.content), pageUrl, `meta[${attrs.name ? "name" : "property"}="${key}"]`);
    }
    if (key === "og:image" && attrs.content) {
      const url = resolveAssetUrl(attrs.content, pageUrl);
      if (url) images.push({ url, kind: "social_image", attribution: { sourcePageUrl: pageUrl, sourceUrl: url, selector: "meta[property=\"og:image\"]" } });
    }
  }
  for (const match of withoutHidden.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = attributes(match[1]);
    if (!attrs.rel?.toLowerCase().split(/\s+/).some((rel) => rel === "icon") || !attrs.href) continue;
    const url = resolveAssetUrl(attrs.href, pageUrl);
    if (!url) continue;
    const asset: AttributedAsset = { url, kind: "icon", attribution: { sourcePageUrl: pageUrl, sourceUrl: url, selector: "link[rel~=icon]" } };
    images.push(asset);
    logos.push(asset);
  }
  for (const match of withoutHidden.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = attributes(match[1]);
    const source = attrs.src || attrs["data-src"];
    if (!source) continue;
    const url = resolveAssetUrl(source, pageUrl);
    if (!url) continue;
    const logo = /logo|brand/i.test(`${source} ${attrs.alt ?? ""} ${attrs.class ?? ""} ${attrs.id ?? ""}`);
    const asset: AttributedAsset = {
      url,
      kind: logo ? "logo" : "image",
      ...(attrs.alt ? { alt: cleanText(attrs.alt) } : {}),
      attribution: { sourcePageUrl: pageUrl, sourceUrl: url, selector: "img" },
    };
    images.push(asset);
    if (logo) logos.push(asset);
  }
  const headings = [...withoutHidden.matchAll(/<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => attributedText(cleanText(match[2]), pageUrl, match[1].toLowerCase()))
    .filter(({ value }) => value.length > 0);
  const body = [...withoutHidden.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => attributedText(cleanText(match[2]), pageUrl, match[1].toLowerCase()))
    .filter(({ value }) => value.length > 0);
  const callsToAction: AttributedText[] = [];
  const links: URL[] = [];
  for (const match of withoutHidden.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = attributes(match[1]);
    const value = cleanText(match[2]);
    const target = attrs.href ? resolveAssetUrl(attrs.href, pageUrl) : undefined;
    if (target) links.push(new URL(target));
    if (value) callsToAction.push(attributedText(value, pageUrl, "a", target));
  }
  for (const match of withoutHidden.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    const value = cleanText(match[1]);
    if (value) callsToAction.push(attributedText(value, pageUrl, "button"));
  }
  const colorValues = new Set<string>();
  for (const match of withoutHidden.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)/gi)) colorValues.add(match[0]);
  const colors = [...colorValues].map((value) => attributedText(value, pageUrl, "style"));
  return { title, description, headings, body, callsToAction, images, logos, colors, links };
};

const pageScore = (url: URL) => {
  const path = url.pathname.toLowerCase();
  if (/pricing|plans/.test(path)) return 100;
  if (/docs|documentation/.test(path)) return 90;
  if (/product|platform/.test(path)) return 80;
  if (/features?/.test(path)) return 75;
  if (/use[-_/]?cases?|solutions?/.test(path)) return 70;
  return 10;
};

const detectMediaType = (bytes: Uint8Array): ValidatedReplacementImage["mediaType"] | undefined => {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return undefined;
};

export const validateReplacementImages = (images: unknown = []) => {
  if (!Array.isArray(images)) throw new IngestionError("Replacement images must be uploaded files");
  if (images.length > MAX_REPLACEMENT_IMAGES) throw new IngestionError(`Upload at most ${MAX_REPLACEMENT_IMAGES} replacement images`);
  return images.map((candidate): ValidatedReplacementImage => {
    if (!candidate || typeof candidate !== "object") throw new IngestionError("Replacement images must be uploaded files");
    const image = candidate as Record<string, unknown>;
    if (image.kind === "remote_url") throw new IngestionError("Remote replacement URLs are not accepted; upload the image bytes instead");
    if (image.kind !== "upload" || typeof image.name !== "string" || !image.name.trim()) throw new IngestionError("Replacement images must be named uploaded files");
    if (!ArrayBuffer.isView(image.bytes) || (image.bytes as ArrayBufferView & { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT !== 1) {
      throw new IngestionError(`${image.name} must provide image bytes`);
    }
    const bytes = image.bytes as unknown as Uint8Array;
    if (bytes.byteLength > MAX_REPLACEMENT_IMAGE_BYTES) throw new IngestionError(`${image.name} exceeds the 10MB replacement image limit`);
    const mediaType = detectMediaType(bytes);
    if (!mediaType) throw new IngestionError(`${image.name} must be a PNG, JPEG, or WebP image identified by its magic bytes`);
    if (image.mediaType !== undefined && (typeof image.mediaType !== "string" || image.mediaType.toLowerCase() !== mediaType)) {
      throw new IngestionError(`${image.name} declared media type does not match its magic bytes`);
    }
    return {
      name: image.name,
      mediaType,
      sizeBytes: bytes.byteLength,
      bytes,
      attribution: { kind: "uploaded", fileName: image.name },
    };
  });
};

const dedupeText = (items: AttributedText[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.value}\u0000${item.attribution.sourcePageUrl}\u0000${item.attribution.selector}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const dedupeAssets = (items: AttributedAsset[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.url}\u0000${item.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const ingestSourceWebsite = async (
  input: SourceWebsiteInput,
  dependencies: IngestionDependencies,
  overrides: IngestionOptions = {},
): Promise<SourceWebsiteResult> => {
  const options = { ...defaults, ...overrides };
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > defaults.maxPages) {
    throw new IngestionError(`maxPages must be between 1 and ${defaults.maxPages}`);
  }
  if (![options.pageTimeoutMs, options.totalTimeoutMs, options.maxResponseBytes].every((value) => Number.isFinite(value) && value > 0)) {
    throw new IngestionError("Ingestion limits must be finite and positive");
  }
  if (!Number.isInteger(options.maxRedirects) || options.maxRedirects < 0 || options.maxRedirects > defaults.maxRedirects) {
    throw new IngestionError(`maxRedirects must be between 0 and ${defaults.maxRedirects}`);
  }
  const sourceWebsite = parsePublicUrl(input.sourceWebsite, "Source Website");
  const featurePage = input.featurePage ? parsePublicUrl(input.featurePage, "Feature page") : undefined;
  if (featurePage && featurePage.origin !== sourceWebsite.origin) throw new IngestionError("Feature page must use the same origin as the Source Website");
  const replacementImages = validateReplacementImages(input.replacementImages);
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const warnings: IngestionWarning[] = [];
  const pages: SourceWebsiteResult["pages"] = [];
  const headings: AttributedText[] = [];
  const body: AttributedText[] = [];
  const callsToAction: AttributedText[] = [];
  const images: AttributedAsset[] = [];
  const logoCandidates: AttributedAsset[] = [];
  const screenshots: AttributedAsset[] = [];
  const colors: AttributedText[] = [];
  const candidates = new Map<string, { url: URL; priority: number; order: number }>();
  const visited = new Set<string>();
  let order = 0;
  let crawlOrigin: string | undefined;
  let rootFinalUrl = sourceWebsite.href;
  let metadata: SourceWebsiteResult["metadata"] = {};

  const addCandidate = (url: URL, priority = pageScore(url)) => {
    url.hash = "";
    if (url.protocol !== "http:" && url.protocol !== "https:" || url.username || url.password) return;
    if (crawlOrigin && url.origin !== crawlOrigin || visited.has(url.href) || candidates.has(url.href)) return;
    candidates.set(url.href, { url, priority, order: order += 1 });
  };

  addCandidate(sourceWebsite, Number.MAX_SAFE_INTEGER);
  let featureQueued = false;
  let attemptedPages = 0;
  while (attemptedPages < options.maxPages && candidates.size > 0) {
    const elapsed = now() - startedAt;
    if (elapsed >= options.totalTimeoutMs) {
      warnings.push({ code: "total_timeout", url: rootFinalUrl, message: "Source Website ingestion reached its total timeout" });
      break;
    }
    const next = [...candidates.values()].sort((left, right) => right.priority - left.priority || left.order - right.order)[0];
    candidates.delete(next.url.href);
    if (visited.has(next.url.href)) continue;
    visited.add(next.url.href);
    attemptedPages += 1;
    const isRoot = pages.length === 0 && !crawlOrigin;
    try {
      const loaded = await loadWithRedirects(
        next.url,
        dependencies,
        options,
        Math.min(options.pageTimeoutMs, options.totalTimeoutMs - elapsed),
        isRoot ? undefined : crawlOrigin,
      );
      if (now() - startedAt >= options.totalTimeoutMs) {
        warnings.push({ code: "total_timeout", url: loaded.url.href, message: "Source Website ingestion reached its total timeout" });
        break;
      }
      if (isRoot) {
        crawlOrigin = loaded.url.origin;
        rootFinalUrl = loaded.url.href;
        for (const [key, candidate] of candidates) if (candidate.url.origin !== crawlOrigin) candidates.delete(key);
        if (featurePage) {
          if (featurePage.origin !== crawlOrigin) throw new IngestionError("Feature page must use the same origin as the final Source Website");
          addCandidate(featurePage, Number.MAX_SAFE_INTEGER - 1);
          featureQueued = true;
        }
      }
      const { response } = loaded;
      if (response.status < 200 || response.status >= 300) {
        warnings.push({ code: "http_error", url: loaded.url.href, message: `Page returned HTTP ${response.status}` });
        continue;
      }
      const contentType = (header(response.headers, "content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!allowedContentTypes.has(contentType)) {
        warnings.push({ code: "unsupported_content_type", url: loaded.url.href, message: `Page returned unsupported content type ${contentType || "unknown"}` });
        continue;
      }
      const declaredLength = Number(header(response.headers, "content-length"));
      if (response.body.byteLength > options.maxResponseBytes || Number.isFinite(declaredLength) && declaredLength > options.maxResponseBytes) {
        warnings.push({ code: "response_too_large", url: loaded.url.href, message: `Page exceeded the ${options.maxResponseBytes}-byte response limit` });
        continue;
      }
      const extracted = extractPage(new TextDecoder().decode(response.body), loaded.url.href);
      pages.push({ url: loaded.url.href, status: response.status, ...(extracted.title ? { title: extracted.title } : {}) });
      if (!metadata.title && extracted.title) metadata = { ...metadata, title: extracted.title };
      if (!metadata.description && extracted.description) metadata = { ...metadata, description: extracted.description };
      headings.push(...extracted.headings);
      body.push(...extracted.body);
      callsToAction.push(...extracted.callsToAction);
      images.push(...extracted.images);
      logoCandidates.push(...extracted.logos);
      colors.push(...extracted.colors);
      if (response.screenshot) {
        screenshots.push({
          url: response.screenshot.uri,
          kind: "screenshot",
          mediaType: response.screenshot.mediaType,
          attribution: { sourcePageUrl: loaded.url.href, sourceUrl: response.screenshot.uri, selector: "rendered-page" },
        });
      }
      if (crawlOrigin) for (const link of extracted.links) if (link.origin === crawlOrigin) addCandidate(link);
      if (isRoot && featurePage && !featureQueued) addCandidate(featurePage, Number.MAX_SAFE_INTEGER - 1);
    } catch (error) {
      if (error instanceof IngestionError && isRoot) throw error;
      const code = error instanceof PageTimeoutError ? "page_timeout" : "page_load_failed";
      warnings.push({ code, url: next.url.href, message: code === "page_timeout" ? "Page load timed out" : "Page could not be loaded" });
    }
  }
  if (pages.length === 0) throw new IngestionError("Source Website ingestion produced no usable public HTML pages");
  const dedupedBody = dedupeText(body);
  return {
    sourceWebsite: rootFinalUrl,
    pages,
    metadata,
    headings: dedupeText(headings),
    body: dedupedBody,
    claims: dedupedBody,
    callsToAction: dedupeText(callsToAction),
    images: dedupeAssets(images),
    logoCandidates: dedupeAssets(logoCandidates),
    screenshots: dedupeAssets(screenshots),
    colors: dedupeText(colors),
    replacementImages,
    warnings,
  };
};
