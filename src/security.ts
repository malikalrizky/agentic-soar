import { createHash } from "node:crypto";

const MAX_QUERY_CHARS = 2000;
const MAX_WINDOW_MS = 86_400_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const MAX_RESULT_BYTES = 32_768;
const SECRET_TTL_MS = 300_000;
const HTTP_TIMEOUT_MS = 15_000;
const RETRY_BACKOFF_MS = 250;
const RETRY_AFTER_CAP_MS = 5_000;

type SecretCacheEntry = { value: string; fetchedAt: number };
const secretCaches = new WeakMap<() => Promise<string>, SecretCacheEntry>();

function invalidateSecretCache(getSecret: () => Promise<string>): void {
  secretCaches.delete(getSecret);
}

async function getCachedSecret(
  getSecret: () => Promise<string>,
  now: () => number,
  timeoutMs: number,
): Promise<string> {
  const t = now();
  const hit = secretCaches.get(getSecret);
  if (hit !== undefined && t - hit.fetchedAt < SECRET_TTL_MS) {
    return hit.value;
  }
  const value = await getSecretWithTimeout(getSecret, timeoutMs);
  secretCaches.set(getSecret, { value, fetchedAt: t });
  return value;
}

export type LayerErrorCode =
  | "invalid_request"
  | "secret_unavailable"
  | "vendor_auth"
  | "vendor_timeout"
  | "vendor_error";

export type LayerResult =
  | { ok: true; hitCount: number; hits: unknown[]; truncated: boolean }
  | { ok: false; error: { code: LayerErrorCode; message: string } };

export type SecurityDeps = {
  getSecret: () => Promise<string>;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  audit?: (line: string) => void;
  /** Override for tests; default matches vendor HTTP timeout. */
  secretTimeoutMs?: number;
};

type SearchArgs = { query: string; start: string; end: string; limit: number };
type CoralogixCredentials = { apiKey: string; endpoint: string };

function redactSecrets(text: string, extras: string[]): string {
  let out = text;
  for (const extra of extras) {
    if (!extra) continue;
    out = out.split(extra).join("[REDACTED]");
  }
  out = out.replace(
    /("(?:api[_-]?key|token|secret)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
    '$1"[REDACTED]"',
  );
  out = out.replace(
    /(?:api[_-]?key|token|secret)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/gi,
    "api_key=[REDACTED]",
  );
  return out;
}

function boundHits(
  hits: unknown[],
  maxHits: number,
  maxBytes: number,
): { hits: unknown[]; truncated: boolean } {
  let truncated = hits.length > maxHits;
  let next = hits.slice(0, maxHits);
  while (next.length > 0 && JSON.stringify(next).length > maxBytes) {
    next = next.slice(0, -1);
    truncated = true;
  }
  if (hits.length > 0 && next.length === 0) truncated = true;
  return { hits: next, truncated };
}

function argHash(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex");
}

function writeAudit(
  audit: ((line: string) => void) | undefined,
  record: Record<string, unknown>,
): void {
  const line = JSON.stringify(record);
  (audit ?? ((s) => process.stderr.write(s + "\n")))(line);
}

function parseSearchArgs(raw: Record<string, unknown>): SearchArgs {
  const query = raw.query;
  if (typeof query !== "string" || query.length === 0 || query.length > MAX_QUERY_CHARS) {
    throw new Error("invalid_request");
  }
  const start = raw.start;
  const end = raw.end;
  if (typeof start !== "string" || typeof end !== "string") {
    throw new Error("invalid_request");
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("invalid_request");
  }
  if (endMs - startMs > MAX_WINDOW_MS) {
    throw new Error("invalid_request");
  }
  let limit = DEFAULT_LIMIT;
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== "number" || !Number.isFinite(raw.limit)) {
      throw new Error("invalid_request");
    }
    limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw.limit)));
  }
  return { query, start, end, limit };
}

function parseCoralogixSecret(payload: string): CoralogixCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("invalid secret json");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { apiKey?: unknown }).apiKey !== "string" ||
    typeof (parsed as { endpoint?: unknown }).endpoint !== "string"
  ) {
    throw new Error("invalid secret json");
  }
  return {
    apiKey: (parsed as { apiKey: string }).apiKey,
    endpoint: (parsed as { endpoint: string }).endpoint,
  };
}

function extractHits(parsed: unknown): unknown[] | "vendor_error" {
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as {
      result?: { results?: unknown };
      hits?: unknown;
      error?: unknown;
    };
    if (Array.isArray(obj.result?.results)) return obj.result.results as unknown[];
    if (Array.isArray(obj.hits)) return obj.hits as unknown[];
    if (obj.error !== undefined) return "vendor_error";
  }
  return [parsed];
}

