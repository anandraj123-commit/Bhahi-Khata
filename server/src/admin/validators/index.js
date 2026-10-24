import { z } from "zod";
export const id = z.string().regex(/^[a-f\d]{24}$/i);
export const password = z.string().min(14).max(128);
export const role = z.enum(["SUPER_ADMIN", "ADMIN", "SUPPORT"]);
export const credentials = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase().trim()),
    password: z.string().min(1).max(128),
  })
  .strict();
export const reauth = z
  .object({ password: z.string().min(1).max(128) })
  .strict();
export const createAdmin = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase().trim()),
    name: z.string().trim().min(2).max(100),
    role,
    password,
  })
  .strict();
export const updateAdmin = z
  .object({ role: role.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const changePassword = z.object({ newPassword: password }).strict();
export const passwordResetRequest = z
  .object({
    email: z.string().email().max(254).transform((s) => s.toLowerCase().trim()),
  })
  .strict();
export const passwordResetCompletion = z
  .object({
    token: z.string().regex(/^[a-f\d]{64}$/i),
    newPassword: password,
  })
  .strict();
export const profile = z
  .object({ name: z.string().trim().min(2).max(100) })
  .strict();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
export const filters = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    q: z.string().trim().max(100).default(""),
    status: z.string().max(30).default(""),
    plan: z
      .string()
      .regex(/^[a-zA-Z0-9_-]*$/)
      .max(50)
      .default(""),
    from: date.optional(),
    to: date.optional(),
    sort: z.enum(["newest", "oldest", "name"]).default("newest"),
    shopId: id.optional(),
    adminId: id.optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Invalid date range",
  });
const customerRange = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    q: z.string().trim().max(100).default(""),
    shopId: id.optional(),
    status: z.enum(["", "active", "disabled", "removed"]).default(""),
    from: date.optional(),
    to: date.optional(),
    sort: z.enum(["newest", "oldest", "name"]).default("newest"),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Invalid date range",
  });
export const customerFilters = customerRange.refine(
  (v) => !v.from || !v.to || Date.parse(v.to) - Date.parse(v.from) <= 365 * 86400000,
  { message: "Choose a date range of no more than one year" },
);
export const customerShopFilters = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    q: z.string().trim().max(100).default(""),
  })
  .strict();
export const customerLimitUpdate = z
  .object({
    customerLimit: z.number().int().positive().safe().nullable(),
    unlimitedCustomers: z.boolean(),
    expectedVersion: z.number().int().positive().safe(),
  })
  .strict()
  .refine(
    (value) =>
      value.unlimitedCustomers
        ? value.customerLimit === null
        : value.customerLimit !== null,
    { message: "A limited plan requires a positive whole-number limit" },
  );
export const referralSettingsUpdate = z.object({
  expectedVersion: z.number().int().positive().safe(),
  enabled: z.boolean(),
  referrerRewardAmountMinor: z.number().int().min(1).max(100000000).safe(),
  referredRewardAmountMinor: z.number().int().min(1).max(100000000).safe(),
  minimumCustomers: z.number().int().min(1).max(50000).safe(),
}).strict();
const pricingPercent = z.number().finite().min(0).max(100).refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  "Use at most two decimal places",
);
const planDuration = z.object({
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  basePriceMinor: z.number().int().positive().safe(),
  discountPercent: pricingPercent,
  taxPercent: pricingPercent.default(0),
  isActive: z.boolean().default(true),
}).strict();
export const planConfigurationUpdate = z.object({
  expectedVersion: z.number().int().positive().safe(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500),
  customerLimit: z.number().int().positive().safe().nullable(),
  unlimitedCustomers: z.boolean(),
  features: z.array(z.string().trim().min(1).max(120)).max(20),
  entitlements: z.record(z.string().max(64), z.union([
    z.string().max(300), z.number().finite(), z.boolean(), z.null(),
  ])).refine((value) => Object.keys(value).length <= 50, "Too many entitlements"),
  enabled: z.boolean(),
  displayOrder: z.number().int().min(0).max(1000),
  durations: z.array(planDuration).max(4),
}).strict().refine(
  (value) => value.unlimitedCustomers ? value.customerLimit === null : value.customerLimit !== null,
  { message: "A limited plan requires a positive customer limit" },
).refine(
  (value) => new Set(value.durations.map((duration) => duration.months)).size === value.durations.length,
  { message: "Billing durations must be unique" },
);
const boundedCustomerDateRange = z
  .object({
    from: date.optional(),
    to: date.optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "Invalid date range",
  })
  .refine(
    (value) =>
      !value.from ||
      !value.to ||
      Date.parse(value.to) - Date.parse(value.from) <= 365 * 86400000,
    { message: "Choose a date range of no more than one year" },
  );
export const customerTransactionFilters = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    q: z.string().trim().max(100).default(""),
    type: z.enum(["", "credit", "payment", "refund", "opening"]).default(""),
    status: z
      .enum(["", "recorded", "voided", "conflict_resolved"])
      .default(""),
    sort: z.enum(["newest", "oldest"]).default("newest"),
    ...boundedCustomerDateRange.shape,
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "Invalid date range",
  })
  .refine(
    (value) =>
      !value.from ||
      !value.to ||
      Date.parse(value.to) - Date.parse(value.from) <= 365 * 86400000,
    { message: "Choose a date range of no more than one year" },
  );
export const customerStatementPeriod = z
  .object({ from: date, to: date })
  .strict()
  .refine((value) => value.from <= value.to, { message: "Invalid date range" })
  .refine(
    (value) => Date.parse(value.to) - Date.parse(value.from) <= 365 * 86400000,
    { message: "Choose a date range of no more than one year" },
  );
export function parse(schema, value) {
  return schema.parse(value);
}
