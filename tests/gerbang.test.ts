import { describe, expect, test } from "bun:test";
import { FROZEN_PI_MODEL } from "../src/constants.ts";
import {
  ensureGerbangAdapterEnv,
  gerbangPiModelsJson,
  parseGerbangProxyOutput,
} from "../src/gerbang.ts";

describe("gerbang adapter", () => {
  test("frozen model is DeepSeek flash via dk", () => {
    expect(FROZEN_PI_MODEL).toBe("dk/openrouter/deepseek/deepseek-v4.1-flash");
  });

  test("parseGerbangProxyOutput reads OpenAI-compatible adapter lines", () => {
    const out = parseGerbangProxyOutput(
      [
        "Gerbang adapter abc is listening on http://127.0.0.1:9123",
        "OPENAI_BASE_URL=http://127.0.0.1:9123/v1",
        "OPENAI_API_KEY=test-secret-key",
        "GERBANG_INSTANCE_ID=abc",
      ].join("\n"),
    );
    expect(out).toEqual({
      GERBANG_ADAPTER_BASE_URL: "http://127.0.0.1:9123/v1",
      GERBANG_ADAPTER_API_KEY: "test-secret-key",
    });
  });

  test("gerbangPiModelsJson catalogs only the frozen flash model", () => {
    const models = JSON.parse(gerbangPiModelsJson()) as Array<{ id: string }>;
    expect(models.map((m) => m.id)).toEqual([FROZEN_PI_MODEL]);
  });

  test("ensureGerbangAdapterEnv skips proxy when adapter env is set", () => {
    let called = 0;
    const env = ensureGerbangAdapterEnv(
      {
        GERBANG_ADAPTER_BASE_URL: "http://127.0.0.1:1/v1",
        GERBANG_ADAPTER_API_KEY: "already",
      },
      () => {
        called += 1;
        return { status: 0, stdout: "", stderr: "" };
      },
    );
    expect(called).toBe(0);
    expect(env.GERBANG_ADAPTER_API_KEY).toBe("already");
  });

  test("ensureGerbangAdapterEnv starts proxy when adapter env is missing", () => {
    const env = ensureGerbangAdapterEnv({}, () => ({
      status: 0,
      stdout: "OPENAI_BASE_URL=http://127.0.0.1:9/v1\nOPENAI_API_KEY=from-proxy\n",
      stderr: "",
    }));
    expect(env).toEqual({
      GERBANG_ADAPTER_BASE_URL: "http://127.0.0.1:9/v1",
      GERBANG_ADAPTER_API_KEY: "from-proxy",
    });
  });
});
