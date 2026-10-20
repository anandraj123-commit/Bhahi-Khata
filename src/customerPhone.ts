/** Canonical form used for Indian customer mobiles: ten national digits. */
export function normalizeCustomerMobile(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\+?[0-9\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
