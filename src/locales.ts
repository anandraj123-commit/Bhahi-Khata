export type Locale = {
  id: string;
  tag: string;
  englishName: string;
  nativeName: string;
  direction: "ltr" | "rtl";
};

export const LOCALES: Locale[] = [
  { id: "en", tag: "en-IN", englishName: "English", nativeName: "English", direction: "ltr" },
  { id: "hi", tag: "hi-IN", englishName: "Hindi", nativeName: "हिन्दी", direction: "ltr" },
  { id: "bn", tag: "bn-IN", englishName: "Bengali", nativeName: "বাংলা", direction: "ltr" },
  { id: "mr", tag: "mr-IN", englishName: "Marathi", nativeName: "मराठी", direction: "ltr" },
  { id: "te", tag: "te-IN", englishName: "Telugu", nativeName: "తెలుగు", direction: "ltr" },
  { id: "ta", tag: "ta-IN", englishName: "Tamil", nativeName: "தமிழ்", direction: "ltr" },
  { id: "gu", tag: "gu-IN", englishName: "Gujarati", nativeName: "ગુજરાતી", direction: "ltr" },
  { id: "ur", tag: "ur-IN", englishName: "Urdu", nativeName: "اردو", direction: "rtl" },
  { id: "kn", tag: "kn-IN", englishName: "Kannada", nativeName: "ಕನ್ನಡ", direction: "ltr" },
  { id: "ml", tag: "ml-IN", englishName: "Malayalam", nativeName: "മലയാളം", direction: "ltr" },
  { id: "or", tag: "or-IN", englishName: "Odia", nativeName: "ଓଡ଼ିଆ", direction: "ltr" },
  { id: "pa", tag: "pa-IN", englishName: "Punjabi", nativeName: "ਪੰਜਾਬੀ", direction: "ltr" },
  { id: "as", tag: "as-IN", englishName: "Assamese", nativeName: "অসমীয়া", direction: "ltr" },
  { id: "mai", tag: "mai-IN", englishName: "Maithili", nativeName: "मैथिली", direction: "ltr" },
  { id: "sat", tag: "sat-IN", englishName: "Santali", nativeName: "ᱥᱟᱱᱛᱟᱲᱤ", direction: "ltr" },
  { id: "ks", tag: "ks-IN", englishName: "Kashmiri", nativeName: "کٲشُر", direction: "rtl" },
  { id: "ne", tag: "ne-IN", englishName: "Nepali", nativeName: "नेपाली", direction: "ltr" },
  { id: "kok", tag: "kok-IN", englishName: "Konkani", nativeName: "कोंकणी", direction: "ltr" },
  { id: "sd", tag: "sd-IN", englishName: "Sindhi", nativeName: "سنڌي", direction: "rtl" },
  { id: "doi", tag: "doi-IN", englishName: "Dogri", nativeName: "डोगरी", direction: "ltr" },
  { id: "mni", tag: "mni-IN", englishName: "Manipuri (Meitei)", nativeName: "ꯃꯤꯇꯩꯂꯣꯟ", direction: "ltr" },
  { id: "brx", tag: "brx-IN", englishName: "Bodo", nativeName: "बड़ो", direction: "ltr" },
  { id: "sa", tag: "sa-IN", englishName: "Sanskrit", nativeName: "संस्कृतम्", direction: "ltr" },
];

export const LOCALE_IDS = LOCALES.map((locale) => locale.id);
export const LOCALE_BY_ID = Object.fromEntries(LOCALES.map((locale) => [locale.id, locale])) as Record<string, Locale>;

/** Legacy account values remain valid and are normalized when read. */
export function localeId(value: string | null | undefined): string {
  if (value === "English") return "en";
  if (value === "हिन्दी" || value === "Hindi") return "hi";
  return LOCALE_BY_ID[value || ""] ? value! : "en";
}

export function localeTag(value: string | null | undefined): string {
  return LOCALE_BY_ID[localeId(value)]?.tag || "en-IN";
}

export function localeDirection(value: string | null | undefined): "ltr" | "rtl" {
  return LOCALE_BY_ID[localeId(value)]?.direction || "ltr";
}
