import { describe, expect, it } from "vitest";
import {
  CATEGORY_EMOJI_CATALOG,
  CATEGORY_EMOJI_CHOICES,
  CATEGORY_EMOJI_GROUPS,
  bestCategoryEmoji,
  filterCategoryEmojis,
  foldEmojiSearch,
  suggestCategoryEmojis,
} from "./category-emojis";
import { DEFAULT_CATEGORIES } from "./default-categories";

const ORIGINAL_ENVELOPE_EMOJIS = [
  "📁",
  "🛒",
  "🍽️",
  "☕",
  "🍕",
  "🧼",
  "🏠",
  "💡",
  "📶",
  "🛡️",
  "⛽",
  "🚌",
  "🚗",
  "🚲",
  "💊",
  "🩺",
  "🏥",
  "💉",
  "🎮",
  "📺",
  "🎬",
  "🎵",
  "👕",
  "💇",
  "🏦",
  "🎯",
  "💰",
  "📈",
  "🎁",
  "✈️",
  "🐶",
  "👶",
  "📚",
  "🏋️",
  "🔧",
  "🧹",
  "🌳",
  "📱",
  "💻",
  "🎓",
  "❤️",
  "⭐",
  "🔥",
  "🎉",
];

describe("category emoji catalog", () => {
  it("keeps the previous envelope icons and adds a much larger searchable set", () => {
    expect(CATEGORY_EMOJI_CHOICES.length).toBeGreaterThan(120);
    expect(new Set(CATEGORY_EMOJI_CHOICES).size).toBe(CATEGORY_EMOJI_CHOICES.length);
    expect(CATEGORY_EMOJI_CHOICES).toEqual(expect.arrayContaining(ORIGINAL_ENVELOPE_EMOJIS));
    expect(CATEGORY_EMOJI_GROUPS.map((group) => group.id)).toContain("food");
    expect(CATEGORY_EMOJI_CATALOG.every((row) => row.emoji && row.keywords)).toBe(true);
  });

  it("folds Polish diacritics so typed search does not require exact spelling", () => {
    expect(foldEmojiSearch("  Paliwo  ")).toBe("paliwo");
    expect(foldEmojiSearch("Łódź")).toBe("lodz");
    expect(foldEmojiSearch("książki")).toBe("ksiazki");
  });

  it("finds household icons from Polish and English queries", () => {
    expect(filterCategoryEmojis("auto")).toEqual(expect.arrayContaining(["🚗"]));
    expect(filterCategoryEmojis("paliwo")).toEqual(expect.arrayContaining(["⛽"]));
    expect(filterCategoryEmojis("jedzenie")).toEqual(expect.arrayContaining(["🍽️", "🍕"]));
    expect(filterCategoryEmojis("pies")).toEqual(expect.arrayContaining(["🐶"]));
    expect(filterCategoryEmojis("lekarz")).toEqual(expect.arrayContaining(["🩺"]));
    expect(filterCategoryEmojis("netflix")).toEqual(expect.arrayContaining(["📺", "🎬"]));
    expect(filterCategoryEmojis("groceries")).toEqual(["🛒"]);
    expect(filterCategoryEmojis("kino")).toEqual(expect.arrayContaining(["🎬"]));
    expect(filterCategoryEmojis("in")).not.toContain("🎬");
    expect(filterCategoryEmojis("pil")).toEqual(expect.arrayContaining(["💊", "⚽"]));
    expect(filterCategoryEmojis("lekarstwa")).toEqual(expect.arrayContaining(["💊"]));
  });

  it("suggests an icon from the envelope name, including default categories", () => {
    expect(bestCategoryEmoji("Lekarstwa")).toBe("💊");
    expect(bestCategoryEmoji("Paliwo")).toBe("⛽");
    expect(bestCategoryEmoji("Prezent dla mamy")).toBe("🎁");
    expect(bestCategoryEmoji("Angielski")).toBe("🇬🇧");
    expect(suggestCategoryEmojis("Lekarstwa")[0]).toBe("💊");
    expect(suggestCategoryEmojis("Apteka / lekarz")).toEqual(expect.arrayContaining(["💊", "🩺"]));
    for (const category of DEFAULT_CATEGORIES) {
      expect(bestCategoryEmoji(category.name), category.name).toBe(category.icon);
    }
  });

  it("scopes chips to a group and returns all icons for an empty query", () => {
    const food = filterCategoryEmojis("", "food");
    expect(food.length).toBeGreaterThan(20);
    expect(food).toEqual(expect.arrayContaining(["🛒", "🍕"]));
    expect(food).not.toContain("🚗");
    expect(filterCategoryEmojis("")).toEqual([...CATEGORY_EMOJI_CHOICES]);
    expect(filterCategoryEmojis("xyz-brak")).toEqual([]);
  });
});
