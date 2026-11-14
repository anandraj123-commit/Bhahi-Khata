const IST_OFFSET_MS = 330 * 60 * 1000;
export function toISTInput(value: string) {
  const ms = Date.parse(value);
  return Number.isFinite(ms)
    ? new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16)
    : "";
}
export function fromISTInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw Error("Choose a valid IST date and time");
  const ms = Date.parse(value + ":00+05:30");
  if (!Number.isFinite(ms) || toISTInput(new Date(ms).toISOString()) !== value)
    throw Error("Choose a valid IST date and time");
  return new Date(ms).toISOString();
}
export function formatIST(value?: string) {
  return value
    ? new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }) + " IST"
    : "Unavailable";
}
