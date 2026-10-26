import { describe, expect, test } from "bun:test";
import { modelChoiceProblem, createModelCatalog } from "../src/models/catalog";
import {
  createZenCatalog,
  fetchZenModelIds,
  zenLanguageModel,
} from "../src/models/zen";
import {
  modelForBuiltInAgent,
  registeredAgentFromRow,
  runtimeModelForEnvironment,
} from "../src/copilot";
import { resolveModelApiKey } from "../src/credentials";
import { createModelCompleter } from "../src/routing/model";

const KEY = "zen-test-key-not-a-secret";
const packageModel = {
  provider: "openai" as const,
  defaultModel: "gpt-5.6-terra",
};

function zenResponse(ids: string[], status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  });
}

describe("reading Zen's model list", () => {
  test("asks {base}/models with the key as a bearer token, and drops what a Bot cannot drive", async () => {
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    const ids = await fetchZenModelIds(
      {
        OPENCODE_ZEN_API_KEY: KEY,
        OPENCODE_ZEN_BASE_URL: "https://zen.test/v1/",
      },
      async (url, init) => {
        seen.push({ url, headers: init?.headers });
        return zenResponse([
          "glm-5.3",
          "gemini-3",
          "glm-5.3",
          "jev-1",
          "gpt-5.5",
        ])();
      },
    );
    expect(ids).toEqual(["glm-5.3", "gpt-5.5"]);
    expect(seen[0]?.url).toBe("https://zen.test/v1/models");
    expect(seen[0]?.headers?.authorization).toBe(`Bearer ${KEY}`);
  });

  test("refuses without a key and on a non-2xx answer", async () => {
    await expect(fetchZenModelIds({})).rejects.toThrow("not set");
    await expect(
      fetchZenModelIds({ OPENCODE_ZEN_API_KEY: KEY }, zenResponse([], 401)),
    ).rejects.toThrow("401");
  });
});

describe("the catalogue the dropdown shows", () => {
  test("is empty and unconfigured without a key", async () => {
    const catalog = await createZenCatalog({ environment: {} })();
    expect(catalog).toEqual({ configured: false, live: false, models: [] });
  });

  test("is live when Zen answers, as provider/model values", async () => {
    const catalog = await createZenCatalog({
      environment: { OPENCODE_ZEN_API_KEY: KEY },
      request: zenResponse(["glm-5.3-flash", "kimi-k3"]),
    })();
    expect(catalog.live).toBe(true);
    expect(catalog.models.map((model) => model.value)).toEqual([
      "opencode-zen/glm-5.3-flash",
      "opencode-zen/kimi-k3",
    ]);
  });

  test("falls back, flagged, when Zen is down, and never throws", async () => {
    const catalog = await createZenCatalog({
      environment: { OPENCODE_ZEN_API_KEY: KEY },
      request: async () => {
        throw new Error("offline");
      },
    })();
    expect(catalog.configured).toBe(true);
    expect(catalog.live).toBe(false);
    expect(catalog.models.length).toBeGreaterThan(0);
  });

  test("is cached for a spell", async () => {
    let calls = 0;
    let now = 0;
    const read = createZenCatalog({
      environment: { OPENCODE_ZEN_API_KEY: KEY },
      now: () => now,
      request: async () => {
        calls += 1;
        return zenResponse(["glm-5.3"])();
      },
    });
    await read();
    now = 60_000;
    await read();
    expect(calls).toBe(1);
    now = 6 * 60_000;
    await read();
    expect(calls).toBe(2);
  });

  test("the full list leads with Auto and carries other keyed providers' defaults", async () => {
    const list = await createModelCatalog(
      { OPENCODE_ZEN_API_KEY: KEY, ANTHROPIC_API_KEY: "x" },
      createZenCatalog({
        environment: { OPENCODE_ZEN_API_KEY: KEY },
        request: zenResponse(["glm-5.3"]),
      }),
    )();
    expect(list.auto.value).toBe("");
    expect(list.options.map((option) => option.provider)).toEqual([
      "anthropic",
      "opencode-zen",
    ]);
    expect(list.zen).toEqual({ configured: true, live: true });
  });

  test("offers nothing to choose between without any key", async () => {
    const list = await createModelCatalog({})();
    expect(list.options).toEqual([]);
    expect(list.zen.configured).toBe(false);
  });
});

