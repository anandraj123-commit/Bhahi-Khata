import { z } from "zod";
const text = z.string().trim().max(100).optional();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  )
  .optional();
const amount = z.coerce.number().finite().min(0).max(1e12).optional();
export const financialFilters = z
  .object({
    view: z.enum([
      "recent",
      "outstanding",
      "udhari",
      "received",
      "recovered",
      "availableAdvance",
      "deposited",
      "refunded",
      "customers",
    ]),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    limit: z.coerce
      .number()
      .refine((v) => [20, 50, 100].includes(v))
      .default(20),
    exactCustomerId: text,
    q: text,
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
    type: z.enum(["credit", "payment", "refund", "opening"]).optional(),
    transactionStatus: z
      .enum(["recorded", "conflict_resolved", "opening"])
      .optional(),
    dateFrom: date,
    dateTo: date,
    createdAtFrom: date,
    createdAtTo: date,
    updatedAtFrom: date,
    updatedAtTo: date,
    amountMin: amount,
    amountMax: amount,
    outstandingMin: amount,
    outstandingMax: amount,
    availableAdvanceMin: amount,
    availableAdvanceMax: amount,
    outstandingPositive: z.enum(["true"]).optional(),
    availableAdvancePositive: z.enum(["true"]).optional(),
    sort: z
      .enum([
        "name",
        "amount",
        "outstanding",
        "availableAdvance",
        "date",
        "createdAt",
        "updatedAt",
      ])
      .optional(),
    direction: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const key of ["date", "createdAt", "updatedAt"])
      if (v[`${key}From`] && v[`${key}To`] && v[`${key}From`] > v[`${key}To`])
        ctx.addIssue({
          code: "custom",
          message: "Start date must not follow end date",
          path: [`${key}From`],
        });
    for (const key of ["amount", "outstanding", "availableAdvance"])
      if (
        v[`${key}Min`] !== undefined &&
        v[`${key}Max`] !== undefined &&
        v[`${key}Min`] > v[`${key}Max`]
      )
        ctx.addIssue({
          code: "custom",
          message: "Minimum must not exceed maximum",
          path: [`${key}Min`],
        });
    const customer = ["customers", "outstanding", "availableAdvance"].includes(
      v.view,
    );
    const irrelevant = customer
      ? [
          "clientId",
          "method",
          "type",
          "transactionStatus",
          "amountMin",
          "amountMax",
        ]
      : [
          "outstandingMin",
          "outstandingMax",
          "outstandingPositive",
          "availableAdvanceMin",
          "availableAdvanceMax",
          "availableAdvancePositive",
        ];
    if (irrelevant.some((key) => v[key] !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Filter is not applicable to this view",
      });
    if (!customer && ["outstanding", "availableAdvance"].includes(v.sort))
      ctx.addIssue({
        code: "custom",
        message: "Balance sorting is available on customer views",
      });
  });
