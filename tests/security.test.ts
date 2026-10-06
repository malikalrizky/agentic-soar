import { expect, test } from "bun:test";
import { handleCoralogixSearch } from "../src/security.ts";

const ARGS = {
  query: "source logs",
  start: "2026-01-01T00:00:00Z",
  end: "2026-01-01T01:00:00Z",
};
const SECRET = `{"apiKey":"cx-secret-key-value","endpoint":"https://api.eu2.coralogix.com"}`;

function asFetch(fn: (...args: never[]) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch;
}

test("invalid args do not fetch secret or vendor", async () => {
  let gets = 0;
  let fetches = 0;
  const out = await handleCoralogixSearch(
    {},
    {
      getSecret: async () => {
        gets += 1;
        return SECRET;
      },
      fetch: asFetch(async () => {
        fetches += 1;
        return new Response("{}");
      }),
      audit: () => {},
    },
  );
  expect(out).toEqual({
    ok: false,
    error: { code: "invalid_request", message: "invalid_request" },
  });
  expect(gets).toBe(0);
  expect(fetches).toBe(0);
});

test("HTTP 500 is vendor_error not empty hits", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: asFetch(async () => new Response("nope", { status: 500 })),
    sleep: async () => {},
    audit: () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("vendor_error");
});

test("ok hits redact the api key and audit has no query", async () => {
  const lines: string[] = [];
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: asFetch(
      async () =>
        new Response(JSON.stringify({ result: { results: [{ msg: "cx-secret-key-value" }] } }), {
          status: 200,
        }),
    ),
    audit: (s) => lines.push(s),
  });
  expect(out.ok).toBe(true);
  if (out.ok) {
    expect(JSON.stringify(out.hits)).not.toContain("cx-secret-key-value");
    expect(out.hitCount).toBe(1);
  }
  expect(lines).toHaveLength(1);
  const line = lines[0]!;
  expect(line).not.toContain("source logs");
  expect(line).not.toContain("cx-secret-key-value");
  expect(JSON.parse(line).argHash).toMatch(/^[0-9a-f]{64}$/);
});

test("zero hits on 200 is ok not an error", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: asFetch(
      async () => new Response(JSON.stringify({ result: { results: [] } }), { status: 200 }),
    ),
    audit: () => {},
  });
  expect(out).toEqual({ ok: true, hitCount: 0, hits: [], truncated: false });
});

test("getSecret is reused until TTL then refetched", async () => {
  let gets = 0;
  let t = 0;
  const deps = {
    getSecret: async () => {
      gets += 1;
      return SECRET;
    },
    fetch: asFetch(
      async () => new Response(JSON.stringify({ result: { results: [] } }), { status: 200 }),
    ),
    now: () => t,
    audit: () => {},
  };
  await handleCoralogixSearch(ARGS, deps);
  await handleCoralogixSearch(ARGS, deps);
  expect(gets).toBe(1);
  t = 300_001;
  await handleCoralogixSearch(ARGS, deps);
  expect(gets).toBe(2);
});

test("401 invalidates cache and refetches secret once", async () => {
  let gets = 0;
  let n = 0;
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => {
      gets += 1;
      return SECRET;
    },
    fetch: asFetch(async () => {
      n += 1;
      return n === 1
        ? new Response("no", { status: 401 })
        : new Response(JSON.stringify({ result: { results: [] } }), { status: 200 });
    }),
    audit: () => {},
  });
  expect(out.ok).toBe(true);
  expect(gets).toBe(2);
  expect(n).toBe(2);
});

test("500 retries once then vendor_error", async () => {
  let n = 0;
  let slept = 0;
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: asFetch(async () => {
      n += 1;
      return new Response("x", { status: 500 });
    }),
    sleep: async (ms) => {
      slept = ms;
    },
    audit: () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("vendor_error");
  expect(n).toBe(2);
  expect(slept).toBe(250);
});

test("401 is not 5xx retry; second 401 is vendor_auth", async () => {
  let n = 0;
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: asFetch(async () => {
      n += 1;
      return new Response("no", { status: 401 });
    }),
    sleep: async () => {
      throw new Error("no 5xx sleep on 401");
    },
    audit: () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("vendor_auth");
  expect(n).toBe(2);
});

test("fetch throw is vendor_timeout", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: asFetch(async () => {
      throw new Error("network down");
    }),
    audit: () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("vendor_timeout");
});

test("getSecret throw is secret_unavailable", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => {
      throw new Error("gsm down");
    },
    fetch: asFetch(async () => new Response("{}")),
    audit: () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("secret_unavailable");
});

test("non-JSON secret payload is secret_unavailable", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => "not-json",
    fetch: asFetch(async () => new Response("{}")),
    audit: () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("secret_unavailable");
});

test("truncated is true when vendor returns more hits than limit", async () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ i }));
  const out = await handleCoralogixSearch(
    { ...ARGS, limit: 2 },
    {
      getSecret: async () => SECRET,
      fetch: asFetch(
        async () =>
          new Response(JSON.stringify({ result: { results: many } }), { status: 200 }),
      ),
      audit: () => {},
    },
  );
  expect(out.ok).toBe(true);
  if (out.ok) {
    expect(out.hits).toHaveLength(2);
    expect(out.truncated).toBe(true);
  }
});

test("JSON field api_key values are redacted", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: asFetch(
      async () =>
        new Response(
          JSON.stringify({
            result: { results: [{ api_key: "AKIAIOSFODNN7EXAMPLEKEY123" }] },
          }),
          { status: 200 },
        ),
    ),
    audit: () => {},
  });
  expect(out.ok).toBe(true);
  if (out.ok) {
    expect(JSON.stringify(out.hits)).not.toContain("AKIAIOSFODNN7EXAMPLEKEY123");
  }
});

test("200 body with error key is vendor_error not a hit", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: asFetch(
      async () =>
        new Response(JSON.stringify({ error: "query syntax error" }), { status: 200 }),
    ),
    audit: () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("vendor_error");
});

test("hung getSecret becomes secret_unavailable", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: () => new Promise(() => {}),
    fetch: asFetch(async () => new Response("{}")),
    secretTimeoutMs: 20,
    audit: () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("secret_unavailable");
});
