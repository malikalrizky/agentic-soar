import { expect, test } from "bun:test";
import { handleCoralogixSearch } from "../src/security.ts";

const ARGS = {
  query: "source logs",
  start: "2026-01-01T00:00:00Z",
  end: "2026-01-01T01:00:00Z",
};
const SECRET = `{"apiKey":"cx-secret-key-value","endpoint":"https://api.eu2.coralogix.com"}`;

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
      fetch: (async () => {
        fetches += 1;
        return new Response("{}");
      }) as typeof fetch,
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
    fetch: (async () => new Response("nope", { status: 500 })) as typeof fetch,
    sleep: async () => {},
  });
  expect(out.ok).toBe(false);
  if (!out.ok) expect(out.error.code).toBe("vendor_error");
});

test("ok hits redact the api key and audit has no query", async () => {
  const lines: string[] = [];
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: (async () =>
      new Response(JSON.stringify({ result: { results: [{ msg: "cx-secret-key-value" }] } }), {
        status: 200,
      })) as typeof fetch,
    audit: (s) => lines.push(s),
  });
  expect(out.ok).toBe(true);
  if (out.ok) {
    expect(JSON.stringify(out.hits)).not.toContain("cx-secret-key-value");
    expect(out.hitCount).toBe(1);
  }
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain("source logs");
  expect(lines[0]).not.toContain("cx-secret-key-value");
  expect(JSON.parse(lines[0]).argHash).toMatch(/^[0-9a-f]{64}$/);
});

test("zero hits on 200 is ok not an error", async () => {
  const out = await handleCoralogixSearch(ARGS, {
    getSecret: async () => SECRET,
    fetch: (async () =>
      new Response(JSON.stringify({ result: { results: [] } }), { status: 200 })) as typeof fetch,
  });
  expect(out).toEqual({ ok: true, hitCount: 0, hits: [], truncated: false });
});
