import { describe, expect, it, vi } from "vitest";
import {
  applyClassifyResult,
  buildClassifySystemPrompt,
  buildClassifyUserPrompt,
  clampConfidence,
  classifyCategory,
  classifyCreateBody,
  ClassifyInputError,
  findCatalogMatch,
  hasClassifyInput,
  parseClassifyFields,
  parseClassifyLlmJson,
  resolveClassifyResult,
  sanitizeCategoryName,
  toClassifyCatalog,
  type ClassifyCatalogItem,
  type ClassifyLlmFn,
} from "./ai-classify";

const CLOTHES = "11111111-1111-4111-8111-111111111111";
const FOOD = "22222222-2222-4222-8222-222222222222";
const FUEL = "33333333-3333-4333-8333-333333333333";
const INCOME = "44444444-4444-4444-8444-444444444444";

const catalog: ClassifyCatalogItem[] = [
  { id: CLOTHES, name: "Ubrania", group_name: "Osobiste" },
  { id: FOOD, name: "Zakupy spożywcze", group_name: "Życie codzienne" },
  { id: FUEL, name: "Paliwo", group_name: "Transport" },
];

function llmJson(payload: unknown): ClassifyLlmFn {
  return vi.fn(async () => JSON.stringify(payload));
}

describe("toClassifyCatalog", () => {
  it("keeps expense envelopes and drops Przychody", () => {
    expect(
      toClassifyCatalog([
        { id: FOOD, name: "Zakupy spożywcze", group_name: "Życie codzienne", kind: "expense" },
        { id: INCOME, name: "Wynagrodzenie", group_name: "Przychody", kind: "income" },
      ])
    ).toEqual([{ id: FOOD, name: "Zakupy spożywcze", group_name: "Życie codzienne" }]);
  });
});

describe("parseClassifyFields / hasClassifyInput", () => {
  it("trims and parses amount with a comma", () => {
    expect(
      parseClassifyFields({ text: "  parasol  ", payee: "Decathlon", amount: "49,90" })
    ).toEqual({
      text: "parasol",
      payee: "Decathlon",
      memo: undefined,
      amount: 49.9,
    });
  });

  it("requires text, payee, memo, or an image", () => {
    expect(hasClassifyInput({}, false)).toBe(false);
    expect(hasClassifyInput({ text: "parasol" }, false)).toBe(true);
    expect(hasClassifyInput({}, true)).toBe(true);
  });
});

describe("parseClassifyLlmJson / clampConfidence", () => {
  it("reads fenced JSON and percent-style confidence", () => {
    const raw = parseClassifyLlmJson('Sure:\n```json\n{"action":"match","confidence":86}\n```');
    expect(raw.action).toBe("match");
    expect(clampConfidence(raw.confidence)).toBe(0.86);
    expect(clampConfidence(1.4)).toBe(1);
    expect(clampConfidence("nope")).toBe(0.5);
  });

  it("rejects non-JSON model output", () => {
    expect(() => parseClassifyLlmJson("nie wiem")).toThrow(ClassifyInputError);
  });
});

describe("findCatalogMatch / sanitizeCategoryName", () => {
  it("matches by id, exact name, or unique substring", () => {
    expect(findCatalogMatch(catalog, { id: CLOTHES })?.name).toBe("Ubrania");
    expect(findCatalogMatch(catalog, { name: "osobiste / ubrania" })?.id).toBe(CLOTHES);
    expect(findCatalogMatch(catalog, { name: "paliw" })?.id).toBe(FUEL);
    expect(findCatalogMatch(catalog, { id: "not-a-real-id" })).toBeNull();
  });

  it("caps names at 60 characters", () => {
    expect(sanitizeCategoryName("  Parasol   turystyczny  ", "x")).toBe("Parasol turystyczny");
    expect(sanitizeCategoryName("a".repeat(80), "x")).toHaveLength(60);
  });
});

