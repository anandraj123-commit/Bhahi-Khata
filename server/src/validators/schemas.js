import { z } from "zod";

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
export const customerSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(120),
    phone: z
      .string()
      .max(20)
      .refine(
        (value) =>
          !value ||
          /^[6-9]\d{9}$/.test(value) ||
          /^\+[1-9]\d{7,14}$/.test(value),
      )
      .default(""),
    address: z.string().max(500).default(""),
    opening: z.number().finite().min(0).max(1e9),
    limit: z.number().finite().min(0).max(1e9),
    reminder: z.boolean(),
  })
  .strict();
export const customerConflictSchema = z.object({
  resolutionId: idSchema,
  expectedVersion: z.number().int().min(1),
  expectedResolutionVersion: z.number().int().min(1).default(1),
  choice: z.enum(["keep_local", "keep_server"]),
  proposed: customerSchema,
  localDeleted: z.boolean().default(false),
  localAt: z.string().datetime().optional(),
});
export const entrySchema = z
  .object({
    id: idSchema,
    customerId: idSchema,
    type: z.enum(["credit", "payment"]),
    amount: z.number().finite().min(0.01).max(1e9),
    date: daySchema,
    note: z.string().max(1000).default(""),
    method: z.string().max(50).default("Cash"),
    due: z.union([z.literal(""), daySchema]).default(""),
  })
  .strict();
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
        customerSchema.extend({ createdAt: z.string().datetime().optional() }),
      )
      .max(5000),
    entries: z.array(entrySchema).max(50000),
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
}).strict();
export const shopConflictSchema = z.object({
  resolutionId: idSchema,
  expectedVersion: z.number().int().min(1),
  expectedResolutionVersion: z.number().int().min(1).default(1),
  choice: z.enum(["keep_local", "keep_server"]),
  proposed: shopSchema,
  localAt: z.string().datetime().optional(),
});
