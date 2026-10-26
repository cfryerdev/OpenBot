import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  type ModelOption,
  ZEN_FALLBACK_MODELS,
  ZEN_PROVIDER_ID,
  zenApiFor,
  zenApiKey,
  zenBaseUrl,
  zenModelLabel,
} from "@openbot/shared/zen";

/**
 * OpenCode Zen as a model for a built-in Bot.
 *
 * Zen is one key and one base URL in front of several vendors, and the wire format depends on the
 * model: see `shared/zen.ts`. The AI SDK client for each format is pointed at Zen's base URL and
 * handed the key from the environment, so a built-in Bot talks to Zen the way it would talk to the
 * vendor itself.
 *
 * Returned as the SDK's own model object rather than a `provider/model` string because the
 * runtime's string form only knows OpenAI, Anthropic, Google and MiniMax.
 */
export function zenLanguageModel(
  modelId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const apiKey = zenApiKey(environment);
  if (!apiKey) {
    throw new Error(
      "OPENCODE_ZEN_API_KEY is not set, so this Bot cannot use an OpenCode Zen model. Set it in .env and restart the server.",
    );
  }
  const baseURL = zenBaseUrl(environment);
  const api = zenApiFor(modelId);
  switch (api) {
    case "messages":
      return createAnthropic({ name: ZEN_PROVIDER_ID, apiKey, baseURL })(
        modelId,
      );
    case "responses":
      return createOpenAI({ name: ZEN_PROVIDER_ID, apiKey, baseURL }).responses(
        modelId,
      );
    case "chat":
      return createOpenAI({ name: ZEN_PROVIDER_ID, apiKey, baseURL }).chat(
        modelId,
      );
    default:
      throw new Error(
        `${modelId} is not a text model Zen serves through a format OpenBot can use (Gemini and Jev are not supported). Pick another model.`,
      );
  }
}

type Fetch = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * The model ids Zen offers this key, from `GET {base}/models`.
 *
 * Throws when Zen cannot be reached or refuses the key; the caller decides what the dropdown shows
 * then. Only text models a Bot can drive are returned.
 */
export async function fetchZenModelIds(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  request: Fetch = fetch as unknown as Fetch,
): Promise<string[]> {
  const apiKey = zenApiKey(environment);
  if (!apiKey) throw new Error("OPENCODE_ZEN_API_KEY is not set.");
  const response = await request(`${zenBaseUrl(environment)}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Zen answered ${response.status}.`);
  const body = (await response.json()) as { data?: { id?: unknown }[] };
  const ids = (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .filter((id) => zenApiFor(id) !== "unsupported");
  return [...new Set(ids)];
}

export function zenModelOptions(ids: readonly string[]): ModelOption[] {
  return ids.map((id) => ({
    value: `${ZEN_PROVIDER_ID}/${id}`,
    label: zenModelLabel(id),
    provider: ZEN_PROVIDER_ID,
    providerLabel: "OpenCode Zen",
  }));
}

/**
 * Where the dropdown's Zen models come from, cached so opening a form is not a request to Zen.
 *
 * Five minutes: long enough that the list is not fetched per keystroke, short enough that a model
 * Zen adds shows up the same afternoon. A failure is cached for a shorter spell and answered with
 * the fallback list, flagged, so an unreachable Zen never breaks the form.
 */
export function createZenCatalog(options?: {
  environment?: Readonly<Record<string, string | undefined>>;
  request?: Fetch;
  now?: () => number;
}) {
  const environment = options?.environment ?? process.env;
  const now = options?.now ?? Date.now;
  let cached: { at: number; ttl: number; value: ZenCatalog } | undefined;

  return async (): Promise<ZenCatalog> => {
    if (!zenApiKey(environment)) {
      return { configured: false, live: false, models: [] };
    }
    if (cached && now() - cached.at < cached.ttl) return cached.value;
    let value: ZenCatalog;
    let ttl = 5 * 60_000;
    try {
      const ids = await fetchZenModelIds(environment, options?.request);
      value = { configured: true, live: true, models: zenModelOptions(ids) };
    } catch {
      // Not logged with detail: nothing here is secret, but the reason is always "Zen is not
      // answering" to a person reading the form, and the fallback says so.
      ttl = 30_000;
      value = {
        configured: true,
        live: false,
        models: zenModelOptions(ZEN_FALLBACK_MODELS),
      };
    }
    cached = { at: now(), ttl, value };
    return value;
  };
}

export type ZenCatalog = {
  /** Whether `OPENCODE_ZEN_API_KEY` is set. */
  configured: boolean;
  /** Whether `models` came from Zen just now, rather than the built-in fallback list. */
  live: boolean;
  models: ModelOption[];
};