describe("resolveClassifyResult", () => {
  it("returns match when the model cites a real category_id", () => {
    const result = resolveClassifyResult(
      {
        action: "match",
        category_id: CLOTHES,
        confidence: 0.91,
        reason: "Parasol to akcesorium odzieżowe.",
      },
      catalog,
      { text: "parasol" }
    );
    expect(result).toEqual({
      action: "match",
      category_id: CLOTHES,
      category_name: "Ubrania",
      group_name: "Osobiste",
      confidence: 0.91,
      reason: "Parasol to akcesorium odzieżowe.",
    });
  });

  it("resolves match by category name when the id is missing", () => {
    const result = resolveClassifyResult(
      { action: "match", category_name: "Zakupy spożywcze", confidence: 0.8, reason: "Chleb." },
      catalog,
      { text: "chleb" }
    );
    expect(result.action).toBe("match");
    if (result.action === "match") expect(result.category_id).toBe(FOOD);
  });

  it("turns a hallucinated match id into suggest_create", () => {
    const result = resolveClassifyResult(
      {
        action: "match",
        category_id: "00000000-0000-4000-8000-000000000000",
        name: "Parasole",
        group_name: "Osobiste",
        confidence: 0.9,
        reason: "Nie ma koperty na parasole.",
      },
      catalog,
      { text: "parasol" }
    );
    expect(result).toEqual({
      action: "suggest_create",
      name: "Parasole",
      group_name: "Osobiste",
      confidence: 0.55,
      reason: "Nie ma koperty na parasole.",
    });
  });

  it("keeps suggest_create for a genuinely new envelope", () => {
    const result = resolveClassifyResult(
      {
        action: "suggest_create",
        name: "Prezenty",
        group_name: "Osobiste",
        confidence: 0.7,
        reason: "Nie ma koperty na prezenty.",
      },
      catalog,
      { text: "prezent dla mamy" }
    );
    expect(result).toEqual({
      action: "suggest_create",
      name: "Prezenty",
      group_name: "Osobiste",
      confidence: 0.7,
      reason: "Nie ma koperty na prezenty.",
    });
  });

  it("collapses suggest_create onto an existing envelope when the name already exists", () => {
    const result = resolveClassifyResult(
      { action: "suggest_create", name: "Ubrania", group_name: "Osobiste", confidence: 0.6 },
      catalog,
      { text: "kurtka" }
    );
    expect(result.action).toBe("match");
    if (result.action === "match") expect(result.category_id).toBe(CLOTHES);
  });
});

describe("classifyCategory (mock LLM)", () => {
  it("asks the model with catalog + hint and returns a match", async () => {
    const llm = llmJson({
      action: "match",
      category_id: FOOD,
      confidence: 0.88,
      reason: "Mleko to zakupy spożywcze.",
    });
    const result = await classifyCategory({ text: "mleko 2%", payee: "Biedronka" }, catalog, llm);
    expect(result.action).toBe("match");
    if (result.action === "match") {
      expect(result.category_id).toBe(FOOD);
      expect(result.reason).toContain("spożywcze");
    }
    expect(llm).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(llm).mock.calls[0][0];
    expect(arg.system).toContain(FOOD);
    expect(arg.system).toContain("Zakupy spożywcze");
    expect(arg.user).toContain("mleko 2%");
    expect(arg.user).toContain("Biedronka");
    expect(arg.imageDataUrl).toBeUndefined();
  });

  it("returns suggest_create when the model proposes a new koperta", async () => {
    const result = await classifyCategory(
      { text: "parasol", payee: "Decathlon" },
      catalog,
      llmJson({
        action: "suggest_create",
        name: "Akcesoria pogodowe",
        group_name: "Osobiste",
        confidence: 0.64,
        reason: "Parasol nie pasuje do Ubrań ani zakupów.",
      })
    );
    expect(result).toMatchObject({
      action: "suggest_create",
      name: "Akcesoria pogodowe",
      group_name: "Osobiste",
    });
  });

  it("forwards a vision data URL when an image is provided", async () => {
    const llm = llmJson({
      action: "match",
      category_id: FUEL,
      confidence: 0.93,
      reason: "Paragon z Orlen — paliwo.",
    });
    const dataUrl = "data:image/jpeg;base64,abc";
    const result = await classifyCategory({ payee: "Orlen" }, catalog, llm, dataUrl);
    expect(result.action).toBe("match");
    if (result.action === "match") expect(result.category_id).toBe(FUEL);
    expect(vi.mocked(llm).mock.calls[0][0].imageDataUrl).toBe(dataUrl);
    expect(vi.mocked(llm).mock.calls[0][0].user).toContain("zdjęcie");
  });

  it("rejects an empty request without an image", async () => {
    await expect(classifyCategory({}, catalog, llmJson({ action: "match" }))).rejects.toThrow(
      ClassifyInputError
    );
  });

  it("still allows suggest_create when the budget has no envelopes yet", async () => {
    const result = await classifyCategory(
      { text: "parasol" },
      [],
      llmJson({
        action: "suggest_create",
        name: "Ubrania",
        group_name: "Osobiste",
        confidence: 0.8,
        reason: "Brak kopert — proponuję Ubrania.",
      })
    );
    expect(result).toMatchObject({ action: "suggest_create", name: "Ubrania", group_name: "Osobiste" });
  });
});

