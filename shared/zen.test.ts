import { describe, expect, test } from "bun:test";
import { MODEL_PROVIDERS } from "./model-providers";
import {
  parseModelChoice,
  ZEN_DEFAULT_BASE_URL,
  ZEN_FALLBACK_MODELS,
  zenApiFor,
  zenApiKey,
  zenBaseUrl,
} from "./zen";

describe("OpenCode Zen provider facts", () => {
  test("is in the shared provider file under the names the docs use", () => {
    expect(MODEL_PROVIDERS["opencode-zen"].keyVariable).toBe(
      "OPENCODE_ZEN_API_KEY",
    );
    expect(MODEL_PROVIDERS["opencode-zen"].baseUrlVariable).toBe(
      "OPENCODE_ZEN_BASE_URL",
    );
    expect(MODEL_PROVIDERS["opencode-zen"].label).toBe("OpenCode Zen");
  });

  test("the default model is one the fallback list offers, and is served by chat completions", () => {
    const fallback = ZEN_FALLBACK_MODELS as readonly string[];
    const model = MODEL_PROVIDERS["opencode-zen"].defaultModel;
    expect(fallback).toContain(model);
    expect(zenApiFor(model)).toBe("chat");
  });

  test("every fallback model is one a Bot can drive", () => {
    for (const model of ZEN_FALLBACK_MODELS) {
      expect(zenApiFor(model)).not.toBe("unsupported");
    }
  });

  test("base URL defaults to Zen's, honours an override, and drops trailing slashes", () => {
    expect(zenBaseUrl({})).toBe(ZEN_DEFAULT_BASE_URL);
    expect(zenBaseUrl({ OPENCODE_ZEN_BASE_URL: "   " })).toBe(
      ZEN_DEFAULT_BASE_URL,
    );
    expect(
      zenBaseUrl({ OPENCODE_ZEN_BASE_URL: " https://gateway.test/zen/v1// " }),
    ).toBe("https://gateway.test/zen/v1");
  });

  test("a blank key is no key", () => {
    expect(zenApiKey({ OPENCODE_ZEN_API_KEY: "  " })).toBeUndefined();
    expect(zenApiKey({ OPENCODE_ZEN_API_KEY: " k " })).toBe("k");
  });
});

describe("which wire format answers a Zen model", () => {
  test.each([
    ["glm-5.3-flash", "chat"],
    ["kimi-k3", "chat"],
    ["deepseek-v4-pro", "chat"],
    ["big-pickle", "chat"],
    ["qwen3.8-max", "chat"],
    ["gpt-5.5", "responses"],
    ["grok-5", "responses"],
    ["claude-sonnet-4-5", "messages"],
    ["qwen3.8-flash", "messages"],
    ["qwen3.8-plus", "messages"],
    ["gemini-3-pro", "unsupported"],
    ["jev-1", "unsupported"],
    // Not in any list: assumed to be chat, which is what most new entries are.
    ["some-new-model", "chat"],
  ])("%s is %s", (id, api) => {
    expect(zenApiFor(id)).toBe(api as ReturnType<typeof zenApiFor>);
  });
});

describe("a stored model choice", () => {
  test("splits at the first slash, so a model may contain one", () => {
    expect(parseModelChoice("opencode-zen/glm-5.3-flash")).toEqual({
      provider: "opencode-zen",
      model: "glm-5.3-flash",
    });
    expect(parseModelChoice("openai/org/model")).toEqual({
      provider: "openai",
      model: "org/model",
    });
  });

  test.each([
    [""],
    ["  "],
    [null],
    [undefined],
    ["noslash"],
    ["/model"],
    ["p/"],
  ])("%p is no choice", (value) => {
    expect(parseModelChoice(value)).toBeNull();
  });
});
