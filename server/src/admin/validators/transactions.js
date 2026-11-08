import { z } from "zod";
const text = z.string().trim().min(1).max(100).optional();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  )
  .optional();
export const transactionFilters = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce
      .number()
      .refine((v) => [20, 50, 100].includes(v))
      .default(20),
    shopId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
    q: text,
    shopName: text,
    shopPhone: text,
    name: text,
    phone: text,
    address: text,
    customerId: text,
    clientId: text,
    method: text,
    customerStatus: z
      .enum(["active", "disabled", "removed", "invalid"])
      .optional(),
    archived: z.enum(["true", "false"]).optional(),
    type: z.enum(["credit", "payment", "refund"]).optional(),
    transactionStatus: z.enum(["recorded", "conflict_resolved"]).optional(),
    hasNotes: z.enum(["true", "false"]).optional(),
    edited: z.enum(["true", "false"]).optional(),
    amountMin: z.coerce.number().finite().min(0).max(1e12).optional(),
    amountMax: z.coerce.number().finite().min(0).max(1e12).optional(),
    dateFrom: day,
    dateTo: day,
    createdAtFrom: day,
    createdAtTo: day,
    updatedAtFrom: day,
    updatedAtTo: day,
    sort: z
      .enum([
        "date",
        "createdAt",
        "updatedAt",
        "amountPaise",
        "type",
        "shop.name",
        "name",
      ])
      .default("date"),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const k of ["date", "createdAt", "updatedAt"])
      if (v[k + "From"] && v[k + "To"] && v[k + "From"] > v[k + "To"])
        ctx.addIssue({
          code: "custom",
          message: "Start date must not follow end date",
          path: [k + "From"],
        });
    if (
      v.amountMin !== undefined &&
      v.amountMax !== undefined &&
      v.amountMin > v.amountMax
    )
      ctx.addIssue({
        code: "custom",
        message: "Minimum must not exceed maximum",
        path: ["amountMin"],
      });
  });
