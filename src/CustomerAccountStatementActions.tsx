import React, { useContext, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, View } from "react-native";
import type { File } from "expo-file-system";
import { LanguageContext, t } from "./i18n";
import { Button, colors } from "./ui";
import type { CustomerAccountStatement } from "./customerAccountStatement";
import { customerAccountStatementHtml, safeCustomerStatementFilename } from "./customerAccountStatementPdf";
import { createShareableReceiptPdf, generateReceiptPdfFromHtml, type GeneratedReceiptPdf } from "./transactionReceiptFile";
import { saveReceiptPdfToAndroid, shareReceiptPdf } from "./transactionReceiptExport";

type Props = {
  customerId: string;
  loadStatement: (customerId: string) => Promise<CustomerAccountStatement>;
};

export function CustomerAccountStatementActions({ customerId, loadStatement }: Props) {
  const language = useContext(LanguageContext);
  const [busy, setBusy] = useState<"download" | "share" | "">("");
  const busyRef = useRef(false);

  const exportStatement = async (action: "download" | "share") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    let generated: GeneratedReceiptPdf | null = null;
    let shareFile: File | null = null;
    let shareOpened = false;
    try {
      // Both actions rebuild from one fresh authenticated, account-scoped SQLite snapshot.
      const statement = await loadStatement(customerId);
      const html = customerAccountStatementHtml(statement);
      const filename = safeCustomerStatementFilename(statement);
      generated = await generateReceiptPdfFromHtml(html);
      if (action === "download" && Platform.OS === "android") {
        const saved = await saveReceiptPdfToAndroid(generated.base64, filename);
        if (saved) Alert.alert(t("PDF saved", language));
        return;
      }

      shareFile = createShareableReceiptPdf(generated.base64, filename);
      await shareReceiptPdf(shareFile, action === "download"
        ? t("Save customer account statement", language)
        : t("Share customer account statement", language));
      shareOpened = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : t("Unable to export the customer account statement.", language);
      Alert.alert(action === "download" ? t("Unable to save", language) : t("Unable to share", language), message);
    } finally {
      if (generated?.file) {
        try { generated.file.delete(); } catch { /* Cleanup cannot change the export result. */ }
      }
      if (shareFile) {
        const temporary = shareFile;
        if (shareOpened) setTimeout(() => { try { temporary.delete(); } catch { /* Best-effort cleanup after the receiving app can read it. */ } }, 60_000);
        else try { temporary.delete(); } catch { /* Best-effort cleanup of a failed share. */ }
      }
      busyRef.current = false;
      setBusy("");
    }
  };

  return <View style={styles.row}>
    <View style={styles.cell}><Button
      icon="download-outline"
      title={t("Download PDF", language)}
      accessibilityLabel={t("Download PDF", language)}
      loading={busy === "download"}
      disabled={!!busy}
      onPress={() => void exportStatement("download")}
      style={styles.download}
    /></View>
    <View style={styles.cell}><Button
      icon="share-outline"
      title={t("Share PDF", language)}
      accessibilityLabel={t("Share PDF", language)}
      loading={busy === "share"}
      disabled={!!busy}
      onPress={() => void exportStatement("share")}
      style={styles.share}
    /></View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignItems: "stretch", marginTop: 12, marginBottom: 8 },
  cell: { flex: 1, minWidth: 0 },
  download: { minHeight: 48, paddingHorizontal: 6, backgroundColor: colors.blue, borderColor: colors.blue },
  share: { minHeight: 48, paddingHorizontal: 6, backgroundColor: colors.green, borderColor: colors.green },
});
