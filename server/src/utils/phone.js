export function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00") && digits.startsWith("00")) digits = digits.slice(2);
  if (!raw.startsWith("+") && digits.length === 10) digits = `91${digits}`;
  // Indian national trunk zero is not part of the E.164 number.
  if (digits.startsWith("910") && digits.length === 13)
    digits = `91${digits.slice(3)}`;
  return digits ? `+${digits}` : "";
}

export function phoneLookupVariants(value) {
  const canonical = normalizePhone(value);
  const digits = canonical.replace(/\D/g, "");
  const variants = new Set([canonical, digits, `00${digits}`]);
  if (digits.startsWith("91") && digits.length === 12)
    variants.add(digits.slice(2));
  return [...variants].filter(Boolean);
}
