import { describe, expect, test } from "bun:test";
import { runModelFor } from "../src/model-override";

const zenEnvironment = { OPENCODE_ZEN_API_KEY: "zen-test-key" };

describe("the model a run is forced onto", () => {
  test("no choice forwarded means the Bot's own model", () => {
    expect(runModelFor(undefined, zenEnvironment)).toEqual({ kind: "default" });
    expect(runModelFor({}, zenEnvironment)).toEqual({ kind: "default" });
    expect(runModelFor({ openbotModel: "  " }, zenEnvironment)).toEqual({
      kind: "default",
    });
  });

  test("a Zen chat model is answered by Zen with the key this process holds", () => {
    expect(
      runModelFor(
        { openbotModel: "opencode-zen/glm-5.3-flash" },
        {
          ...zenEnvironment,
          OPENCODE_ZEN_BASE_URL: "https://zen.test/v1/",
        },
      ),
    ).toEqual({
      kind: "zen",
      model: "glm-5.3-flash",
      apiKey: "zen-test-key",
      baseURL: "https://zen.test/v1",
    });
  });

  test("defaults Zen's address", () => {
    expect(
      runModelFor({ openbotModel: "opencode-zen/kimi-k3" }, zenEnvironment),
    ).toMatchObject({ baseURL: "https://opencode.ai/zen/v1" });
  });

  test("refuses, with a reason, what it cannot call", () => {
    for (const [choice, environment] of [
      ["opencode-zen/glm-5.3-flash", {}],
      ["opencode-zen/gpt-5.5", zenEnvironment],
      ["opencode-zen/claude-sonnet-4-5", zenEnvironment],
      ["anthropic/claude-sonnet-4-5", zenEnvironment],
      ["openai/gpt-5.6-terra", zenEnvironment],
      ["nonsense", zenEnvironment],
    ] as const) {
      const outcome = runModelFor({ openbotModel: choice }, environment);
      expect(outcome.kind).toBe("refused");
    }
  });

  test("an OpenAI chat model runs on the Bot's own client", () => {
    expect(
      runModelFor({ openbotModel: "openai/gpt-5.5" }, zenEnvironment),
    ).toEqual({ kind: "openai", model: "gpt-5.5" });
  });
});
