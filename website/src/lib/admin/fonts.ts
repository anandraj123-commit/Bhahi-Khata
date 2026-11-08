import { Inter, Noto_Sans_Devanagari } from "next/font/google";

// One shared loader for the Admin root and body-portaled menus/dialogs.
// The public website retains its existing font configuration.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-admin-inter",
  display: "swap",
  adjustFontFallback: false,
});
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-admin-devanagari",
  display: "swap",
  adjustFontFallback: false,
});
export const adminFontVariables = `${inter.variable} ${devanagari.variable}`;
