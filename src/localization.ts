function formatterLocale(language: string) {
  if (language === "English") return "en-IN";
  if (language === "हिन्दी" || language === "Hindi") return "hi-IN";
  return /^[a-z]{2,3}$/.test(language) ? `${language}-IN` : "en-IN";
}

export function resolveLocaleText(value: string, dictionary: Record<string, string>) {
  const trim = value.trim();
  if (dictionary[trim]) return value.replace(trim, () => dictionary[trim]);
  for (const [source, translated] of Object.entries(dictionary)) {
    if (!source.includes("{{")) continue;
    const names: string[] = [];
    const pattern = source.split(/\{\{\s*([\w.]+)\s*\}\}/g).map((part, index) => {
      if (index % 2 === 1) {
        names.push(part);
        return "([\\s\\S]*?)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    const match = new RegExp(`^${pattern}$`).exec(trim);
    if (!match) continue;
    const parameters = Object.fromEntries(names.map((name, index) => [name, match[index + 1]]));
    return value.replace(trim, () => interpolate(translated, parameters));
  }
  return value;
}

/** Counts dictionary-backed translations without treating source-English fallbacks as coverage. */
export function measureTranslationCoverage(
  requiredKeys: readonly string[],
  dictionary: Record<string, string>,
  locale: string,
  unchangedTerms: ReadonlySet<string> = new Set(),
) {
  const translated = requiredKeys.filter((key) => {
    const value = dictionary[key]?.trim();
    return Boolean(value && (value !== key || unchangedTerms.has(key)));
  });
  const translatedSet = new Set(translated);
  const missingKeys = requiredKeys.filter((key) => !translatedSet.has(key));
  return {
    locale,
    required: requiredKeys.length,
    translated: translated.length,
    missingKeys,
    fallbackCount: missingKeys.length,
  };
}

/** Maps stable API codes first, then HTTP categories, to bundled source keys. */
export function apiErrorTranslationKey(code: unknown, status: number): string {
  const byCode: Record<string, string> = {
    CUSTOMER_MOBILE_ALREADY_EXISTS:
      "A customer with this mobile number already exists in your shop. Please open the existing customer.",
    CUSTOMER_LIMIT_REACHED: "Customer limit reached",
    CUSTOMER_CONFLICT_RESOLVED: "Customer conflict resolved",
    SHOP_CONFLICT_RESOLVED: "Settings conflict resolved",
    SHOP_SETTINGS_CONFLICT: "Settings changed again",
    ACCOUNT_SHOP_LINK_CONFLICT: "Unable to set up your shop",
    SHOP_PHONE_ALREADY_REGISTERED: "Mobile number already used",
    ACCOUNT_PHONE_INVALID: "Invalid mobile number",
    CHECKOUT_DISABLED:
      "Checkout is disabled until Android billing eligibility and a supported native payment integration are confirmed.",
  };
  if (typeof code === "string" && byCode[code]) return byCode[code];

  if (status === 401) return "Sign in securely with your mobile number. Your khata syncs to your account.";
  if (status === 409) return "Could not sync changes";
  if (status >= 500) return "Please try again when the service is available.";
  return "Please try again.";
}

export function interpolate(text: string, parameters: Record<string, string | number> = {}) {
  return Object.entries(parameters).reduce(
    (result, [name, value]) => result.split(`{{${name}}}`).join(String(value)),
    text,
  );
}

export function pluralTemplate(
  language: string,
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
) {
  const category = new Intl.PluralRules(formatterLocale(language)).select(count);
  return interpolate(forms[category] || forms.other, { count });
}

export function formatCurrency(amount: number, language: string) {
  return new Intl.NumberFormat(formatterLocale(language), {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatLocaleDate(value: Date | number, language: string) {
  return new Intl.DateTimeFormat(formatterLocale(language), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

export function localeDirection(language: string): "ltr" | "rtl" {
  return ["ur", "sd", "ks"].includes(language) || ["اردو", "سنڌي", "کٲشُر"].includes(language)
    ? "rtl"
    : "ltr";
}
