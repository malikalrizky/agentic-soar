import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FROZEN_PI_MODEL,
  INVESTIGATION_MAX_TOOL_CALLS,
  INVESTIGATION_WALL_MS,
} from "./constants.ts";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { ensureGerbangAdapterEnv, gerbangPiModelsJson } from "./gerbang.ts";

export type PiRunOk = {
  text: string;
  modelId: string;
  sessionFile: string | null;
  toolCallCount: number;
  aborted: boolean;
};

export class PiHostError extends Error {
  constructor(
    message: string,
    readonly modelId: string,
  ) {
    super(message);
    this.name = "PiHostError";
  }
}

type RpcClientLike = {
  start(): Promise<void>;
  promptAndWait(message: string): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<{ model?: { id?: string }; sessionFile?: string }>;
  onEvent(handler: (e: { type: string }) => void): () => void;
  close(): Promise<void>;
  newSession?: () => Promise<void>;
  getLastAssistantText?: () => string | null | Promise<string | null>;
};

function countToolCall(event: {
  type: string;
  assistantMessageEvent?: { type: string };
}): boolean {
  return event.type === "tool_execution_start";
}

export function piRpcTimeoutMs(): number {
  return INVESTIGATION_WALL_MS + 60_000;
}

export function resolvePiCliJs(): string {
  if (process.env.PI_CLI) return process.env.PI_CLI;
  const pkg = import.meta.resolve("@earendil-works/pi-coding-agent");
  return fileURLToPath(new URL("./bundle/cli.js", pkg));
}

export function gerbangDkExtensionPath(): string {
  return fileURLToPath(new URL("../extensions/gerbang-dk.mjs", import.meta.url));
}

function lastAssistantTextFromSession(sessionFile: string): string {
  let raw: string;
  try {
    raw = readFileSync(sessionFile, "utf8");
  } catch {
    return "";
  }
  let last = "";
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let rec: { type?: string; message?: { role?: string; content?: unknown } };
    try {
      rec = JSON.parse(line) as typeof rec;
    } catch {
      continue;
    }
    if (rec.type !== "message" || rec.message?.role !== "assistant") continue;
    const content = rec.message.content;
    if (!Array.isArray(content)) continue;
    const texts: string[] = [];
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "text" &&
        typeof (part as { text?: string }).text === "string"
      ) {
        texts.push((part as { text: string }).text);
      }
    }
    if (texts.length > 0) last = texts.join("\n");
  }
  return last;
}

export function piSpawnArgs(opts: { sessionDir: string; systemPromptPath: string }): string[] {
  return [
    "--mode",
    "rpc",
    "--no-builtin-tools",
    "-e",
    gerbangDkExtensionPath(),
    "-a",
    "--session-dir",
    opts.sessionDir,
    "--system-prompt",
    opts.systemPromptPath,
  ];
}

export async function runPiInvestigation(
  prompt: string,
  deps: {
    client?: RpcClientLike;
    now?: () => number;
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
    sessionDir?: string;
    systemPromptPath?: string;
  } = {},
): Promise<PiRunOk> {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? defaultWait;
  const owned = !deps.client;
  const client =
    deps.client ??
    createPiClient({
      sessionDir: deps.sessionDir ?? resolve("var/pi-sessions"),
      systemPromptPath: deps.systemPromptPath ?? resolve("prompts/investigation.md"),
    });
  try {
    return await runWithClient(client, prompt, now, wait);
  } finally {
    if (owned) await client.close();
  }
}

async function runWithClient(
  client: RpcClientLike,
  prompt: string,
  now: () => number,
  wait: (ms: number, signal: AbortSignal) => Promise<void>,
): Promise<PiRunOk> {
  let toolCallCount = 0;
  let aborted = false;
  const started = now();
  const cap = new AbortController();
  let unsub: () => void = () => {};

  try {
    await client.start();
    if (client.newSession) {
      await client.newSession();
    }

    unsub = client.onEvent((event) => {
      if (!countToolCall(event)) return;
      toolCallCount += 1;
      if (toolCallCount >= INVESTIGATION_MAX_TOOL_CALLS && !aborted) {
        aborted = true;
        cap.abort();
        void client.abort();
      }
    });

    const wallTimer = wait(INVESTIGATION_WALL_MS, cap.signal)
      .then(async () => {
        if (!aborted) {
          aborted = true;
          await client.abort();
        }
      })
      .catch(() => undefined);

    try {
      await client.promptAndWait(prompt);
      if (now() - started >= INVESTIGATION_WALL_MS && !aborted) {
        aborted = true;
        await client.abort();
      }
    } finally {
      cap.abort();
      await wallTimer;
      unsub();
    }
  } catch (err) {
    cap.abort();
    unsub();
    let modelId = "unknown";
    try {
      const state = await client.getState();
      modelId = state.model?.id ?? "unknown";
    } catch {
      // keep unknown
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new PiHostError(message, modelId);
  }
  const state = await client.getState();
  const modelId = state.model?.id ?? "unknown";
  const fromRpc = (await client.getLastAssistantText?.()) ?? "";
  const fromSession = state.sessionFile ? lastAssistantTextFromSession(state.sessionFile) : "";
  const text = fromSession || fromRpc;
  return {
    text,
    modelId,
    sessionFile: state.sessionFile ?? null,
    toolCallCount,
    aborted,
  };
}

async function defaultWait(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });
}

function createPiClient(opts: { sessionDir: string; systemPromptPath: string }): RpcClientLike {
  const adapter = ensureGerbangAdapterEnv();
  const model = process.env.PI_MODEL?.trim() || FROZEN_PI_MODEL;
  const inner = new RpcClient({
    cliPath: resolvePiCliJs(),
    provider: "dk",
    model,
    args: piSpawnArgs(opts),
    env: {
      GERBANG_ADAPTER_BASE_URL: adapter.GERBANG_ADAPTER_BASE_URL,
      GERBANG_ADAPTER_API_KEY: adapter.GERBANG_ADAPTER_API_KEY,
      GERBANG_PI_MODELS_JSON: gerbangPiModelsJson(model),
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
    },
  });
  return {
    start: () => inner.start(),
    promptAndWait: async (message) => {
      await inner.promptAndWait(message, undefined, piRpcTimeoutMs());
    },
    abort: () => inner.abort(),
    getState: () => inner.getState(),
    onEvent: (handler) => inner.onEvent((event) => handler(event)),
    close: () => inner.stop(),
    newSession: async () => {
      await inner.newSession();
    },
    getLastAssistantText: () => inner.getLastAssistantText(),
  };
}
