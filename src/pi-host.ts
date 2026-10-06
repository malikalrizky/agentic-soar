import { fileURLToPath } from "node:url";
import {
  INVESTIGATION_MAX_TOOL_CALLS,
  INVESTIGATION_WALL_MS,
} from "./constants.ts";
import { RpcClient } from "@earendil-works/pi-coding-agent";

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

export type RpcClientLike = {
  start(): Promise<void>;
  promptAndWait(message: string): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<{ model?: { id?: string }; sessionFile?: string }>;
  onEvent(handler: (e: { type: string }) => void): () => void;
  close(): Promise<void>;
  newSession?: () => Promise<void>;
  getLastAssistantText?: () => string | null | Promise<string | null>;
};

export function countToolCall(event: {
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

export function piSpawnArgs(opts: { sessionDir: string; systemPromptPath: string }): string[] {
  return [
    "--mode",
    "rpc",
    "--no-builtin-tools",
    "-a",
    "--session-dir",
    opts.sessionDir,
    "--system-prompt",
    opts.systemPromptPath,
  ];
}

export async function runPiInvestigation(
  client: RpcClientLike,
  prompt: string,
  now: () => number = Date.now,
  wait: (ms: number, signal: AbortSignal) => Promise<void> = defaultWait,
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
  const text = (await client.getLastAssistantText?.()) ?? "";
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

export function createPiClient(opts: { sessionDir: string; systemPromptPath: string }): RpcClientLike {
  const inner = new RpcClient({
    cliPath: resolvePiCliJs(),
    args: piSpawnArgs(opts),
    ...(process.env.PI_MODEL ? { model: process.env.PI_MODEL } : {}),
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
