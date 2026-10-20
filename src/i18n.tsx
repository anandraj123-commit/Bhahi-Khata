import React, { createContext, useContext } from "react";
import { Alert, AlertButton, AlertOptions, Text as NativeText, TextProps } from "react-native";
import { localeId } from "./locales";
import { localeDictionaries } from "./translations";
import { APP_RUNTIME_TRANSLATION_KEYS, APP_STATIC_TRANSLATION_KEYS } from "./translationInventory";
import {
  formatCurrency,
  formatLocaleDate,
  interpolate,
  localeDirection,
  measureTranslationCoverage,
  pluralTemplate,
  resolveLocaleText,
} from "./localization";
export const LanguageContext = createContext("English");
const hindi: Record<string, string> = {
  "Welcome to": "स्वागत है",
  "Digital Khata": "डिजिटल खाता",
  Login: "लॉगिन",
  "Change PIN": "PIN बदलें",
  "WhatsApp Support": "WhatsApp सहायता",
  "Call Support": "कॉल सहायता",
  "Create Account": "खाता बनाएँ",
  "Explore demo shop": "डेमो दुकान देखें",
  "Simple digital khata": "आसान डिजिटल खाता",
  "Udhari ka hisaab, ab aur bhi aasan": "उधारी का हिसाब, अब और भी आसान",
  "Manage customer udhari and payments\nwithout the paper notebook.":
    "ग्राहकों की उधारी और भुगतान का हिसाब रखें,\nबिना कागज़ की बही के।",
  Home: "होम",
  Customers: "ग्राहक",
  Add: "जोड़ें",
  Khata: "खाता",
  More: "और",
  "Verify Mobile": "मोबाइल सत्यापन",
  "Set Up Your Shop": "अपनी दुकान बनाएँ",
  "Add Customer": "ग्राहक जोड़ें",
  "+ Add Customer": "+ ग्राहक जोड़ें",
  "Edit Customer": "ग्राहक बदलें",
  "Add Udhari": "उधारी जोड़ें",
  "+ Add Udhari": "+ उधारी जोड़ें",
  "₹ Payment": "₹ भुगतान",
  "Record Payment": "भुगतान दर्ज करें",
  Transaction: "लेन-देन",
  "Edit Transaction": "लेन-देन बदलें",
  "Monthly Statement": "मासिक विवरण",
  "Share Statement": "विवरण साझा करें",
  Notifications: "सूचनाएँ",
  Reports: "रिपोर्ट",
  "Shop Profile": "दुकान की प्रोफ़ाइल",
  Settings: "सेटिंग",
  "Reminder Settings": "रिमाइंडर सेटिंग",
  "Help & Support": "मदद और सहायता",
  "Choose Your Plan": "अपना प्लान चुनें",
  "My Subscription": "मेरी सदस्यता",
  "Payment History": "भुगतान इतिहास",
  Account: "खाता प्रबंधन",
  "Activity History": "बदलाव का इतिहास",
  "Enter your mobile number": "अपना मोबाइल नंबर दर्ज करें",
  "Mobile number (+91)": "मोबाइल नंबर (+91)",
  Continue: "आगे बढ़ें",
  "Enter OTP": "OTP दर्ज करें",
  "6-digit verification code": "6 अंकों का सत्यापन कोड",
  Verify: "सत्यापित करें",
  "Change mobile number": "मोबाइल नंबर बदलें",
  "Shop Name *": "दुकान का नाम *",
  "Owner Name *": "मालिक का नाम *",
  Address: "पता",
  "WhatsApp number (optional)": "WhatsApp नंबर (वैकल्पिक)",
  "Save Profile": "प्रोफ़ाइल सहेजें",
  "Start Using Khata": "खाता शुरू करें",
  "Total Outstanding": "कुल बकाया",
  "This month’s udhari": "इस महीने की उधारी",
  "This month’s collection": "इस महीने की वसूली",
  "Recent Transactions": "हाल के लेन-देन",
  "Customers With Pending Balance": "बकाया वाले ग्राहक",
  "Search customers": "ग्राहक खोजें",
  "Search name or phone": "नाम या फ़ोन खोजें",
  All: "सभी",
  Due: "बकाया",
  Paid: "चुकता",
  "Name *": "नाम *",
  "Phone Number": "फ़ोन नंबर",
  "Opening Outstanding (₹)": "पहले से बकाया (₹)",
  "Credit Limit (₹, 0 = no limit)": "उधारी सीमा (₹, 0 = असीमित)",
  "WhatsApp / SMS reminders": "WhatsApp / SMS रिमाइंडर",
  "Save Customer": "ग्राहक सहेजें",
  "Current Outstanding": "वर्तमान बकाया",
  "Total Udhari": "कुल उधारी",
  "Total Payments": "कुल भुगतान",
  "Total Payment": "कुल भुगतान",
  Statement: "विवरण",
  "Transaction History": "लेन-देन का इतिहास",
  Customer: "ग्राहक",
  "Find a customer": "ग्राहक खोजें",
  "Amount (₹) *": "राशि (₹) *",
  "Date (YYYY-MM-DD) *": "तारीख (YYYY-MM-DD) *",
  "Payment Method": "भुगतान का तरीका",
  Cash: "नकद",
  Bank: "बैंक",
  Other: "अन्य",
  "Description / Note": "विवरण / नोट",
  "Save Changes": "बदलाव सहेजें",
  "Save Udhari": "उधारी सहेजें",
  "Save Payment": "भुगतान सहेजें",
  "Delete Transaction": "लेन-देन हटाएँ",
  UDHARI: "उधारी",
  PAYMENT: "भुगतान",
  Description: "विवरण",
  Edit: "बदलें",
  Delete: "हटाएँ",
  "Search customer": "ग्राहक खोजें",
  "Customer name": "ग्राहक का नाम",
  Udhari: "उधारी",
  Payment: "भुगतान",
  Opening: "शुरुआती बकाया",
  "Opening Balance": "शुरुआती बकाया",
  "Opening Outstanding": "पहले से बकाया",
  "Closing Balance": "अंतिम बकाया",
  Outstanding: "बकाया",
  "WhatsApp / SMS Share": "WhatsApp / SMS पर साझा करें",
  "Send Via": "भेजने का माध्यम",
  "Message Preview": "संदेश देखें",
  "Open WhatsApp": "WhatsApp खोलें",
  "Open SMS": "SMS खोलें",
  Read: "पढ़ा गया",
  New: "नया",
  "Monthly Udhari": "मासिक उधारी",
  Collection: "वसूली",
  "Outstanding (all time)": "कुल बकाया",
  "Active customers": "सक्रिय ग्राहक",
  "6-Month Udhari Trend": "6 महीने की उधारी",
  "Customer Balance Distribution": "ग्राहकों का बकाया विवरण",
  "Paid / Credit balance": "चुकता / अग्रिम भुगतान",
  Pending: "बाकी",
  Owner: "मालिक",
  Phone: "फ़ोन",
  "Not added": "नहीं जोड़ा",
  "Edit Profile": "प्रोफ़ाइल बदलें",
  ACCOUNT: "खाता प्रबंधन",
  "Mobile Number": "मोबाइल नंबर",
  "Logout / Account actions": "लॉगआउट / खाता प्रबंधन",
  KHATA: "खाता",
  "Default payment method": "भुगतान का डिफ़ॉल्ट तरीका",
  DATA: "डेटा",
  "Export data (CSV)": "डेटा निर्यात करें (CSV)",
  "Save backup (JSON)": "बैकअप सहेजें (JSON)",
  "Restore backup": "बैकअप बहाल करें",
  LANGUAGE: "भाषा",
  Language: "भाषा",
  "Monthly Reminder": "मासिक रिमाइंडर",
  "Reminder Date": "रिमाइंडर की तारीख",
  "Last day": "अंतिम दिन",
  "Reminder Time (HH:MM)": "रिमाइंडर का समय (HH:MM)",
  "Minimum Outstanding (₹)": "न्यूनतम बकाया (₹)",
  "Search Help": "मदद खोजें",
  "Search common questions": "आम सवाल खोजें",
  "Common Questions": "आम सवाल",
  Upgrade: "अपग्रेड करें",
  Free: "मुफ़्त",
  Cancel: "रद्द करें",
  Logout: "लॉगआउट",
  "Are you sure you want to logout?": "क्या आप लॉगआउट करना चाहते हैं?",
  "Delete local account": "इस डिवाइस का खाता हटाएँ",
  "Type DELETE to confirm": "पुष्टि के लिए DELETE लिखें",
  "Delete account": "खाता हटाएँ",
  "No phone added": "फ़ोन नहीं जोड़ा",
  "No phone number": "फ़ोन नंबर नहीं",
  "No address": "पता नहीं",
  "No description": "कोई विवरण नहीं",
  "No customers found": "कोई ग्राहक नहीं मिला",
  "Your khata starts here": "अपना खाता शुरू करें",
  "No transactions yet": "अभी कोई लेन-देन नहीं",
  "Your monthly khata": "आपका मासिक खाता",
  "No activity yet": "अभी कोई बदलाव नहीं",
  "How do I add a customer?": "ग्राहक कैसे जोड़ें?",
  "How do I record payment?": "भुगतान कैसे दर्ज करें?",
  "How is balance calculated?": "बकाया की गणना कैसे होती है?",
  "How do I send WhatsApp reminders?": "WhatsApp रिमाइंडर कैसे भेजें?",
  "How do I keep my data safe?": "डेटा सुरक्षित कैसे रखें?",
  English: "English",
  हिन्दी: "हिन्दी",
};
export function translate(value: string, language: string): string {
  const id = localeId(language);
  if (id === "en") return value;
  const dictionary = id === "hi"
    ? { ...hindi, ...localeDictionaries.hi }
    : localeDictionaries[id] || {};
  return resolveLocaleText(value, dictionary);
}

