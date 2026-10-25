import React, { useContext, useEffect, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, View } from "react-native";
import type { File } from "expo-file-system";
import { CustomerContactInfo } from "./CustomerContactInfo";
import { TransactionTypeBadge } from "./TransactionTypeBadge";
import type { Customer, Entry } from "./model";
import { LanguageContext, Text, t } from "./i18n";
import { Button, Card, colors, Hint, Icon, Row, s, Title } from "./ui";
import { receiptCurrency, receiptDateTime, type TransactionReceipt } from "./transactionReceipt";
import { safeReceiptFilename } from "./transactionReceiptPdf";
import { createShareableReceiptPdf, generateTransactionReceiptPdf, type GeneratedReceiptPdf } from "./transactionReceiptFile";
import { saveReceiptPdfToAndroid, shareReceiptPdf } from "./transactionReceiptExport";

type Props = {
  entry: Entry;
  customer: Customer | null;
  editable: boolean;
  deleted?: boolean;
  deletedOn?: string;
  actionBusy?: boolean;
  loadReceipt: (entryId: string) => Promise<TransactionReceipt>;
  onEdit: () => void;
  onDelete: () => void;
  onRestore?: () => void;
  onViewCustomer: () => void;
};

function safePdfName(receipt: TransactionReceipt) {
  return safeReceiptFilename(receipt.entry.date, receipt.entry.id);
}