describe("validating a chosen model", () => {
  test.each([
    ["opencode-zen/glm-5.3-flash", null],
    ["openai/gpt-5.5", null],
    ["anthropic/claude-sonnet-4-5", null],
  ])("accepts %s", (value, problem) => {
    expect(modelChoiceProblem(value)).toBe(problem);
  });

  test.each([
    ["glm-5.3"],
    ["/x"],
    ["opencode-zen/"],
    ["mystery/model"],
    ["opencode-zen/gemini-3-pro"],
  ])("refuses %s", (value) => {
    expect(modelChoiceProblem(value)).toEqual(expect.any(String));
  });
});

describe("which model a Bot runs on", () => {
  test("a Bot with no choice runs on the deployment's model and key", () => {
    expect(
      modelForBuiltInAgent({ name: "A" }, packageModel, "sk-deploy"),
    ).toEqual({ model: "openai/gpt-5.6-terra", apiKey: "sk-deploy" });
  });

  test("a Bot forced onto an OpenAI/Anthropic model uses that model, and the key for that provider", () => {
    expect(
      modelForBuiltInAgent(
        { name: "A", model: "anthropic/claude-sonnet-4-5" },
        packageModel,
        "sk-openai",
        undefined,
        { ANTHROPIC_API_KEY: "sk-anthropic" },
      ),
    ).toEqual({ model: "anthropic/claude-sonnet-4-5", apiKey: "sk-anthropic" });
  });

  test("a Bot forced onto a Zen model gets a Zen model object whatever the deployment runs", () => {
    const chosen = modelForBuiltInAgent(
      { name: "A", model: "opencode-zen/glm-5.3-flash" },
      packageModel,
      "sk-openai",
      undefined,
      { OPENCODE_ZEN_API_KEY: KEY },
    );
    expect("problem" in chosen).toBe(false);
    if ("problem" in chosen) return;
    expect(typeof chosen.model).toBe("object");
    expect(chosen.apiKey).toBeUndefined();
    expect((chosen.model as { modelId: string }).modelId).toBe("glm-5.3-flash");
  });

  test("a forced model whose key is missing is a reason, not a different model", () => {
    const chosen = modelForBuiltInAgent(
      { name: "Scout", model: "opencode-zen/glm-5.3-flash" },
      packageModel,
      "sk-openai",
      undefined,
      {},
    );
    expect(chosen).toEqual({
      problem: expect.stringContaining("OPENCODE_ZEN_API_KEY"),
    });
  });

  test("a Zen model Zen serves in a format OpenBot cannot use is a reason", () => {
    const chosen = modelForBuiltInAgent(
      { name: "Scout", model: "opencode-zen/gemini-3-pro" },
      packageModel,
      null,
      undefined,
      { OPENCODE_ZEN_API_KEY: KEY },
    );
    expect("problem" in chosen).toBe(true);
  });

  test("Zen model objects pick the SDK for their wire format", () => {
    const environment = { OPENCODE_ZEN_API_KEY: KEY };
    expect(zenLanguageModel("glm-5.3", environment).provider).toBe(
      "opencode-zen.chat",
    );
    expect(zenLanguageModel("gpt-5.5", environment).provider).toBe(
      "opencode-zen.responses",
    );
    // The Anthropic SDK names the provider as given, with no suffix: it is the one that is neither.
    expect(zenLanguageModel("claude-sonnet-4-5", environment).provider).toBe(
      "opencode-zen",
    );
    expect(() => zenLanguageModel("gemini-3", environment)).toThrow(
      "not a text model",
    );
    expect(() => zenLanguageModel("glm-5.3", {})).toThrow(
      "OPENCODE_ZEN_API_KEY",
    );
  });

  test("the choice is read off a stored row, and a bad one is ignored", () => {
    const row = (model: unknown) => ({
      id: "b",
      name: "B",
      type: "built_in" as const,
      configuration: { systemPrompt: "Be B.", model },
      title: "t",
      roleDescription: "r",
    });
    expect(registeredAgentFromRow(row("opencode-zen/kimi-k3"))).toMatchObject({
      model: "opencode-zen/kimi-k3",
    });
    expect(registeredAgentFromRow(row("nonsense"))).not.toHaveProperty("model");
    expect(registeredAgentFromRow(row(42))).not.toHaveProperty("model");
    const remote = registeredAgentFromRow({
      id: "r",
      name: "R",
      type: "remote_ag_ui",
      configuration: {
        endpoint: "https://bot.test/ag-ui",
        model: "opencode-zen/kimi-k3",
      },
      title: "t",
      roleDescription: "r",
    });
    expect(remote).toMatchObject({ model: "opencode-zen/kimi-k3" });
  });
});

