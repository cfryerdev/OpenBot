import { MODEL_PROVIDERS } from "@openbot/shared/model-providers";
import { type ModelOption, zenApiFor } from "@openbot/shared/zen";
import { createZenCatalog, type ZenCatalog } from "./zen";

/** What the model dropdown on a Bot's form shows. */
export type ModelCatalog = {
  /**
   * The first entry, always: the Bot uses whatever the deployment is configured to run
   * (`BOT_PROVIDER` / `BOT_MODEL` / the tenant package). Stored as no model at all.
   */
  auto: { value: ""; label: string };
  options: ModelOption[];
  zen: { configured: boolean; live: boolean };
};

/**
 * The models a Bot may be forced onto.
 *
 * Zen's list is read from Zen when `OPENCODE_ZEN_API_KEY` is set, with a built-in fallback when Zen
 * does not answer. The other providers offer their default model from the shared provider file when
 * their key is present in this process's environment; Zen is the only gateway whose catalogue is
 * read live, since OpenAI and Anthropic names are already a free-text decision for the deployment
 * (`BOT_MODEL`).
 */
export function createModelCatalog(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  zenCatalog: () => Promise<ZenCatalog> = createZenCatalog({ environment }),
): () => Promise<ModelCatalog> {
  return async () => {
    const options: ModelOption[] = [];
    for (const id of ["openai", "anthropic"] as const) {
      const spec = MODEL_PROVIDERS[id];
      if (environment[spec.keyVariable]?.trim()) {
        options.push({
          value: `${id}/${spec.defaultModel}`,
          label: spec.defaultModel,
          provider: id,
          providerLabel: spec.label,
        });
      }
    }
    const zen = await zenCatalog();
    options.push(...zen.models);
    return {
      auto: { value: "", label: "Auto (deployment default)" },
      options,
      zen: { configured: zen.configured, live: zen.live },
    };
  };
}

/**
 * Whether a stored or submitted model choice is one this deployment can honour.
 *
 * Shape only for providers other than Zen: `provider/model` with a provider this deployment knows
 * how to build. Zen additionally has to be a model Zen's formats support. A choice naming a model
 * that has since left Zen's catalogue is still accepted, because the catalogue is live and a Bot
 * should not become uneditable the day Zen retires a model; the run says plainly if Zen refuses it.
 */
export function modelChoiceProblem(value: string): string | null {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1 || value.length > 200) {
    return "Model must look like provider/model, or be left empty for the default.";
  }
  const provider = value.slice(0, slash);
  const model = value.slice(slash + 1);
  if (provider === "opencode-zen") {
    return zenApiFor(model) === "unsupported"
      ? "That OpenCode Zen model is not supported by OpenBot."
      : null;
  }
  if (provider === "openai" || provider === "anthropic") return null;
  return `Model provider ${provider} is not supported. Use openai, anthropic or opencode-zen.`;
}
