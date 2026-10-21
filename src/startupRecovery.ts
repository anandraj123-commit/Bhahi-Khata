/** Auth failures are authoritative; temporary backend failures may use a
 * previously authenticated, unexpired encrypted offline session. */
export const isAuthoritativeSessionRejection = (status: number) =>
  status === 401 || status === 403;

export const isTemporaryBackendFailure = (status: number) =>
  status === 429 || status >= 500;
