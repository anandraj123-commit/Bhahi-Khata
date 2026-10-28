import type { DownloadReportTransaction } from "./downloadReports";

export const DOWNLOAD_REPORT_PAGE_SIZE = 10;

export function visibleDownloadReportTransactions(
  transactions: DownloadReportTransaction[],
  visibleCount: number,
) {
  return transactions.slice(0, Math.max(0, visibleCount));
}

export function nextDownloadReportCount(visibleCount: number, totalCount: number) {
  return Math.min(visibleCount + DOWNLOAD_REPORT_PAGE_SIZE, totalCount);
}
