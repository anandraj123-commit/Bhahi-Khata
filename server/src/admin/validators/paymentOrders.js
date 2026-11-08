import { z } from "zod";
import { id } from "./index.js";
const optional = z.string().trim().max(100).optional();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  )
  .optional();
export const orderPagination = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const paymentOrderFilters = orderPagination
  .extend({
    q: optional,
    shopId: id.optional(),
    status: z
      .enum([
        "",
        "created",
        "pending",
        "paid",
        "failed",
        "refunded",
        "partially_refunded",
      ])
      .optional(),
    paymentStatus: z
      .enum([
        "",
        "SUCCESS",
        "FAILED",
        "PENDING",
        "USER_DROPPED",
        "CANCELLED",
        "VOID",
        "NOT_ATTEMPTED",
      ])
      .optional(),
    gatewayStatus: z
      .enum([
        "",
        "ACTIVE",
        "PAID",
        "EXPIRED",
        "TERMINATED",
        "TERMINATION_REQUESTED",
      ])
      .optional(),
    reconciliation: z
      .enum(["", "pending", "error", "checked", "unverified"])
      .optional(),
    subscriptionStatus: z
      .enum([
        "",
        "active",
        "paused",
        "scheduled",
        "expired",
        "cancelled",
        "missing",
      ])
      .optional(),
    refundStatus: z
      .enum(["", "SUCCESS", "PENDING", "CANCELLED", "ONHOLD", "FAILED"])
      .optional(),
    plan: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]*$/)
      .max(50)
      .optional(),
    durationMonths: z.coerce.number().int().min(1).max(120).optional(),
    attempts: z
      .enum(["", "none", "multiple", "successful", "failed", "pending"])
      .optional(),
    attention: z.enum(["true"]).optional(),
    dateField: z
      .enum([
        "createdAt",
        "updatedAt",
        "checkoutExpiresAt",
        "latestPaymentTime",
      ])
      .default("createdAt"),
    from: day,
    to: day,
    amountMin: z.coerce.number().finite().min(0).max(1e12).optional(),
    amountMax: z.coerce.number().finite().min(0).max(1e12).optional(),
    sort: z
      .enum([
        "newest",
        "oldest",
        "name",
        "createdAt",
        "updatedAt",
        "amountMinor",
        "status",
        "shopName",
        "latestPaymentTime",
        "checkoutExpiresAt",
      ])
      .default("newest"),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.from && v.to && v.from > v.to)
      c.addIssue({ code: "custom", message: "Invalid date range" });
    if (
      v.amountMin !== undefined &&
      v.amountMax !== undefined &&
      v.amountMin > v.amountMax
    )
      c.addIssue({ code: "custom", message: "Invalid amount range" });
  });
export const orderRecordFilters = orderPagination
  .extend({
    kind: z.enum([
      "attempts",
      "subscriptions",
      "refunds",
      "webhooks",
      "audit",
      "adminAudit",
    ]),
  })
  .strict();
