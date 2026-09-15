export type CategoryEmojiGroupId =
  | "food"
  | "home"
  | "bills"
  | "transport"
  | "health"
  | "family"
  | "fun"
  | "clothes"
  | "money"
  | "work"
  | "other";

export type CategoryEmojiEntry = {
  emoji: string;
  group: CategoryEmojiGroupId;
  keywords: string;
};

export const CATEGORY_EMOJI_GROUPS: Array<{ id: CategoryEmojiGroupId; label: string }> = [
  { id: "food", label: "Jedzenie" },
  { id: "home", label: "Dom" },
  { id: "bills", label: "Rachunki" },
  { id: "transport", label: "Transport" },
  { id: "health", label: "Zdrowie" },
  { id: "family", label: "Rodzina" },
  { id: "fun", label: "Rozrywka" },
  { id: "clothes", label: "Ubrania" },
  { id: "money", label: "Pieniądze" },
  { id: "work", label: "Praca" },
  { id: "other", label: "Inne" },
];

const PL_FOLD: Record<string, string> = {
  ą: "a",
  ć: "c",
  ę: "e",
  ł: "l",
  ń: "n",
  ó: "o",
  ś: "s",
  ź: "z",
  ż: "z",
};

function entry(emoji: string, group: CategoryEmojiGroupId, keywords: string): CategoryEmojiEntry {
  return { emoji, group, keywords };
}

