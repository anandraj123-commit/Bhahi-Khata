import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { File } from "expo-file-system";
import { isValidGeneratedPdfBase64, logReceiptPdfFailure } from "./transactionReceiptFile";

function log(event: string, details: Record<string, unknown>) {
  if (__DEV__) console.info("[receipt-pdf]", event, details);
}

function normalizedBase64(value: string) {
  return value.replace(/\s/g, "");
}

/** Save through SAF's content-URI writer. A file:// -> content:// copyAsync is not supported on Android. */
export async function saveReceiptPdfToAndroid(base64: string, fileName: string): Promise<boolean> {
  if (!isValidGeneratedPdfBase64(base64)) throw new Error("Generated PDF could not be read.");
  let target: string | undefined;
  let stage = "request-directory-permission";
  try {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) {
      log("download-canceled", { operation: "download", stage, canceled: true });
      return false;
    }
    const directory = permission.directoryUri;
    stage = "read-destination-directory";
    const existing = await FileSystem.StorageAccessFramework.readDirectoryAsync(directory);
    const used = new Set(existing.map((uri) => {
      try { return decodeURIComponent(uri.split("/").at(-1) || ""); } catch { return uri; }
    }));
    const stem = fileName.replace(/\.pdf$/i, "");
    let name = fileName;
    for (let suffix = 2; used.has(name); suffix++) name = `${stem}_${suffix}.pdf`;

    stage = "create-saf-document";
    target = await FileSystem.StorageAccessFramework.createFileAsync(directory, name.replace(/\.pdf$/i, ""), "application/pdf");
    if (!target.startsWith("content://")) throw new Error("invalid-saf-document-uri");

    stage = "write-saf-document-base64";
    await FileSystem.StorageAccessFramework.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });

    stage = "verify-saf-document";
    const savedBase64 = await FileSystem.StorageAccessFramework.readAsStringAsync(target, { encoding: FileSystem.EncodingType.Base64 });
    if (!isValidGeneratedPdfBase64(savedBase64) || normalizedBase64(savedBase64) !== normalizedBase64(base64)) {
      throw new Error("saved-pdf-verification-failed");
    }
    log("download-saved", { operation: "download", stage, uriScheme: "content", base64Present: true, verified: true });
    return true;
  } catch (error) {
    logReceiptPdfFailure("download", stage, error, target, true);
    if (target) {
      try { await FileSystem.deleteAsync(target, { idempotent: true }); } catch { /* Best-effort cleanup of an incomplete document. */ }
    }
    throw new Error("Unable to save PDF.");
  }
}

export async function shareReceiptPdf(file: File, dialogTitle: string): Promise<void> {
  let available = false;
  try {
    available = await Sharing.isAvailableAsync();
  } catch (error) {
    logReceiptPdfFailure("share", "sharing-availability", error, file.uri, true);
    throw new Error("Unable to open sharing options.");
  }
  if (!available) {
    log("share-unavailable", { operation: "share", stage: "sharing-availability", uriScheme: "file", base64Present: true });
    throw new Error("Unable to open sharing options.");
  }
  try {
    await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle, UTI: "com.adobe.pdf" });
    log("share-sheet-opened", { operation: "share", stage: "shareAsync", uriScheme: "file", base64Present: true });
  } catch (error) {
    logReceiptPdfFailure("share", "shareAsync", error, file.uri, true);
    throw new Error("Unable to open sharing options.");
  }
}
