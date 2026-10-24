/** Estimate the phone's clock offset from an HTTP Date header. HTTP dates have
 * one-second precision, so callers should use a tolerance rather than exact equality. */
export function estimateServerClockOffset(
  dateHeader: string | null,
  requestStartedAt: number,
  responseReceivedAt: number,
): number | null {
  const serverTime = dateHeader ? Date.parse(dateHeader) : NaN;
  if (
    !Number.isFinite(serverTime) ||
    !Number.isFinite(requestStartedAt) ||
    !Number.isFinite(responseReceivedAt) ||
    responseReceivedAt < requestStartedAt
  ) return null;
  const requestMidpoint = requestStartedAt + (responseReceivedAt - requestStartedAt) / 2;
  return serverTime - requestMidpoint;
}

export const DEVICE_CLOCK_WARNING_THRESHOLD_MS = 2 * 60 * 1000;

export function deviceClockNeedsWarning(offsetMs: number | null) {
  return offsetMs !== null && Math.abs(offsetMs) >= DEVICE_CLOCK_WARNING_THRESHOLD_MS;
}