export function t(
  key: string,
  language: string,
  parameters: Record<string, string | number> = {},
) {
  return interpolate(translate(key, language), parameters);
}

/** Localizes application-owned Alert copy at the call site using the active locale. */
export function showLocalizedAlert(
  language: string,
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
) {
  return Alert.alert(
    translate(title, language),
    message === undefined ? undefined : translate(message, language),
    buttons?.map((button) => ({
      ...button,
      text: button.text ? translate(button.text, language) : button.text,
    })),
    options,
  );
}

export function plural(
  language: string,
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
) {
  return t(pluralTemplate(language, count, forms), language);
}

export { formatCurrency, formatLocaleDate, localeDirection };

const untranslatedButLocaleInvariant = new Set(["SMS", "WhatsApp"]);

export function translationCoverageStats(language: string) {
  const id = localeId(language);
  const required = [...new Set([...APP_STATIC_TRANSLATION_KEYS, ...APP_RUNTIME_TRANSLATION_KEYS])]
    .filter((key) => key !== "98XXXXXXXX");
  const dictionary = id === "hi" ? { ...hindi, ...localeDictionaries.hi } : localeDictionaries[id] || {};
  return measureTranslationCoverage(required, dictionary, id, untranslatedButLocaleInvariant);
}

export function translationCoverage(language: string) {
  const id = localeId(language);
  if (id === "en") return "English source text";
  const { required, translated } = translationCoverageStats(id);
  const percent = required ? Math.round((translated * 100) / required) : 100;
  return `${translated}/${required} UI strings · ${percent}%`;
}

export function Text({ children, ...props }: TextProps) {
  const language = useContext(LanguageContext);
  const transform = (child: React.ReactNode): React.ReactNode =>
    typeof child === "string"
      ? translate(child, language)
      : Array.isArray(child)
        ? child.map(transform)
        : child;
  return (
    <NativeText
      {...props}
      style={[
        props.style,
        localeDirection(language) === "rtl" ? { writingDirection: "rtl" } : null,
      ]}
    >
      {transform(children)}
    </NativeText>
  );
}
