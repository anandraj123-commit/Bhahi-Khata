import { z } from "zod";
import { id } from "./index.js";
export const monitoringKind = z.enum([
  "attempts",
  "webhooks",
  "recoveries",
  "refunds",
]);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
export const monitoringFilters = z
  .object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce
      .number()
      .int()
      .refine((v) => [20, 50, 100].includes(v))
      .default(20),
    q: z.string().trim().max(100).default(""),
    shopId: id.optional(),
    status: z.string().max(40).default(""),
    eventType: z
      .string()
      .trim()
      .max(100)
      .regex(/^[A-Za-z0-9_]*$/)
      .default(""),
    from: day.optional(),
    to: day.optional(),
    dateField: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
    sort: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "End date must follow start date",
  });