export function TransactionDetails({ entry, customer, editable, deleted = false, deletedOn, actionBusy = false, loadReceipt, onEdit, onDelete, onRestore, onViewCustomer }: Props) {
  const language = useContext(LanguageContext);
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [busy, setBusy] = useState<"download" | "share" | "">("");

  useEffect(() => {
    let current = true;
    setReceipt(null);
    setReceiptError("");
    if (deleted) return () => { current = false; };
    void loadReceipt(entry.id).then((value) => {
      if (current) setReceipt(value);
    }).catch((error) => {
      if (current) setReceiptError(error instanceof Error ? error.message : "Local receipt details are unavailable.");
    });
    return () => { current = false; };
  }, [entry.id, entry.serverVersion, loadReceipt, deleted]);

  const withPdf = async (action: "download" | "share") => {
    if (busy || !receipt) return;
    setBusy(action);
    let generated: GeneratedReceiptPdf | null = null;
    let shareFile: File | null = null;
    let shared = false;
    try {
      // Re-read one authenticated SQLite snapshot at action time. No API request is made.
      const latest = await loadReceipt(entry.id);
      generated = await generateTransactionReceiptPdf(latest);
      if (action === "download") {
        if (Platform.OS === "android") {
          const saved = await saveReceiptPdfToAndroid(generated.base64, safePdfName(latest));
          if (saved) Alert.alert("PDF saved", "The receipt was saved in the folder you selected.");
        } else {
          shareFile = createShareableReceiptPdf(generated.base64, safePdfName(latest));
          await shareReceiptPdf(shareFile, "Save transaction receipt");
        }
      } else {
        shareFile = createShareableReceiptPdf(generated.base64, safePdfName(latest));
        if (__DEV__) console.info("[receipt-pdf] share-file-ready", { operation: "share", stage: "shareAsync", uriScheme: "file", exists: shareFile.exists, size: shareFile.size, base64Present: true });
        await shareReceiptPdf(shareFile, "Share transaction receipt");
        shared = true;
      }
    } catch (error) {
      Alert.alert(action === "download" ? "Could not save receipt" : "Could not share receipt", error instanceof Error ? error.message : action === "download" ? "Unable to save PDF." : "Unable to open sharing options.");
    } finally {
      if (generated?.file) {
        try { generated.file.delete(); } catch { /* Cache cleanup must not change the export result. */ }
      }
      if (shareFile) {
        const temporary = shareFile;
        // Give the receiving Android app time to consume its content URI after the chooser closes.
        if (shared) setTimeout(() => { try { temporary.delete(); } catch { /* Best-effort cache cleanup. */ } }, 60_000);
        else try { temporary.delete(); } catch { /* Cache cleanup must not change the save result. */ }
      }
      setBusy("");
    }
  };

  const dayText = receipt?.date || (Number.isFinite(Date.parse(`${entry.date}T12:00:00`))
    ? new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : entry.date);
  const timeText = receipt?.time || (entry.recordedAt || entry.createdAt ? receiptDateTime(entry).time : undefined);
  const money = (amount: number) => `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const transactionLabel = receipt?.label || (entry.type === "credit" ? "Udhari Given" : entry.type === "refund" ? "Advance Refund" : "Payment Received");
  const palette = entry.type === "credit" ? { text: colors.red, background: colors.redBg } : entry.type === "refund" ? { text: colors.orange, background: colors.amberBg } : { text: colors.green, background: colors.greenBg };

  return <View style={styles.screen}>
    <Title>Transaction Details</Title>
    {customer ? <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`View customer ${customer.name}`} onPress={onViewCustomer}>
        <Text style={s.rowTitle}>{customer.name}</Text>
      </Pressable>
      <CustomerContactInfo customer={customer} compact />
    </Card> : <Card><Hint>Customer details are unavailable in this shop’s local cache.</Hint></Card>}
    <Card style={{ alignItems: "center", gap: 8 }}>
      <TransactionTypeBadge label={transactionLabel} />
      <Text style={[s.amount, { color: palette.text }]}>{money(entry.amount)}</Text>
    </Card>
    <Card>
      <Title>Transaction Information</Title>
      <Row icon="calendar-outline" title="Transaction Date" value={dayText} />
      {timeText ? <Row icon="time-outline" title="Transaction Time" value={`${timeText}${receipt?.timeZone ? ` (${receipt.timeZone})` : ""}`} /> : null}
      {!timeText ? <Row icon="time-outline" title="Transaction Time" value="Not recorded" /> : null}
      <Row icon="pricetag-outline" title="Transaction ID" value={entry.id} />
      {deleted && deletedOn ? <Row icon="trash-outline" title="Deleted On" value={new Date(deletedOn).toLocaleString("en-IN")} /> : null}
      {receipt?.pendingSync ? <View style={styles.pendingSync} accessibilityLabel="Pending Sync">
        <Icon name="cloud-upload-outline" size={16} color={colors.orange} />
        <Text style={styles.pendingSyncText}>Pending Sync</Text>
      </View> : null}
      {entry.method ? <Row icon="card-outline" title="Payment Mode" value={entry.method} /> : null}
      {entry.reference ? <Row icon="bookmark-outline" title="Reference" value={entry.reference} /> : null}
      <Row title="Description / Notes" value={entry.note?.trim() || "Not added"} />
      {entry.type === "payment" && entry.appliedToUdhari !== undefined ? <>
        <Row title="Adjusted Against Udhari" value={money(entry.appliedToUdhari)} />
        <Row title="Added to Advance" value={money(entry.addedToAdvance || 0)} />
      </> : null}
      {entry.type === "credit" && (entry.advanceApplied || 0) > 0 ? <Row title="Adjusted From Advance" value={money(entry.advanceApplied || 0)} /> : null}
    </Card>
    {receipt?.history ? <Card>
      <Title>Historical Balance Summary</Title>
      <Row title="Outstanding Before" value={receiptCurrency(receipt.history.before.outstanding)} />
      <Row title="Available Advance Before" value={receiptCurrency(receipt.history.before.advance)} />
      <Row title="Outstanding After" value={receiptCurrency(receipt.history.after.outstanding)} />
      <Row title="Available Advance After" value={receiptCurrency(receipt.history.after.advance)} />
      <Hint>{receipt.history.explanation}</Hint>
    </Card> : null}
    {deleted ? <Card><Hint>This transaction is deleted and excluded from active financial records. No active receipt can be generated.</Hint></Card> : null}
    {!deleted && receiptError ? <Card><Hint>{receiptError}</Hint></Card> : null}
    {!deleted ? <View style={styles.actionRow}>
      <View style={styles.actionCell}><Button icon="download-outline" title="Download PDF" loading={busy === "download"} disabled={!!busy || !receipt} onPress={() => void withPdf("download")} style={styles.download} /></View>
      <View style={styles.actionCell}><Button icon="share-outline" title="Share PDF" loading={busy === "share"} disabled={!!busy || !receipt} onPress={() => void withPdf("share")} style={styles.share} /></View>
    </View> : null}
    {deleted ? <Button icon="refresh-outline" title="Restore Transaction" loading={actionBusy} disabled={actionBusy} onPress={onRestore || (() => {})} /> : editable ? <View style={styles.actionRow}>
      <View style={styles.actionCell}><Button icon="create-outline" title="Edit" secondary onPress={onEdit} /></View>
      <View style={styles.actionCell}><Button icon="trash-outline" title="Delete" danger onPress={onDelete} /></View>
    </View> : <Hint>Historical transactions are read-only.</Hint>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { gap: 8 },
  actionRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  actionCell: { flex: 1, minWidth: 0 },
  pendingSync: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: colors.amberBg },
  pendingSyncText: { color: colors.orange, fontSize: 12, fontWeight: "700" },
  download: { backgroundColor: colors.blue, borderColor: colors.blue, minHeight: 48, paddingHorizontal: 8 },
  share: { backgroundColor: colors.green, borderColor: colors.green, minHeight: 48, paddingHorizontal: 8 },
});