async function getSecretWithTimeout(
  getSecret: () => Promise<string>,
  timeoutMs: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getSecret(),
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new Error("secret_unavailable")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function sleepMs(
  ms: number,
  sleep: ((ms: number) => Promise<void>) | undefined,
): Promise<void> {
  if (sleep) {
    await sleep(ms);
    return;
  }
  await new Promise((r) => setTimeout(r, ms));
}

function retryWaitMs(res: Response): number {
  const ra = res.headers.get("Retry-After");
  if (ra !== null) {
    const sec = Number(ra);
    if (Number.isFinite(sec) && sec >= 0) {
      return Math.min(RETRY_AFTER_CAP_MS, sec * 1000);
    }
  }
  return RETRY_BACKOFF_MS;
}

async function coralogixDataprimeSearch(
  creds: CoralogixCredentials,
  args: SearchArgs,
  deps: { fetch: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<{ status: number; bodyText: string }> {
  const url = `${creds.endpoint.replace(/\/$/, "")}/api/v1/dataprime/query`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: args.query,
      metadata: { startDate: args.start, endDate: args.end },
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  };

  let res: Response;
  try {
    res = await deps.fetch(url, init);
  } catch {
    throw new Error("vendor_timeout");
  }

  if (res.status === 429 || res.status >= 500) {
    await sleepMs(retryWaitMs(res), deps.sleep);
    try {
      res = await deps.fetch(url, init);
    } catch {
      throw new Error("vendor_timeout");
    }
  }

  return { status: res.status, bodyText: await res.text() };
}

function fail(
  code: LayerErrorCode,
  message: string,
  extras: string[],
): LayerResult {
  return {
    ok: false,
    error: { code, message: redactSecrets(message, extras) },
  };
}

export async function handleCoralogixSearch(
  raw: Record<string, unknown>,
  deps: SecurityDeps,
): Promise<LayerResult> {
  const started = (deps.now ?? Date.now)();
  let args: SearchArgs | null = null;
  let apiKey = "";

  const finish = (result: LayerResult, httpStatus?: number): LayerResult => {
    const durationMs = (deps.now ?? Date.now)() - started;
    writeAudit(deps.audit, {
      tool: "coralogix_search",
      argHash: argHash(args ?? raw),
      durationMs,
      status: result.ok ? "ok" : "error",
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(!result.ok ? { errorCode: result.error.code } : {}),
    });
    return result;
  };

  try {
    args = parseSearchArgs(raw);
  } catch {
    return finish(fail("invalid_request", "invalid_request", []));
  }

  const now = deps.now ?? Date.now;

  async function loadCreds(): Promise<CoralogixCredentials | LayerResult> {
    let secretPayload: string;
    try {
      secretPayload = await getCachedSecret(
        deps.getSecret,
        now,
        deps.secretTimeoutMs ?? HTTP_TIMEOUT_MS,
      );
    } catch {
      return fail("secret_unavailable", "secret_unavailable", []);
    }
    try {
      return parseCoralogixSecret(secretPayload);
    } catch {
      invalidateSecretCache(deps.getSecret);
      return fail("secret_unavailable", "secret_unavailable", []);
    }
  }

  let credsOrErr = await loadCreds();
  if ("ok" in credsOrErr) {
    return finish(credsOrErr);
  }
  let creds = credsOrErr;
  apiKey = creds.apiKey;

  async function callVendor(
    c: CoralogixCredentials,
  ): Promise<{ status: number; bodyText: string } | LayerResult> {
    try {
      return await coralogixDataprimeSearch(c, args!, deps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "vendor_timeout") {
        return fail("vendor_timeout", "vendor_timeout", [c.apiKey]);
      }
      return fail("vendor_error", msg, [c.apiKey]);
    }
  }

  let vendorOrErr = await callVendor(creds);
  if ("ok" in vendorOrErr) {
    return finish(vendorOrErr);
  }
  let vendor = vendorOrErr;

  if (vendor.status === 401 || vendor.status === 403) {
    invalidateSecretCache(deps.getSecret);
    credsOrErr = await loadCreds();
    if ("ok" in credsOrErr) {
      return finish(credsOrErr, vendor.status);
    }
    creds = credsOrErr;
    apiKey = creds.apiKey;
    vendorOrErr = await callVendor(creds);
    if ("ok" in vendorOrErr) {
      return finish(vendorOrErr, vendor.status);
    }
    vendor = vendorOrErr;
    if (vendor.status === 401 || vendor.status === 403) {
      return finish(fail("vendor_auth", "vendor_auth", [apiKey]), vendor.status);
    }
  }

  if (vendor.status === 429 || vendor.status >= 500) {
    return finish(fail("vendor_error", "vendor_error", [apiKey]), vendor.status);
  }

  if (vendor.status < 200 || vendor.status >= 300) {
    return finish(fail("vendor_error", "vendor_error", [apiKey]), vendor.status);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(vendor.bodyText);
  } catch {
    return finish(fail("vendor_error", "vendor_error", [apiKey]), vendor.status);
  }

  const extracted = extractHits(parsed);
  if (extracted === "vendor_error") {
    return finish(fail("vendor_error", "vendor_error", [apiKey]), vendor.status);
  }
  const bounded = boundHits(extracted, args.limit, MAX_RESULT_BYTES);
  const redactedText = redactSecrets(JSON.stringify(bounded.hits), [apiKey]);
  let redactedHits: unknown[];
  try {
    redactedHits = JSON.parse(redactedText) as unknown[];
  } catch {
    return finish(fail("vendor_error", "vendor_error", [apiKey]), vendor.status);
  }

  return finish(
    {
      ok: true,
      hitCount: redactedHits.length,
      hits: redactedHits,
      truncated: bounded.truncated,
    },
    vendor.status,
  );
}