describe("OpenCode Zen as the deployment's model", () => {
  test("BOT_PROVIDER=opencode-zen selects it, with the default model", () => {
    expect(
      runtimeModelForEnvironment(packageModel, {
        BOT_PROVIDER: "opencode-zen",
      }),
    ).toMatchObject({
      provider: "opencode-zen",
      defaultModel: "glm-5.3-flash",
    });
  });

  test("BOT_MODEL names the Zen model", () => {
    expect(
      runtimeModelForEnvironment(packageModel, {
        BOT_PROVIDER: "opencode-zen",
        BOT_MODEL: "kimi-k3",
      }),
    ).toMatchObject({ provider: "opencode-zen", defaultModel: "kimi-k3" });
  });

  test("a Zen key alone is enough", () => {
    expect(
      runtimeModelForEnvironment(packageModel, { OPENCODE_ZEN_API_KEY: KEY }),
    ).toMatchObject({ provider: "opencode-zen" });
  });

  test.each([
    [{ OPENCODE_ZEN_API_KEY: KEY, OPENAI_API_KEY: "sk" }],
    [{ OPENCODE_ZEN_API_KEY: KEY, ANTHROPIC_API_KEY: "sk" }],
    [{ OPENCODE_ZEN_API_KEY: KEY, BOT_PROVIDER: "openai" }],
    [{ OPENCODE_ZEN_API_KEY: KEY, BOT_PROVIDER: "" }],
    [{}],
  ])(
    "another key or an explicit provider keeps the deployment where it was: %p",
    (environment) => {
      expect(
        runtimeModelForEnvironment(packageModel, environment).provider,
      ).toBe("openai");
    },
  );

  test("the key is read from the environment only, never the vault", async () => {
    const reader = {
      readModelSecret: async () => {
        throw new Error("must not be asked");
      },
    };
    expect(
      await resolveModelApiKey({
        encryptionKey: "unused",
        reader,
        provider: "opencode-zen",
        keyId: "x",
        environment: { OPENCODE_ZEN_API_KEY: ` ${KEY} ` },
      }),
    ).toBe(KEY);
    expect(
      await resolveModelApiKey({
        encryptionKey: "unused",
        reader,
        provider: "opencode-zen",
        keyId: "x",
        environment: {},
      }),
    ).toBeNull();
  });

  test("the router calls Zen's chat completions with the key, and soft-fails for other formats", async () => {
    const original = globalThis.fetch;
    const calls: {
      url: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
    }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
      });
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    }) as unknown as typeof fetch;
    const previous = process.env.OPENCODE_ZEN_BASE_URL;
    process.env.OPENCODE_ZEN_BASE_URL = "https://zen.test/v1";
    try {
      const complete = createModelCompleter({
        model: { provider: "opencode-zen", defaultModel: "glm-5.3-flash" },
        resolveApiKey: async () => KEY,
      });
      expect(await complete("hello")).toBe("{}");
      expect(calls[0]?.url).toBe("https://zen.test/v1/chat/completions");
      expect(calls[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(calls[0]?.body.model).toBe("glm-5.3-flash");
      expect(calls[0]?.body).not.toHaveProperty("response_format");

      const unsupported = createModelCompleter({
        model: { provider: "opencode-zen", defaultModel: "claude-sonnet-4-5" },
        resolveApiKey: async () => KEY,
      });
      await expect(unsupported("hello")).rejects.toThrow("chat endpoint");
      expect(calls).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
      if (previous === undefined) delete process.env.OPENCODE_ZEN_BASE_URL;
      else process.env.OPENCODE_ZEN_BASE_URL = previous;
    }
  });
});
