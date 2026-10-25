import { z } from "zod";
import { normalizeCustomerMobile } from "../utils/phone.js";

export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);
export const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\w-]+$/);
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
const moneySchema = (minimum = 0) =>
  z.number().finite().min(minimum).max(1e9).refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
    "Amount must have no more than two decimal places",
  );
export const customerSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    phone: z.string().max(32)
      .refine((value) => !value.trim() || normalizeCustomerMobile(value) !== null,
        "Enter a valid 10-digit Indian mobile number")
      .transform((value) => normalizeCustomerMobile(value) || "")
      .default(""),
    whatsappNumber: z.string().max(32)
      .refine((value) => normalizeCustomerMobile(value) !== null,
        "Enter a valid 10-digit Indian WhatsApp number beginning with 6–9")
      .transform((value) => normalizeCustomerMobile(value) || "")
      .optional(),
    address: z.string().max(500).default(""),
    opening: moneySchema(),
    openingAdvance: moneySchema().default(0),
    openingDate: daySchema.optional(),
    limit: moneySchema(),
    reminder: z.boolean(),
    status: z.boolean().optional(),
    disabled: z.boolean().optional(),
    removed: z.boolean().optional(),
  })
  .strict()
  .refine((value) => {
    const values = [value.status, value.disabled, value.removed];
    return values.every((item) => item === undefined) ||
      (values.every((item) => typeof item === "boolean") && values.filter(Boolean).length === 1);
  }, { message: "Customer lifecycle flags are invalid", path: ["status"] });
export const customerCreateSchema = customerSchema.safeExtend({
  createdAt: z.string().datetime().optional(),
}).refine((value) =>
  (value.status === undefined && value.disabled === undefined && value.removed === undefined) ||
  (value.status === true && value.disabled === false && value.removed === false),
{ message: "New customers must start active", path: ["status"] });
export const customerLifecycleSchema = z.object({
  target: z.enum(["active", "disabled", "removed"]),
  operationId: idSchema,
  baseVersion: z.number().int().min(1),
  baseResolutionVersion: z.number().int().min(1),
  reason: z.string().max(300).optional(),
}).strict();
export const customerConflictSchema = z.object({
  resolutionId: idSchema,
  expectedVersion: z.number().int().min(1),
  expectedResolutionVersion: z.number().int().min(1).default(1),
  choice: z.enum(["keep_local", "keep_server"]),
  proposed: customerSchema,
  localDeleted: z.boolean().default(false),
  lifecycleChange: z.boolean().default(false),
  localAt: z.string().datetime().optional(),
});
export const entrySchema = z
  .object({
    id: idSchema,
    customerId: idSchema,
    type: z.enum(["credit", "payment", "refund"]),
    amount: moneySchema(0.01),
    date: daySchema,
    recordedAt: z.string().datetime().optional(),
    note: z.string().max(1000).default(""),
    method: z.string().max(50).default("Cash"),
    reference: z.string().max(120).default(""),
    appliedToUdhari: z.number().finite().min(0).optional(),
    addedToAdvance: z.number().finite().min(0).optional(),
    advanceApplied: z.number().finite().min(0).optional(),
    // Accept and discard this retired property from requests by older clients.
    due: z.unknown().optional(),
  })
  .strict()
  .transform(({ due: _legacyDue, ...entry }) => entry);
export const backupSchema = z
  .object({
    shop: z.object({
      name: z.string().max(120),
      owner: z.string().max(120),
      address: z.string().max(500),
      phone: z.string().max(20),
      whatsapp: z.string().max(20),
    }),
    customers: z
      .array(
        customerSchema.safeExtend({
          createdAt: z.string().datetime().optional(),
          openingDate: daySchema.optional(),
        }),
      )
      .max(5000),
    entries: z.array(entrySchema).max(50000),
    deletedEntries: z.array(z.object({
      id: idSchema,
      customerId: idSchema,
      type: z.enum(["credit", "payment", "refund"]),
      amount: moneySchema(0.01),
      date: daySchema,
      recordedAt: z.string().datetime().optional(),
      createdAt: z.string().datetime().optional(),
      note: z.string().max(1000).default(""),
      method: z.string().max(50).default("Cash"),
      reference: z.string().max(120).default(""),
      appliedToUdhari: z.number().finite().min(0).optional(),
      addedToAdvance: z.number().finite().min(0).optional(),
      advanceApplied: z.number().finite().min(0).optional(),
      serverVersion: z.number().int().min(1).optional(),
      resolutionVersion: z.number().int().min(1).optional(),
      deletedAt: z.string().datetime(),
    }).strict()).max(50000).optional(),
    audit: z
      .array(
        z.object({
          id: idSchema,
          action: z.string().max(250),
          date: z.string().datetime().or(daySchema),
          before: entrySchema.optional(),
          after: entrySchema.optional(),
        }),
      )
      .max(10000),
    language: z.string().max(20),
    reminders: z.object({
      enabled: z.boolean(),
      day: z.string().max(30),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      minimum: z.string().regex(/^\d+(\.\d{1,2})?$/),
      whatsapp: z.boolean(),
      sms: z.boolean(),
    }),
    defaultMethod: z.string().max(50),
    read: z.array(idSchema).max(10000),
  })
  .strict();
export const shopSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    owner: z.string().trim().min(1).max(120),
    address: z.string().max(500),
    phone: phoneSchema,
    whatsapp: z.string().trim().max(20).refine(
      (value) => !value || /^[6-9]\d{9}$/.test(value) || /^\+[1-9]\d{7,14}$/.test(value),
      "Enter a valid WhatsApp number",
    ),
    language: z.string().max(20).optional(),
    defaultMethod: z.string().max(50).optional(),
    reminders: z
      .object({
        enabled: z.boolean(),
        day: z.string().max(30),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        minimum: z.string().regex(/^\d+(\.\d{1,2})?$/),
        whatsapp: z.boolean(),
        sms: z.boolean(),
      })
      .optional(),
  })
  .strict();
export const shopRegistrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  owner: z.string().trim().min(1).max(120),
  address: z.string().trim().max(500).default(""),
  whatsapp: z.string().trim().max(20).refine(
    (value) => !value || /^[6-9]\d{9}$/.test(value) || /^\+[1-9]\d{7,14}$/.test(value),
    "Enter a valid WhatsApp number",
  ).default(""),
  language: z.string().trim().max(20).optional(),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-F0-9]{10}$/).optional(),
}).strict();
export const shopConflictSchema = z.object({
  resolutionId: idSchema,
  expectedVersion: z.number().int().min(1),
  expectedResolutionVersion: z.number().int().min(1).default(1),
  choice: z.enum(["keep_local", "keep_server"]),
  proposed: shopSchema,
  localAt: z.string().datetime().optional(),
});
