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
