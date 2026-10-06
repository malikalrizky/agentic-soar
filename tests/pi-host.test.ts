import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  PiHostError,
  countToolCall,
  gerbangDkExtensionPath,
  lastAssistantTextFromSession,
  piRpcTimeoutMs,
  piSpawnArgs,
  resolvePiCliJs,
  runPiInvestigation,
  type RpcClientLike,
} from "../src/pi-host.ts";
import { INVESTIGATION_WALL_MS } from "../src/constants.ts";

const TOOL_START = "tool_execution_start";

function makeFakeClient(opts: {
  toolEvents?: number;
  nestedToolcallEvents?: number;
  text?: string;
  fail?: boolean;
  startFail?: boolean;
}): RpcClientLike & {
  abortCalls: number;
  continueCalls: number;
} {
  let handler: ((e: { type: string }) => void) | undefined;
  let abortCalls = 0;
  const continueCalls = 0;
  const client: RpcClientLike & { abortCalls: number; continueCalls: number } = {
    abortCalls: 0,
    continueCalls: 0,
    async start() {
      if (opts.startFail) throw new Error("ENOENT pi");
    },
    async promptAndWait() {
      if (opts.fail) throw new Error("child exited");
      for (let i = 0; i < (opts.nestedToolcallEvents ?? 0); i++) {
        handler?.({ type: "message_update", assistantMessageEvent: { type: "toolcall_start" } } as { type: string });
      }
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
  test("piSpawnArgs disables builtin tools and loads Gerbang dk extension", () => {
    expect(piSpawnArgs({ sessionDir: "/s", systemPromptPath: "/p" })).toEqual([
      "--mode",
      "rpc",
      "--no-builtin-tools",
      "-e",
      gerbangDkExtensionPath(),
      "-a",
      "--session-dir",
      "/s",
      "--system-prompt",
      "/p",
    ]);
    expect(piSpawnArgs({ sessionDir: "/s", systemPromptPath: "/p" })).not.toContain("--no-extensions");
    expect(gerbangDkExtensionPath().endsWith("extensions/gerbang-dk.mjs")).toBe(true);
    expect(resolve(gerbangDkExtensionPath())).toBe(gerbangDkExtensionPath());
  });

  test("fifteenth tool event calls abort and sets aborted", async () => {
    const fake = makeFakeClient({ toolEvents: 15, text: "ignored" });
    const out = await runPiInvestigation(fake, "go");
    expect(fake.abortCalls).toBe(1);
    expect(out.aborted).toBe(true);
    expect(out.toolCallCount).toBe(15);
  });

  test("child start failure throws PiHostError", async () => {
    const fake = makeFakeClient({ startFail: true });
    await expect(runPiInvestigation(fake, "go")).rejects.toBeInstanceOf(PiHostError);
  });

  test("nested toolcall_start does not double-count with tool_execution_start", async () => {
    expect(countToolCall({ type: "tool_execution_start" })).toBe(true);
    expect(countToolCall({ type: "message_update", assistantMessageEvent: { type: "toolcall_start" } })).toBe(false);
    const fake = makeFakeClient({ toolEvents: 8, nestedToolcallEvents: 15 });
    const out = await runPiInvestigation(fake, "go");
    expect(out.aborted).toBe(false);
    expect(out.toolCallCount).toBe(8);
  });

  test("resolvePiCliJs prefers PI_CLI", () => {
    const prev = process.env.PI_CLI;
    process.env.PI_CLI = "/opt/pi/cli.js";
    try {
      expect(resolvePiCliJs()).toBe("/opt/pi/cli.js");
    } finally {
      if (prev === undefined) delete process.env.PI_CLI;
      else process.env.PI_CLI = prev;
    }
  });

  test("piRpcTimeoutMs is longer than the wall cap", () => {
    expect(piRpcTimeoutMs()).toBeGreaterThan(INVESTIGATION_WALL_MS);
  });

  test("lastAssistantTextFromSession reads last assistant text parts", () => {
    const dir = join(tmpdir(), `soar-session-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "s.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "session" }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "plan" },
              { type: "text", text: "```json\n{\"alert_disposition\":\"false_positive\"}\n```" },
            ],
          },
        }),
      ].join("\n") + "\n",
    );
    expect(lastAssistantTextFromSession(file)).toContain("false_positive");
  });
});
