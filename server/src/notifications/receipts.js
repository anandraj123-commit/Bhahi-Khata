import { Notification, Device } from "../models.js";
const allowedCodes = new Set([
  "DeviceNotRegistered",
  "MessageTooBig",
  "MessageRateExceeded",
  "MismatchSenderId",
  "InvalidCredentials",
]);
export async function pollNotificationReceipts() {
  if (process.env.ADMIN_NOTIFICATION_PUSH_ENABLED !== "true") return;
  const now = new Date();
  for (let count = 0; count < 20; count++) {
    const row = await Notification.findOneAndUpdate(
      {
        campaignMode: process.env.APP_MODE,
        receiptState: "pending",
        receiptNextAt: { $lte: now },
        $or: [
          { receiptLeaseUntil: { $exists: false } },
          { receiptLeaseUntil: { $lte: now } },
        ],
      },
      {
        $set: { receiptLeaseUntil: new Date(Date.now() + 60000) },
        $inc: { receiptAttempts: 1 },
      },
      { new: true, sort: { receiptNextAt: 1, _id: 1 } },
    )
      .select("+pushTickets")
      .lean();
    if (!row) break;
    const lease = row.receiptLeaseUntil;
    let tickets = row.pushTickets || [];
    try {
      const expired =
        Date.now() -
          new Date(row.pushClaimedAt || row.createdAt || 0).getTime() >
        24 * 60 * 60000;
      if (expired)
        tickets = tickets.map((t) =>
          t.status === "pending"
            ? {
                ...t,
                status: "unknown",
                code: "RECEIPT_EXPIRED",
                checkedAt: new Date(),
              }
            : t,
        );
      else {
        const ids = tickets
          .filter((t) => t.status === "pending")
          .map((t) => t.id);
        if (ids.length) {
          const response = await fetch(
            "https://exp.host/--/api/v2/push/getReceipts",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(process.env.EXPO_ACCESS_TOKEN
                  ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
                  : {}),
              },
              body: JSON.stringify({ ids }),
              signal: AbortSignal.timeout(15000),
            },
          );
          if (!response.ok) throw Error("Receipt provider unavailable");
          const result = await response.json();
          if (
            !result.data ||
            typeof result.data !== "object" ||
            Array.isArray(result.data)
          )
            throw Error("Invalid receipt response");
          tickets = tickets.map((t) => {
            const r = result.data[t.id];
            if (
              t.status !== "pending" ||
              !r ||
              !["ok", "error"].includes(r.status)
            )
              return t;
            return {
              ...t,
              status: r.status,
              code:
                r.status === "error"
                  ? allowedCodes.has(r.details?.error)
                    ? r.details.error
                    : "PROVIDER_ERROR"
                  : undefined,
              checkedAt: new Date(),
            };
          });
        }
      }
      for (const t of tickets)
        if (t.code === "DeviceNotRegistered" && t.deviceUpdatedAt)
          await Device.deleteMany({
            shopId: row.shopId,
            token: t.token,
            updatedAt: { $lte: t.deviceUpdatedAt },
          });
      const pending = tickets.some((t) => t.status === "pending");
      await Notification.updateOne(
        { _id: row._id, receiptLeaseUntil: lease },
        {
          $set: {
            pushTickets: tickets,
            receiptState: pending
              ? "pending"
              : tickets.some((t) => t.status === "unknown")
                ? "unknown"
                : "complete",
            receiptNextAt: new Date(Date.now() + 15 * 60000),
          },
          $unset: { receiptLeaseUntil: 1 },
        },
      );
    } catch {
      await Notification.updateOne(
        { _id: row._id, receiptLeaseUntil: lease },
        {
          $set: {
            receiptNextAt: new Date(
              Date.now() +
                Math.min(60, 5 * Math.max(1, row.receiptAttempts)) * 60000,
            ),
          },
          $unset: { receiptLeaseUntil: 1 },
        },
      );
    }
  }
}
