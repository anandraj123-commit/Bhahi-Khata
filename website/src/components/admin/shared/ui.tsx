"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { LoaderCircle, X, AlertCircle, Inbox } from "lucide-react";
export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
// shadcn/ui's composable Slot/CVA button pattern, scoped to the administration theme.
const buttonVariants = cva("a-button", {
  variants: {
    variant: {
      default: "a-button-primary",
      outline: "a-button-outline",
      ghost: "a-button-ghost",
      destructive: "a-button-danger",
    },
  },
  defaultVariants: { variant: "default" },
});
export function Button({
  className,
  variant,
  asChild = false,
  busy = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; busy?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant }), className)}
      disabled={disabled || busy}
      aria-busy={busy}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {busy && <LoaderCircle size={16} className="a-spin" />}
          {children}
        </>
      )}
    </Comp>
  );
}
export function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={cn(
        "a-badge",
        ["active", "enabled", "captured", "verified", "success"].includes(tone)
          ? "a-badge-good"
          : ["failed", "disabled", "expired", "failure"].includes(tone)
            ? "a-badge-bad"
            : "",
      )}
    >
      {children}
    </span>
  );
}
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading records" className="a-skeletons">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="a-skeleton" />
      ))}
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message?: string;
  retry?: () => void;
}) {
  return (
    <div role="alert" className="a-empty">
      <AlertCircle />
      <h3>We couldn’t load this view</h3>
      <p>{message || "Please try again shortly."}</p>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function Empty({
  title = "No records found",
  message = "Try adjusting your search or date range.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="a-empty">
      <Inbox />
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}
export function Modal({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="a-dialog-overlay" />
        <DialogPrimitive.Content className="dk-admin a-dialog">
          <DialogPrimitive.Title className="a-title">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="a-muted">
            {description}
          </DialogPrimitive.Description>
          <DialogPrimitive.Close asChild>
            <button className="a-dialog-close" aria-label="Close dialog">
              <X size={20} />
            </button>
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