describe("prompts", () => {
  it("lists real envelope ids and asks for Polish JSON", () => {
    const system = buildClassifySystemPrompt(catalog);
    expect(system).toContain(CLOTHES);
    expect(system).toContain("Ubrania");
    expect(system).toContain("suggest_create");
    expect(buildClassifyUserPrompt({ text: "kawa" }, false)).toBe("Opis: kawa");
  });

  it("teaches suggest_create for parasol instead of stretching to Ubrania", () => {
    const system = buildClassifySystemPrompt(catalog);
    expect(system).toMatch(/parasol[\s\S]*suggest_create|suggest_create[\s\S]*parasol/i);
    expect(system).toContain("to nie Ubrania");
    expect(system).not.toMatch(/parasol\s*→\s*Ubrania/);
    expect(system).toContain("mleko");
    expect(system).toContain("Zakupy spożywcze");
  });
});

describe("applyClassifyResult (Szczegóły transakcji)", () => {
  it("match assigns the existing envelope and does not create", async () => {
    const assigned: string[] = [];
    const createEnvelope = vi.fn();
    const applied = await applyClassifyResult(
      {
        action: "match",
        category_id: FOOD,
        category_name: "Zakupy spożywcze",
        group_name: "Życie codzienne",
        confidence: 0.9,
        reason: "Mleko.",
      },
      {
        createEnvelope,
        assign: async (id) => {
          assigned.push(id);
        },
      }
    );
    expect(applied).toEqual({ categoryId: FOOD, created: false, name: "Zakupy spożywcze" });
    expect(assigned).toEqual([FOOD]);
    expect(createEnvelope).not.toHaveBeenCalled();
  });

  it("suggest_create posts a new envelope then assigns it (parasol)", async () => {
    const assigned: string[] = [];
    const createdId = "55555555-5555-4555-8555-555555555555";
    const suggestion = {
      action: "suggest_create" as const,
      name: "Parasol",
      group_name: "Osobiste",
      confidence: 0.7,
      reason: "Brak koperty na parasol.",
    };
    expect(classifyCreateBody(suggestion)).toEqual({
      group_name: "Osobiste",
      name: "Parasol",
      kind: "expense",
    });
    const applied = await applyClassifyResult(suggestion, {
      createEnvelope: async (body) => {
        expect(body).toEqual({ group_name: "Osobiste", name: "Parasol", kind: "expense" });
        return { id: createdId };
      },
      assign: async (id) => {
        assigned.push(id);
      },
    });
    expect(applied).toEqual({ categoryId: createdId, created: true, name: "Parasol" });
    expect(assigned).toEqual([createdId]);
  });

  it("uses Życie codzienne when suggest_create omits a group", () => {
    expect(
      classifyCreateBody({
        action: "suggest_create",
        name: "Parasol",
        group_name: null,
        confidence: 0.6,
        reason: "Nowa koperta.",
      }).group_name
    ).toBe("Życie codzienne");
  });

  it("fails in Polish when create does not return an id", async () => {
    await expect(
      applyClassifyResult(
        {
          action: "suggest_create",
          name: "Parasol",
          group_name: "Osobiste",
          confidence: 0.6,
          reason: "Nowa koperta.",
        },
        {
          createEnvelope: async () => ({}),
          assign: async () => undefined,
        }
      )
    ).rejects.toThrow("Nie udało się utworzyć koperty.");
  });
});
