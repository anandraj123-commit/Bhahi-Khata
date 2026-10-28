import React, { useRef, useState } from "react";
import { Alert, Platform, StyleSheet, View } from "react-native";
import type { File } from "expo-file-system";
import { LanguageContext, t } from "./i18n";
import { Button, colors } from "./ui";
import { downloadReportFilename, type DownloadReport, type DownloadReportKind } from "./downloadReports";
import { downloadReportHtml } from "./downloadReportsPdf";
import { createShareableReceiptPdf, generateReceiptPdfFromHtml, type GeneratedReceiptPdf } from "./transactionReceiptFile";
import { saveReceiptPdfToAndroid, shareReceiptPdf } from "./transactionReceiptExport";

type Props = {
  kind: DownloadReportKind;
  customerId: string | null;
  fromDate: string;
  toDate: string;
  disabled?: boolean;
  loadReport: (request: { kind: DownloadReportKind; customerId: string | null; fromDate?: string; toDate?: string }) => Promise<DownloadReport>;
  onReportLoaded?: (report: DownloadReport) => void;
};

export function DownloadReportActions({ kind, customerId, fromDate, toDate, disabled = false, loadReport, onReportLoaded }: Props) {
  const language = React.useContext(LanguageContext);
  const [busy, setBusy] = useState<"download" | "share" | "">("");
  const busyRef = useRef(false);

  const run = async (action: "download" | "share") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    let generated: GeneratedReceiptPdf | null = null;
    let shareFile: File | null = null;
    let shareOpened = false;
    try {
      const report = await loadReport({ kind, customerId, ...(kind === "custom" ? { fromDate, toDate } : {}) });
      onReportLoaded?.(report);
      if (!report.transactions.length) return;
      const filename = downloadReportFilename(report);
      generated = await generateReceiptPdfFromHtml(downloadReportHtml(report));
      if (action === "download" && Platform.OS === "android") {
        const saved = await saveReceiptPdfToAndroid(generated.base64, filename);
        if (saved) Alert.alert(t("PDF saved", language));
        return;
      }
      shareFile = createShareableReceiptPdf(generated.base64, filename);
      await shareReceiptPdf(shareFile, action === "download" ? t("Save transaction report", language) : t("Share transaction report", language));
      shareOpened = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const translated = message === "Invalid date range."
        ? t(message, language)
        : t("Please try again.", language);
      Alert.alert(action === "download" ? t("Unable to save", language) : t("Unable to share", language), translated);
    } finally {
      if (generated?.file) {
        try { generated.file.delete(); } catch { /* Cleanup cannot change the completed export. */ }
      }
      if (shareFile) {
        const temporary = shareFile;
        if (shareOpened) setTimeout(() => { try { temporary.delete(); } catch { /* Allow the receiving app time to read the attachment. */ } }, 60_000);
        else try { temporary.delete(); } catch { /* Best-effort cleanup. */ }
      }
      busyRef.current = false;
      setBusy("");
    }
  };

  return <View style={styles.row}>
    <View style={styles.cell}><Button icon="download-outline" title={t("Download PDF", language)} accessibilityLabel={`${t("Download PDF", language)} — ${t("Reports", language)}`} loading={busy === "download"} disabled={disabled || !!busy} onPress={() => void run("download")} style={styles.download} /></View>
    <View style={styles.cell}><Button icon="share-outline" title={t("Share PDF", language)} accessibilityLabel={`${t("Share PDF", language)} — ${t("Reports", language)}`} loading={busy === "share"} disabled={disabled || !!busy} onPress={() => void run("share")} style={styles.share} /></View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "stretch", marginTop: 12 },
  cell: { flex: 1, minWidth: 140 },
  download: { minHeight: 48, paddingHorizontal: 6, backgroundColor: colors.blue, borderColor: colors.blue },
  share: { minHeight: 48, paddingHorizontal: 6, backgroundColor: colors.green, borderColor: colors.green },
});
