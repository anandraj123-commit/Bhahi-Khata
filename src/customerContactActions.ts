import { Alert, Linking } from "react-native";
import { normalizeCustomerMobile } from "./customerPhone";

export type CustomerContactKind = "phone" | "whatsapp" | "address";

/** Only fixed schemes/hosts are opened; contact data is never treated as a URL. */
export function customerContactUrls(kind: CustomerContactKind, value: unknown, message?: string): string[] {
  if (typeof value !== "string") return [];
  if (kind === "address") {
    const address = value.trim();
    if (!address || address.length > 500 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(address)) return [];
    try {
      // Universal Maps URL opens the installed app or falls back to the browser.
      return [`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`];
    } catch { return []; }
  }
  const number = normalizeCustomerMobile(value);
  if (!number) return [];
  if (kind === "phone") return [`tel:+91${number}`];
  const text = message ? `&text=${encodeURIComponent(message)}` : "";
  return [
    `whatsapp://send?phone=91${number}${text}`,
    `https://wa.me/91${number}${message ? `?text=${encodeURIComponent(message)}` : ""}`,
  ];
}

export async function openCustomerContact(kind: CustomerContactKind, value: unknown, message?: string): Promise<boolean> {
  const urls = customerContactUrls(kind, value, message);
  if (!urls.length) {
    Alert.alert("Contact unavailable", "Add a valid contact detail in Edit Customer first.");
    return false;
  }
  // Attempt directly: canOpenURL can require platform query configuration.
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return true;
    } catch { /* Try the safe web fallback, if available. */ }
  }
  Alert.alert("Unable to open contact", kind === "phone"
    ? "No phone dialer is available. Please enable a phone app and try again."
    : kind === "whatsapp"
      ? "Could not open WhatsApp or its web page. Check that WhatsApp or a browser is available and try again when connected. A valid number does not confirm a WhatsApp account."
      : "Could not open Google Maps. Check that Maps or a browser is available. Address search may require an internet connection.");
  return false;
}