/** Household-budget set with Polish search keywords — not a full emoji mart. */
export const CATEGORY_EMOJI_CATALOG: CategoryEmojiEntry[] = [
  entry("🛒", "food", "zakupy spozywcze sklep lidl biedronka groceries cart"),
  entry("🍽️", "food", "restauracja obiad lunch jedzenie naczynia eating"),
  entry("☕", "food", "kawa herbata kawiarnia starbucks coffee"),
  entry("🍕", "food", "pizza"),
  entry("🍔", "food", "burger hamburger fastfood mcdonalds kebab"),
  entry("🌭", "food", "hotdog parowka"),
  entry("🥪", "food", "kanapka sandwich"),
  entry("🥗", "food", "salatka zdrowe warzywa"),
  entry("🍜", "food", "zupa ramen azjatyckie"),
  entry("🍝", "food", "pasta makaron wloskie"),
  entry("🍣", "food", "sushi"),
  entry("🍱", "food", "lunchbox bento"),
  entry("🍲", "food", "gulasz bigos obiad"),
  entry("🥐", "food", "rogalik pieczywo piekarnia"),
  entry("🥖", "food", "bagietka chleb piekarnia"),
  entry("🥨", "food", "precle"),
  entry("🥞", "food", "nalesniki sniadanie"),
  entry("🧀", "food", "ser nabial"),
  entry("🥚", "food", "jajka"),
  entry("🍳", "food", "jajecznica sniadanie patelnia"),
  entry("🥓", "food", "bekon mieso"),
  entry("🥩", "food", "mieso stek wolowina"),
  entry("🍗", "food", "kurczak drob"),
  entry("🍤", "food", "krewetki ryby owoce morza"),
  entry("🍎", "food", "jablko owoc"),
  entry("🍌", "food", "banan owoc"),
  entry("🍇", "food", "winogrona owoc"),
  entry("🍓", "food", "truskawka owoc"),
  entry("🍉", "food", "arbuz owoc"),
  entry("🥑", "food", "awokado"),
  entry("🥕", "food", "marchew warzywa"),
  entry("🥦", "food", "brokul warzywa"),
  entry("🌽", "food", "kukurydza"),
  entry("🥔", "food", "ziemniaki"),
  entry("🍞", "food", "chleb pieczywo"),
  entry("🥜", "food", "orzechy przekaska"),
  entry("🍯", "food", "miod"),
  entry("🥛", "food", "mleko nabial"),
  entry("🧃", "food", "sok napoj"),
  entry("🥤", "food", "napoj cola gazowane"),
  entry("🧋", "food", "bubble tea boba"),
  entry("🍺", "food", "piwo pub alkohol"),
  entry("🍻", "food", "piwo toast alkohol"),
  entry("🍷", "food", "wino alkohol"),
  entry("🥂", "food", "szampan prosecco swieto"),
  entry("🥃", "food", "whisky alkohol"),
  entry("🍸", "food", "koktajl drink bar"),
  entry("🍾", "food", "szampan butelka"),
  entry("🍦", "food", "lody deser"),
  entry("🍩", "food", "donut paczek deser"),
  entry("🍪", "food", "ciastko ciasteczka deser"),
  entry("🎂", "food", "tort urodziny ciasto"),
  entry("🧁", "food", "babeczka muffin deser"),
  entry("🍫", "food", "czekolada slodycze"),
  entry("🍬", "food", "cukierek slodycze"),
  entry("🍿", "food", "popcorn kino"),

  entry("🏠", "home", "dom mieszkanie czynsz kredyt hipoteka"),
  entry("🏡", "home", "domek ogrod"),
  entry("🏢", "home", "blok mieszkanie biurowiec"),
  entry("🔑", "home", "klucze drzwi"),
  entry("🛋️", "home", "kanapa meble salon"),
  entry("🛏️", "home", "lozko sypialnia"),
  entry("🛁", "home", "wanna lazienka"),
  entry("🚿", "home", "prysznic lazienka woda"),
  entry("🚽", "home", "toaleta lazienka"),
  entry("🧼", "home", "mydlo chemia higiena sprzatanie"),
  entry("🧽", "home", "gabka zmywanie"),
  entry("🧹", "home", "sprzatanie mop miotla"),
  entry("🧺", "home", "pranie kosz"),
  entry("🧻", "home", "papier toaletowy"),
  entry("🪴", "home", "rosliny kwiaty doniczka"),
  entry("🌳", "home", "ogrod drzewo dzialka"),
  entry("🪵", "home", "drewno kominek"),
  entry("🕯️", "home", "swieca"),
  entry("🚪", "home", "drzwi"),
  entry("🪟", "home", "okno"),
  entry("🧸", "home", "zabawki pluszak"),
  entry("📦", "home", "paczka magazyn"),
  entry("🛠️", "home", "narzedzia remont"),
  entry("🔧", "home", "naprawa klucz narzedzia"),
  entry("🔨", "home", "mlotek remont"),
  entry("🧰", "home", "skrzynka narzedzia"),

  entry("💡", "bills", "prad energia zarowka media"),
  entry("🔌", "bills", "prad wtyczka energia"),
  entry("🔋", "bills", "bateria energia"),
  entry("📶", "bills", "internet wifi telefon komorka"),
  entry("📱", "bills", "telefon smartfon abonament"),
  entry("☎️", "bills", "telefon stacjonarny"),
  entry("🛡️", "bills", "ubezpieczenie oc ac ochrona"),
  entry("💧", "bills", "woda rachunek"),
  entry("🔥", "bills", "gaz ogrzewanie piec ogien"),
  entry("📺", "bills", "tv telewizja netflix subskrypcja"),
  entry("📡", "bills", "antena tv kablowka"),
  entry("🧾", "bills", "rachunek faktura paragon"),
  entry("📄", "bills", "dokumenty umowa"),
  entry("🧯", "bills", "gasnica bezpieczenstwo"),

  entry("⛽", "transport", "paliwo benzyna orlen stacja"),
  entry("🚌", "transport", "autobus komunikacja bilet mpk"),
  entry("🚗", "transport", "auto samochod"),
  entry("🚕", "transport", "taxi uber bolt"),
  entry("🚙", "transport", "suv samochod"),
  entry("🚐", "transport", "van bus"),
  entry("🚛", "transport", "ciezarowka dostawa"),
  entry("🚲", "transport", "rower"),
  entry("🛵", "transport", "skuter hulajnoga"),
  entry("🏍️", "transport", "motocykl motor"),
  entry("🚆", "transport", "pociag pkp kolej"),
  entry("🚇", "transport", "metro"),
  entry("🚊", "transport", "tramwaj"),
  entry("✈️", "transport", "samolot lot wakacje podroz"),
  entry("🛫", "transport", "wylot lotnisko"),
  entry("🛬", "transport", "przylot lotnisko"),
  entry("🚢", "transport", "statek prom"),
  entry("⛵", "transport", "zaglowka"),
  entry("🛞", "transport", "opona warsztat"),
  entry("🅿️", "transport", "parking"),
  entry("🚦", "transport", "korek swiatla"),
  entry("🚧", "transport", "droga remont"),
  entry("🚚", "transport", "kurier dostawa"),

  entry("💊", "health", "apteka leki tabletki tabletka lekarstwa lekarstwo lek pigułka pigułki pill pills medicine medycyna"),
  entry("🩺", "health", "lekarz lekarze stetoskop wizyta przychodnia"),
  entry("🏥", "health", "szpital klinika"),
  entry("💉", "health", "szczepienie zastrzyk"),
  entry("🦷", "health", "dentysta zeby"),
  entry("👓", "health", "okulary okulista"),
  entry("👁️", "health", "oczy wzrok"),
  entry("🩹", "health", "plaster rana"),
  entry("🧴", "health", "kosmetyki krem apteka"),
  entry("🧘", "health", "joga wellness relaks"),
  entry("🏋️", "health", "silownia fitness cwiczenia"),
  entry("🏃", "health", "bieganie sport"),
  entry("🚴", "health", "kolarstwo rower sport"),
  entry("🏊", "health", "plywanie basen"),
  entry("⚽", "health", "pilka nozna sport"),
  entry("🎾", "health", "tenis sport"),
  entry("🎿", "health", "narty zima"),
  entry("🧬", "health", "badania laboratorium"),

  entry("👶", "family", "dziecko niemowle baby"),
  entry("🧒", "family", "dziecko przedszkole"),
  entry("👧", "family", "corka dziecko"),
  entry("👦", "family", "syn dziecko"),
  entry("👪", "family", "rodzina"),
  entry("👵", "family", "babcia senior"),
  entry("👴", "family", "dziadek senior"),
  entry("💍", "family", "slub pierscionek"),
  entry("❤️", "family", "milosc para serce"),
  entry("💕", "family", "milosc serca"),
  entry("🐶", "family", "pies zwierzak weterynarz"),
  entry("🐱", "family", "kot zwierzak weterynarz"),
  entry("🐾", "family", "zwierzak lapy"),
  entry("🐹", "family", "chomik"),
  entry("🐰", "family", "krolik"),
  entry("🐦", "family", "ptak"),
  entry("🐠", "family", "rybka akwarium"),
  entry("🐴", "family", "kon"),

  entry("🎮", "fun", "gra hobby konsola"),
  entry("🎬", "fun", "kino film netflix"),
  entry("🎵", "fun", "muzyka spotify"),
  entry("🎧", "fun", "sluchawki muzyka"),
  entry("🎤", "fun", "karaoke mikrofon"),
  entry("🎸", "fun", "gitara muzyka"),
  entry("🎹", "fun", "pianino keyboard"),
  entry("🎉", "fun", "impreza swieto"),
  entry("🎊", "fun", "konfetti impreza"),
  entry("🎈", "fun", "balon urodziny"),
  entry("🎁", "fun", "prezent urodziny"),
  entry("🎄", "fun", "swieta choinka"),
  entry("🎃", "fun", "halloween"),
  entry("🎆", "fun", "fajerwerki sylwester"),
  entry("📚", "fun", "ksiazki czytanie"),
  entry("🎭", "fun", "teatr spektakl"),
  entry("🎨", "fun", "malowanie hobby sztuka"),
  entry("📷", "fun", "aparat zdjecia"),
  entry("🎥", "fun", "kamera film"),
  entry("🎫", "fun", "bilet wydarzenie"),
  entry("🎡", "fun", "wesole miasteczko"),
  entry("🏕️", "fun", "camping biwak"),
  entry("🏖️", "fun", "plaza wakacje urlop"),
  entry("🗺️", "fun", "podroz mapa"),
  entry("🎢", "fun", "rollercoaster park"),

  entry("👕", "clothes", "ubrania tshirt koszulka"),
  entry("👔", "clothes", "koszula garnitur"),
  entry("👗", "clothes", "sukienka"),
  entry("👚", "clothes", "bluzka"),
  entry("👖", "clothes", "spodnie jeansy"),
  entry("🧥", "clothes", "kurtka plaszcz"),
  entry("🧣", "clothes", "szalik zima"),
  entry("🧤", "clothes", "rekawiczki zima"),
  entry("🧦", "clothes", "skarpetki"),
  entry("👟", "clothes", "buty sportowe"),
  entry("👠", "clothes", "szpilki buty"),
  entry("👜", "clothes", "torba torebka"),
  entry("🎒", "clothes", "plecak szkola"),
  entry("💄", "clothes", "makijaz kosmetyki"),
  entry("💅", "clothes", "paznokcie manicure"),
  entry("💇", "clothes", "fryzjer strzyzenie"),
  entry("💈", "clothes", "barber fryzjer"),
  entry("⌚", "clothes", "zegarek"),
  entry("🕶️", "clothes", "okulary przeciwsłoneczne"),

  entry("💰", "money", "pieniadze kasa oszczednosci"),
  entry("💵", "money", "dolar gotowka"),
  entry("💶", "money", "euro gotowka"),
  entry("💳", "money", "karta platnicza blik"),
  entry("🏦", "money", "bank oszczednosci lokata fundusz awaryjny"),
  entry("📈", "money", "inwestycje gielda wzrost"),
  entry("📉", "money", "strata spadek"),
  entry("🎯", "money", "cel cele oszczednosci"),
  entry("💎", "money", "luksus biuteria"),
  entry("🪙", "money", "moneta krypto bitcoin"),
  entry("📊", "money", "wykres finanse"),
  entry("🏧", "money", "bankomat"),
  entry("💸", "money", "wydatek przelew"),
  entry("🧮", "money", "podatki ksiegowosc"),
  entry("💲", "money", "cena dolar"),

  entry("💻", "work", "laptop komputer praca home office"),
  entry("🖥️", "work", "monitor komputer"),
  entry("⌨️", "work", "klawiatura"),
  entry("🖨️", "work", "drukarka"),
  entry("🎓", "work", "edukacja studia dyplom"),
  entry("✏️", "work", "olowek szkolne"),
  entry("📝", "work", "notatki zeszyt"),
  entry("📂", "work", "teczka dokumenty"),
  entry("📁", "work", "folder plik kategoria"),
  entry("💼", "work", "biuro pensja wyplata praca"),
  entry("🧑‍💻", "work", "programista it praca"),
  entry("🏫", "work", "szkola edukacja"),
  entry("📅", "work", "kalendarz termin"),
  entry("⏰", "work", "budzik czas"),

  entry("⭐", "other", "gwiazda ulubione"),
  entry("✨", "other", "brokat"),
  entry("🌈", "other", "tecza"),
  entry("☀️", "other", "slonce lato"),
  entry("🌙", "other", "ksiezyc"),
  entry("⚡", "other", "piorun energia"),
  entry("❄️", "other", "snieg zima"),
  entry("☔", "other", "deszcz parasol"),
  entry("🎀", "other", "kokarda prezent"),
  entry("✅", "other", "ok check"),
  entry("⚠️", "other", "uwaga"),
  entry("🔔", "other", "powiadomienie dzwonek"),
  entry("🏷️", "other", "przecena etykieta"),
  entry("🏪", "other", "sklep osiedlowy"),
  entry("🏬", "other", "galeria centrum handlowe"),
  entry("🥳", "other", "swieto urodziny"),
];

