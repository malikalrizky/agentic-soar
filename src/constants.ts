export const INVESTIGATION_WALL_MS = 600_000;
export const INVESTIGATION_MAX_TOOL_CALLS = 15;
export const INVESTIGATION_CAP_SUMMARY = `cap: ${INVESTIGATION_WALL_MS / 60_000}m or ${INVESTIGATION_MAX_TOOL_CALLS} tool calls`;
export const FROZEN_PI_MODEL = "dk/openrouter/deepseek/deepseek-v4.1-flash";
export const GERBANG_PROXY_APPLICATION = "agentic-soar";
// Vertex fallback for hosts without gerbang (e.g. GCE VM with an attached SA). See DEVSECOPS-3089.
export const VERTEX_PI_MODEL = "gemini-2.5-flash";
