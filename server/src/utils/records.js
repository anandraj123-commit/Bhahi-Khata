export const sameCustomerValues = (left, right) =>
  ["id", "name", "phone", "address", "opening", "limit", "reminder"].every(
    (key) => left[key] === right[key],
  );
export const sameEntryValues = (left, right) =>
  ["id", "customerId", "type", "amount", "date", "note", "method", "due"].every(
    (key) => left[key] === right[key],
  );
export const sameShopValues = (left, right) =>
  ["name", "owner", "address", "phone", "whatsapp", "language", "defaultMethod"].every(
    (key) => left[key] === right[key],
  ) && JSON.stringify(left.reminders) === JSON.stringify(right.reminders);
