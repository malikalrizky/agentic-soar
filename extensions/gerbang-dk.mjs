function parseProviderModels(raw = process.env.GERBANG_PI_MODELS_JSON ?? "[]") {
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("GERBANG_PI_MODELS_JSON must be a non-empty array");
  }
  return value;
}

export default function gerbangDk(pi) {
  const baseURL = process.env.GERBANG_ADAPTER_BASE_URL?.trim();
  const apiKey = process.env.GERBANG_ADAPTER_API_KEY?.trim();
  if (!baseURL || !apiKey) {
    throw new Error("Gerbang adapter configuration is missing");
  }
  const parsedURL = new URL(baseURL);
  if (parsedURL.protocol !== "http:" && parsedURL.protocol !== "https:") {
    throw new Error("Gerbang adapter URL must use HTTP or HTTPS");
  }
  pi.registerProvider("dk", {
    name: "dk",
    baseUrl: parsedURL.toString(),
    apiKey: "$GERBANG_ADAPTER_API_KEY",
    api: "openai-completions",
    authHeader: true,
    models: parseProviderModels(),
  });
}
