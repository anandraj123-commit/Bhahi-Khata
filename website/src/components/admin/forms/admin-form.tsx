"use client";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../shared/ui";
import { useState, useId } from "react";
export type FieldDefinition = {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  min?: number;
  optional?: boolean;
  options?: string[];
  autoComplete?: string;
};
export function AdminForm({
  fields,
  submitLabel,
  submitVariant = "default",
  onSubmit,
}: {
  fields: FieldDefinition[];
  submitLabel: string;
  submitVariant?: "default" | "outline" | "ghost" | "destructive";
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const formId = useId();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<Record<string, string>>({
    defaultValues: Object.fromEntries(
      fields.map((f) => [f.name, f.defaultValue || ""]),
    ),
  });
  return (
    <form
      className="a-stack"
      onSubmit={handleSubmit(async (values) => {
        setError("");
        const schema = z.object(
          Object.fromEntries(
            fields.map((field) => [
              field.name,
              field.options
                ? z.enum(field.options as [string, ...string[]])
                : field.type === "email"
                  ? z.string().email().max(254)
                  : z
                      .string()
                      .min(field.optional ? 0 : field.min || 1)
                      .max(field.type === "password" ? 128 : 254),
            ]),
          ),
        );
        const parsed = schema.safeParse(values);
        if (!parsed.success) {
          setError(
            "Check all fields. Passwords must have at least 14 characters.",
          );
          return;
        }
        try {
          await onSubmit(parsed.data);
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "The operation could not be completed.",
          );
        }
      })}
    >
      {fields.map((field) => (
        <div className="a-field" key={field.name}>
          <label htmlFor={`${formId}-${field.name}`}>{field.label}</label>
          {field.options ? (
            <select
              id={`${formId}-${field.name}`}
              className="a-select"
              {...register(field.name)}
            >
              {field.options.map((o) => (
                <option key={o} value={o}>
                  {o.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${formId}-${field.name}`}
              className="a-input"
              type={field.type || "text"}
              autoComplete={
                field.autoComplete ||
                (field.type === "password" ? "new-password" : "off")
              }
              {...register(field.name)}
            />
          )}
        </div>
      ))}
      {error && (
        <div role="alert" className="a-field-error">
          {error}
        </div>
      )}
      <div className="a-form-actions">
        <Button type="submit" busy={isSubmitting} variant={submitVariant}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
