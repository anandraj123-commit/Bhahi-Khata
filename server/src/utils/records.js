// Omitted WhatsApp fields from older clients preserve the server value; empty strings remove it.
export const sameCustomerValues = (left, right) =>
  ["id", "name", "phone", "address", "opening", "openingAdvance", "openingDate", "limit", "reminder"].every(
    (key) => left[key] === right[key],
  ) && (right.whatsappNumber === undefined || (left.whatsappNumber || "") === right.whatsappNumber);
export const sameEntryValues = (left, right) =>
  ["id", "customerId", "type", "amount", "date", "note", "method", "reference"].every(
    (key) => left[key] === right[key],
  ) && (left.recordedAt === undefined || right.recordedAt === undefined || left.recordedAt === right.recordedAt);
export const sameShopValues = (left, right) =>
  ["name", "owner", "address", "phone", "whatsapp", "defaultMethod"].every(
    (key) => left[key] === right[key],
  ) && (right.language === undefined || left.language === right.language) &&
  JSON.stringify(left.reminders) === JSON.stringify(right.reminders);

export const isShopSettingsConflict = ({
  current,
  input,
  base,
  actualVersion,
  baseVersion,
  actualResolutionVersion,
  baseResolutionVersion,
}) =>
  ((base?.success && !sameShopValues(current, base.data)) ||
    (baseVersion && actualVersion !== baseVersion) ||
    (baseResolutionVersion && actualResolutionVersion !== baseResolutionVersion)) &&
  !sameShopValues(current, input);
