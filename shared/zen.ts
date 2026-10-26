/**
 * What every process in the box needs to know about OpenCode Zen, the pay-as-you-go model gateway at
 * opencode.ai.
 *
 * Zen is one key in front of many vendors' models, and it does not speak one API: the model decides
 * which wire format answers it. This module is the single place that says which, so the API server
 * (built-in Bots, the model dropdown) and `agent-bot` cannot disagree about it.
 *
 *   - `chat`      `POST {base}/chat/completions`, OpenAI-compatible. GLM, Kimi, DeepSeek, MiniMax,
 *                 Mistral, Qwen Max, Big Pickle and the free models.
 *   - `responses` `POST {base}/responses`, the OpenAI Responses API. GPT, Grok and Muse models.
 *   - `messages`  `POST {base}/messages`, the Anthropic Messages API. Claude, and the Qwen Flash/Plus
 *                 models.
 *   - `unsupported` Gemini (its own `/models/{id}` API) and Jev (a "System One" decision API that
 *                 does not generate text). Not offered, because a Bot cannot drive them.
 *
 * The `/models` endpoint lists ids only and says nothing about the wire format, so the format is
 * inferred from the id. A model Zen adds later that follows none of these patterns is assumed to be
 * `chat`, which is what most new entries have been.
 *
 * Environment: `OPENCODE_ZEN_API_KEY` is the key, `OPENCODE_ZEN_BASE_URL` overrides the endpoint.
 * The key is never in this file and never logged by anything that imports it.
 */

export const ZEN_PROVIDER_ID = "opencode-zen";

/** Where Zen answers unless `OPENCODE_ZEN_BASE_URL` says otherwise. */
export const ZEN_DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";

export type ZenApi = "chat" | "responses" | "messages" | "unsupported";

/** The endpoint, with trailing slashes removed so `${base}/models` is always well formed. */
export function zenBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (env.OPENCODE_ZEN_BASE_URL?.trim() || ZEN_DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

/** The key, or nothing when this deployment has not configured Zen. */
export function zenApiKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return env.OPENCODE_ZEN_API_KEY?.trim() || undefined;
}

/** Which wire format answers this model id. See the module comment. */
export function zenApiFor(modelId: string): ZenApi {
  const id = modelId.trim().toLowerCase();
  if (id.startsWith("gemini-") || id.startsWith("jev-")) return "unsupported";
  if (id.startsWith("claude-")) return "messages";
  if (/^qwen3\.\d+-(flash|plus)$/.test(id)) return "messages";
  if (/^(gpt-|grok-|muse-)/.test(id)) return "responses";
  return "chat";
}

/** One entry in the model dropdown. */
export type ModelOption = {
  /** What is stored on the Bot and sent back: `provider/model`, e.g. `opencode-zen/glm-5.3-flash`. */
  value: string;
  /** What the person reads. */
  label: string;
  /** The provider's id, for grouping. */
  provider: string;
  /** The provider's name, for the group heading. */
  providerLabel: string;
};

/** Split a stored `provider/model` value. Null when it is not one. */
export function parseModelChoice(
  value: string | null | undefined,
): { provider: string; model: string } | null {
  const text = value?.trim();
  if (!text) return null;
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) return null;
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) };
}

/**
 * The models offered when Zen's `/models` cannot be reached, or the key has none to show.
 *
 * A short list of well-known ids rather than a mirror of the pricing page, which changes weekly.
 * Every one of them uses the OpenAI-compatible chat endpoint, so they work in every Bot.
 */
export const ZEN_FALLBACK_MODELS: readonly string[] = [
  "glm-5.3-flash",
  "glm-5.3",
  "kimi-k3",
  "deepseek-v4-pro",
  "minimax-m3",
  "mistral-large-4",
  "qwen3.8-max",
  "big-pickle",
];

/** A readable label from a model id: `glm-5.3-flash` stays itself, Zen publishes no display names. */
export function zenModelLabel(modelId: string): string {
  return modelId;
}
