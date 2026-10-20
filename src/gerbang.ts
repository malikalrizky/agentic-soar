import { spawnSync } from "node:child_process";
import { FROZEN_PI_MODEL, GERBANG_PROXY_APPLICATION } from "./constants.ts";

export type GerbangAdapterEnv = {
  GERBANG_ADAPTER_BASE_URL: string;
  GERBANG_ADAPTER_API_KEY: string;
};

export type ProxyRun = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export function parseGerbangProxyOutput(text: string): GerbangAdapterEnv {
  const base = text.match(/^OPENAI_BASE_URL=(.+)$/m)?.[1]?.trim();
  const key = text.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim();
  if (!base || !key) {
    throw new Error("gerbang proxy did not print OPENAI_BASE_URL and OPENAI_API_KEY");
  }
  return {
    GERBANG_ADAPTER_BASE_URL: base,
    GERBANG_ADAPTER_API_KEY: key,
  };
}

export type GerbangPiChild = {
  cliPath: string;
  args: string[];
  env: Record<string, string>;
};

export type PiProviderMode = "gerbang-dk" | "google-vertex";

export function resolvePiProviderMode(env: NodeJS.ProcessEnv = process.env): PiProviderMode {
  const mode = env.PI_PROVIDER?.trim();
  if (mode === "google-vertex") return "google-vertex";
  return "gerbang-dk";
}

export function vertexPiArgs(opts: {
  sessionDir: string;
  systemPromptPath: string;
}): string[] {
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

export function vertexPiChild(opts: {
  cliPath: string;
  sessionDir: string;
  systemPromptPath: string;
  processEnv?: NodeJS.ProcessEnv;
}): GerbangPiChild {
  const processEnv = opts.processEnv ?? process.env;
  const project = processEnv.GOOGLE_CLOUD_PROJECT?.trim();
  const location = processEnv.GOOGLE_CLOUD_LOCATION?.trim() || "asia-southeast1";
  if (!project) {
    throw new Error("PI_PROVIDER=google-vertex requires GOOGLE_CLOUD_PROJECT");
  }
  return {
    cliPath: opts.cliPath,
    args: vertexPiArgs(opts),
    env: {
      GOOGLE_CLOUD_PROJECT: project,
      GOOGLE_CLOUD_LOCATION: location,
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
    },
  };
}

export function gerbangPiArgs(opts: {
  extensionPath: string;
  sessionDir: string;
  systemPromptPath: string;
}): string[] {
  return [
    "--mode",
    "rpc",
    "--no-builtin-tools",
    "-e",
    opts.extensionPath,
    "-a",
    "--session-dir",
    opts.sessionDir,
    "--system-prompt",
    opts.systemPromptPath,
  ];
}

export function gerbangPiChild(opts: {
  cliPath: string;
  extensionPath: string;
  sessionDir: string;
  systemPromptPath: string;
  processEnv?: NodeJS.ProcessEnv;
  runProxy?: () => ProxyRun;
}): GerbangPiChild {
  const processEnv = opts.processEnv ?? process.env;
  const adapter = ensureGerbangAdapterEnv(processEnv, opts.runProxy);
  const model = processEnv.PI_MODEL?.trim() || FROZEN_PI_MODEL;
  return {
    cliPath: opts.cliPath,
    args: gerbangPiArgs(opts),
    env: {
      GERBANG_ADAPTER_BASE_URL: adapter.GERBANG_ADAPTER_BASE_URL,
      GERBANG_ADAPTER_API_KEY: adapter.GERBANG_ADAPTER_API_KEY,
      GERBANG_PI_MODELS_JSON: gerbangPiModelsJson(model),
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
    },
  };
}

export function gerbangPiModelsJson(modelId = FROZEN_PI_MODEL): string {
  return JSON.stringify([
    {
      id: modelId,
      name: "DeepSeek V4.1 Flash",
      reasoning: false,
      input: ["text"],
      contextWindow: 1_048_576,
      maxTokens: 943_718,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ]);
}

export function ensureGerbangAdapterEnv(
  env: NodeJS.ProcessEnv = process.env,
  runProxy: () => ProxyRun = defaultGerbangProxy,
): GerbangAdapterEnv {
  const existingBase = env.GERBANG_ADAPTER_BASE_URL?.trim() || env.OPENAI_BASE_URL?.trim();
  const existingKey = env.GERBANG_ADAPTER_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (existingBase && existingKey) {
    return {
      GERBANG_ADAPTER_BASE_URL: existingBase,
      GERBANG_ADAPTER_API_KEY: existingKey,
    };
  }
  const result = runProxy();
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim() || `exit ${result.status}`;
    throw new Error(`gerbang proxy failed: ${detail}`);
  }
  return parseGerbangProxyOutput(result.stdout);
}

function defaultGerbangProxy(): ProxyRun {
  const result = spawnSync("gerbang", ["proxy", "--application", GERBANG_PROXY_APPLICATION], {
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