export const CATEGORY_EMOJI_CHOICES: readonly string[] = CATEGORY_EMOJI_CATALOG.map((row) => row.emoji);

export function foldEmojiSearch(value: string): string {
  return Array.from(String(value ?? "").trim().toLocaleLowerCase("pl-PL"))
    .map((ch) => PL_FOLD[ch] ?? ch)
    .join("")
    .replace(/\s+/g, " ");
}

function groupLabel(id: CategoryEmojiGroupId): string {
  return CATEGORY_EMOJI_GROUPS.find((group) => group.id === id)?.label ?? id;
}

function keywordTokens(row: CategoryEmojiEntry): string[] {
  return foldEmojiSearch(`${row.keywords} ${groupLabel(row.group)} ${row.group}`)
    .split(" ")
    .filter(Boolean);
}

function sharedPrefixLength(left: string, right: string): number {
  const n = Math.min(left.length, right.length);
  let i = 0;
  while (i < n && left[i] === right[i]) i += 1;
  return i;
}

function scoreTokenAgainstKeywords(token: string, keywords: string[]): number {
  let best = 0;
  for (const keyword of keywords) {
    if (keyword === token) best = Math.max(best, 100);
    else if (token.length >= 3 && keyword.startsWith(token)) best = Math.max(best, 80);
    else if (keyword.length >= 3 && token.startsWith(keyword)) best = Math.max(best, 70);
    else if (sharedPrefixLength(token, keyword) >= 5) best = Math.max(best, 50);
  }
  return best;
}

