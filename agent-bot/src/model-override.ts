import { requiresResponsesApi } from "../../shared/model-providers";
import {
  parseModelChoice,
  ZEN_PROVIDER_ID,
  zenApiFor,
  zenApiKey,
  zenBaseUrl,
} from "../../shared/zen";

/**
 * The model one run is forced onto, from the Bot's form.
 *
 * The server forwards a Bot's chosen model as `forwardedProps.openbotModel` (`provider/model`) on
 * every run. This Bot speaks `/v1/chat/completions` by hand, so it can honour:
 *
 *   - an OpenCode Zen model served over chat completions, answered by Zen with the Zen key this
 *     process holds (`OPENCODE_ZEN_API_KEY`);
 *   - an `openai/...` model on this Bot's own client.
 *
 * Anything else it cannot call this way (a Zen model served over the Responses or Messages API, an
 * Anthropic model, an OpenAI model that needs Responses) is REFUSED with a reason and not quietly
 * swapped for its own model: a person who picked a model should be told when it cannot be used.
 * `null` means no choice was forwarded and the Bot uses its own model.
 */
export type RunModel =
  | { kind: "default" }
  | { kind: "zen"; model: string; apiKey: string; baseURL: string }
  | { kind: "openai"; model: string }
  | { kind: "refused"; reason: string };

export function runModelFor(
  forwardedProps: unknown,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RunModel {
  const requested =
    forwardedProps &&
    typeof forwardedProps === "object" &&
    "openbotModel" in forwardedProps
      ? (forwardedProps as { openbotModel?: unknown }).openbotModel
      : undefined;
  if (typeof requested !== "string" || !requested.trim()) {
    return { kind: "default" };
  }
  const choice = parseModelChoice(requested);
  if (!choice) {
    return { kind: "refused", reason: `${requested} is not provider/model.` };
  }

  if (choice.provider === ZEN_PROVIDER_ID) {
    const apiKey = zenApiKey(environment);
    if (!apiKey) {
      return {
        kind: "refused",
        reason: `This Bot is set to ${requested}, but OPENCODE_ZEN_API_KEY is not set for it.`,
      };
    }
    if (zenApiFor(choice.model) !== "chat") {
      return {
        kind: "refused",
        reason: `${choice.model} is not served over Zen's chat completions API, which this Bot speaks. Pick a chat model, or use a built-in Bot for GPT, Grok and Claude models.`,
      };
    }
    return {
      kind: "zen",
      model: choice.model,
      apiKey,
      baseURL: zenBaseUrl(environment),
    };
  }

  if (choice.provider === "openai") {
    if (requiresResponsesApi(choice.model)) {
      return {
        kind: "refused",
        reason: `${choice.model} needs the Responses API, which this Bot does not speak.`,
      };
    }
    return { kind: "openai", model: choice.model };
  }

  return {
    kind: "refused",
    reason: `This Bot cannot run ${requested}: it only speaks chat completions for OpenAI and OpenCode Zen models.`,
  };
}
