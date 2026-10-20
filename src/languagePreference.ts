import * as SecureStore from "expo-secure-store";
import { LOCALE_BY_ID, localeId } from "./locales";

const LANGUAGE_KEY = "digital-khata.language.v1";

export async function readLanguagePreference(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(LANGUAGE_KEY);
  if (!stored) return null;
  const id = localeId(stored);
  return LOCALE_BY_ID[id] ? id : null;
}

export async function saveLanguagePreference(value: string): Promise<void> {
  const id = localeId(value);
  if (!LOCALE_BY_ID[id]) throw new Error("Unsupported language");
  await SecureStore.setItemAsync(LANGUAGE_KEY, id);
}
