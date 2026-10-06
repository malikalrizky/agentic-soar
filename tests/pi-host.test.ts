import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  PiHostError,
  gerbangDkExtensionPath,
  piRpcTimeoutMs,
  piSpawnArgs,
  resolvePiCliJs,
  runPiInvestigation,
} from "../src/pi-host.ts";
import { INVESTIGATION_WALL_MS } from "../src/constants.ts";

const TOOL_START = "tool_execution_start";

type FakeChild = {
  abortCalls: number;
  start(): Promise<void>;
  promptAndWait(message: string): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<{ model?: { id?: string }; sessionFile?: string }>;
  onEvent(handler: (e: { type: string }) => void): () => void;
  close(): Promise<void>;
  getLastAssistantText?: () => string | null;
};

function makeFakeChild(opts: {
  toolEvents?: number;
  nestedToolcallEvents?: number;
  hangUntilAbort?: boolean;
  sessionFile?: string;
  rpcText?: string;
  startFail?: boolean;
  fail?: boolean;
}): FakeChild {
  let handler: ((e: { type: string }) => void) | undefined;
  let abortCalls = 0;
  let aborted = false;
  const child: FakeChild = {
    abortCalls: 0,
    async start() {
      if (opts.startFail) throw new Error("ENOENT pi");
    },
    async promptAndWait() {
      if (opts.fail) throw new Error("child exited");
      for (let i = 0; i < (opts.nestedToolcallEvents ?? 0); i++) {
        handler?.({ type: "message_update" });
      }
      for (let i = 0; i < (opts.toolEvents ?? 0); i++) {
        handler?.({ type: TOOL_START });
      }
      while (opts.hangUntilAbort && !aborted) {
        await Bun.sleep(1);
      }
    },
    async abort() {
      aborted = true;
      abortCalls += 1;
      child.abortCalls = abortCalls;
    },
    async getState() {
      return { model: { id: "frozen-model" }, sessionFile: opts.sessionFile ?? "/s.jsonl" };
    },
    onEvent(h) {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
    async close() {},
    getLastAssistantText: opts.rpcText !== undefined ? () => opts.rpcText ?? null : undefined,
  };
  return child;
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
    const fake = makeFakeChild({ toolEvents: 15 });
    const out = await runPiInvestigation("go", { client: fake });
    expect(fake.abortCalls).toBe(1);
    expect(out.aborted).toBe(true);
    expect(out.toolCallCount).toBe(15);
  });

  test("child start failure throws PiHostError", async () => {
    const fake = makeFakeChild({ startFail: true });
    await expect(runPiInvestigation("go", { client: fake })).rejects.toBeInstanceOf(PiHostError);
  });

  test("nested toolcall_start does not double-count with tool_execution_start", async () => {
    const fake = makeFakeChild({ toolEvents: 8, nestedToolcallEvents: 15 });
    const out = await runPiInvestigation("go", { client: fake });
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

  test("prefers last assistant text from the session file", async () => {
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
    const fake = makeFakeChild({ sessionFile: file, rpcText: "from rpc" });
    const out = await runPiInvestigation("go", { client: fake });
    expect(out.text).toContain("false_positive");
  });

  test("wall wait abort sets aborted", async () => {
    const fake = makeFakeChild({ hangUntilAbort: true });
    const out = await runPiInvestigation("go", {
      client: fake,
      wait: async () => {},
    });
    expect(out.aborted).toBe(true);
    expect(fake.abortCalls).toBe(1);
  });

  test("createPiClient spawn env stays Gerbang/Pi only", () => {
    const src = readFileSync("src/pi-host.ts", "utf8");
    expect(src).not.toMatch(/CORALOGIX|SECRET_MANAGER|TOOL_LAYER/);
  });
});
