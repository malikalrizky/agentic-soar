import { describe, expect, test } from "bun:test";
import { PiHostError, piSpawnArgs, runPiInvestigation, type RpcClientLike } from "../src/pi-host.ts";

const TOOL_START = "tool_execution_start";

function makeFakeClient(opts: { toolEvents?: number; text?: string; fail?: boolean }): RpcClientLike & {
  abortCalls: number;
  continueCalls: number;
} {
  let handler: ((e: { type: string }) => void) | undefined;
  let abortCalls = 0;
  const continueCalls = 0;
  const client: RpcClientLike & { abortCalls: number; continueCalls: number } = {
    abortCalls: 0,
    continueCalls: 0,
    async start() {},
    async promptAndWait() {
      if (opts.fail) throw new Error("child exited");
      for (let i = 0; i < (opts.toolEvents ?? 0); i++) {
        handler?.({ type: TOOL_START });
      }
    },
    async abort() {
      abortCalls += 1;
      client.abortCalls = abortCalls;
    },
    async getState() {
      return { model: { id: "frozen-model" }, sessionFile: "/s.jsonl" };
    },
    onEvent(h) {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
    async close() {},
  };
  Object.defineProperty(client, "continueCalls", { get: () => continueCalls });
  return client;
}

describe("pi-host", () => {
  test("piSpawnArgs disables builtin tools and sets rpc", () => {
    expect(piSpawnArgs({ sessionDir: "/s", systemPromptPath: "/p" })).toEqual([
      "--mode",
      "rpc",
      "--no-builtin-tools",
      "-a",
      "--session-dir",
      "/s",
      "--system-prompt",
      "/p",
    ]);
  });

  test("fifteenth tool event calls abort and sets aborted", async () => {
    const fake = makeFakeClient({ toolEvents: 15, text: "ignored" });
    const out = await runPiInvestigation(fake, "go");
    expect(fake.abortCalls).toBe(1);
    expect(out.aborted).toBe(true);
    expect(out.toolCallCount).toBe(15);
  });

  test("child failure throws PiHostError and does not call newSession after fail", async () => {
    const fake = makeFakeClient({ fail: true });
    await expect(runPiInvestigation(fake, "go")).rejects.toBeInstanceOf(PiHostError);
    expect(fake.continueCalls).toBe(0);
  });
});