export function nameSearchTokens(value: string): string[] {
  return foldEmojiSearch(String(value ?? "").replace(/[/_\-,.]+/g, " "))
    .split(" ")
    .filter((token) => token.length >= 2);
}

function scoreEntryForTokens(row: CategoryEmojiEntry, tokens: string[]): number {
  const keywords = keywordTokens(row);
  let score = 0;
  tokens.forEach((token, index) => {
    const part = scoreTokenAgainstKeywords(token, keywords);
    if (part) score += part + Math.max(0, 8 - index * 2);
  });
  return score;
}

/** Best icons for an envelope name, strongest match first. */
export function suggestCategoryEmojis(name: string, limit = 12): string[] {
  const tokens = nameSearchTokens(name);
  if (!tokens.length) return [];
  return CATEGORY_EMOJI_CATALOG.map((row) => ({ emoji: row.emoji, score: scoreEntryForTokens(row, tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.emoji);
}

export function bestCategoryEmoji(name: string): string | null {
  return suggestCategoryEmojis(name, 1)[0] ?? null;
}

export function filterCategoryEmojis(
  query: string,
  group: CategoryEmojiGroupId | "all" = "all"
): string[] {
  const raw = String(query ?? "").trim();
  const tokens = nameSearchTokens(raw);
  return CATEGORY_EMOJI_CATALOG.filter((row) => {
    if (group !== "all" && row.group !== group) return false;
    if (!tokens.length) return true;
    if (row.emoji.includes(raw)) return true;
    return scoreEntryForTokens(row, tokens) > 0;
  }).map((row) => row.emoji);
}

export function rankEmojisByName(emojis: readonly string[], name: string): string[] {
  const boost = new Set(suggestCategoryEmojis(name));
  const first = emojis.filter((emoji) => boost.has(emoji));
  const rest = emojis.filter((emoji) => !boost.has(emoji));
  return [...first, ...rest];
}
