import * as Print from "expo-print";
import { EncodingType, File, Paths } from "expo-file-system";
import type { TransactionReceipt } from "./transactionReceipt";
import { transactionReceiptHtml } from "./transactionReceiptPdf";

type ReceiptFile = File;

export type GeneratedReceiptPdf = { file: ReceiptFile; base64: string };

function logReceiptPdf(event: string, details: Record<string, unknown>) {
  if (__DEV__) console.info("[receipt-pdf]", event, details);
}

export function logReceiptPdfFailure(operation: string, stage: string, error: unknown, uri?: string, hasBase64?: boolean) {
  if (!__DEV__) return;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown } | null;
  const message = typeof candidate?.message === "string"
    ? candidate.message.replace(/(?:file|content):\/\/[^\s)'\"]+/gi, "<uri>").replace(/\/(?:data|storage|sdcard)\/[^\s)'\"]+/gi, "<path>").slice(0, 160)
    : "unknown";
  console.warn("[receipt-pdf] operation-failed", {
    operation,
    stage,
    errorName: typeof candidate?.name === "string" ? candidate.name : "unknown",
    errorCode: typeof candidate?.code === "string" || typeof candidate?.code === "number" ? candidate.code : undefined,
    message,
    uriScheme: uri?.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || (uri ? "unknown" : undefined),
    base64Present: hasBase64,
  });
}

function safeMetadata(file: ReceiptFile) {
  try {
    return { exists: file.exists, size: file.size };
  } catch {
    return { metadataReadable: false };
  }
}

/**
 * Expo Print can return the exact rendered file as base64. Validate its encoded
 * bytes here instead of routing a cache file through FileSystemFile.bytes(),
 * whose Android read path is a separate native module and can reject Print's
 * cache URI even after Print itself has read and encoded that file.
 */
export function isValidGeneratedPdfBase64(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const encoded = value.replace(/\s/g, "");
  // Base64 for the five-byte PDF signature "%PDF-" begins with "JVBERi0".
  return encoded.length >= 16
    && encoded.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    && encoded.startsWith("JVBERi0");
}

export async function generateTransactionReceiptPdf(receipt: TransactionReceipt): Promise<GeneratedReceiptPdf> {
  let result: Awaited<ReturnType<typeof Print.printToFileAsync>>;
  try {
    result = await Print.printToFileAsync({
      html: transactionReceiptHtml(receipt), width: 595, height: 842,
      margins: { top: 32, bottom: 32, left: 38, right: 38 },
      // expo-print reads the generated cache file natively and returns the bytes
      // with the URI. This avoids a second Android FileSystem read permission path.
      base64: true,
    });
  } catch (error) {
    logReceiptPdfFailure("generate", "printToFileAsync", error);
    throw new Error("PDF generation failed.");
  }

  const uri = result && typeof result.uri === "string" ? result.uri : "";
  const scheme = uri.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || "none";
  logReceiptPdf("generation-finished", {
    uriReturned: !!uri,
    scheme,
    numberOfPages: result?.numberOfPages,
    encodedBytesPresent: typeof result?.base64 === "string",
    encodedLength: typeof result?.base64 === "string" ? result.base64.length : 0,
  });
  if (!uri || !uri.startsWith("file://")) throw new Error("PDF generation failed.");
  if (!isValidGeneratedPdfBase64(result?.base64)) {
    logReceiptPdf("pdf-validation-failed", { operation: "generate", stage: "print-base64-signature", uriReturned: true, scheme, base64Present: typeof result?.base64 === "string" });
    throw new Error("Generated PDF could not be read.");
  }
  const file = new File(uri);
  logReceiptPdf("pdf-validated", { scheme, ...safeMetadata(file), validation: "expo-print-base64-pdf-header" });
  return { file, base64: result.base64 };
}

/** Write verified bytes to a fresh app-cache path exposed to the native share provider. */
export function createShareableReceiptPdf(base64: string, fileName: string): File {
  if (!isValidGeneratedPdfBase64(base64)) throw new Error("Generated PDF could not be read.");
  const stem = fileName.replace(/\.pdf$/i, "");
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  let file: File | undefined;
  try {
    file = new File(Paths.cache, `${stem}_${suffix}.pdf`);
    file.write(base64, { encoding: EncodingType.Base64 });
    const metadata = safeMetadata(file);
    logReceiptPdf("share-file-written", { scheme: "file", ...metadata, base64Present: true });
    if (!metadata.exists || typeof metadata.size !== "number" || metadata.size <= 0) {
      throw new Error("share-file-not-readable");
    }
    return file;
  } catch (error) {
    logReceiptPdfFailure("share", file ? "write-cache-file" : "create-cache-file", error, file?.uri, true);
    try { file?.delete(); } catch { /* Best-effort cleanup of a partial temporary file. */ }
    throw new Error("Unable to prepare PDF for sharing.");
  }
}
