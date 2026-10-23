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
export function parse(schema, value) {
  return schema.parse(value);
}
