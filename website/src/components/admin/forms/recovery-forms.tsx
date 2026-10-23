"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, BookOpen, KeyRound, LockKeyhole } from "lucide-react";
import { adminRequest } from "../../../lib/admin/api";
import { Button } from "../shared/ui";

const emailSchema = z.object({ email: z.string().email("Enter a valid email address") });
const resetSchema = z
  .object({
    newPassword: z.string().min(14).max(128),
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
const subscribeToResetToken = () => () => {};
const getResetTokenSnapshot = () =>
  new URLSearchParams(window.location.hash.slice(1)).get("token") || "missing";
const getServerResetTokenSnapshot = () => null;

function RecoveryLayout({
  icon,
  title,
  description,
  children,
}: {
  icon: "mail" | "key";
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="a-login">
      <section className="a-login-story">
        <div className="a-brand">
          <span className="a-brand-icon"><BookOpen /></span>
          <span>Digital Khata<small>PLATFORM ADMINISTRATION</small></span>
        </div>
        <div className="a-login-statement">
          <div className="a-eyebrow" style={{ color: "#8ad2b7" }}>SECURE ACCOUNT RECOVERY</div>
          <h1>Protecting access to your platform.</h1>
          <p>Administrator recovery links are private, time-limited, and can only be used once.</p>
        </div>
      </section>
      <main id="admin-content" className="a-login-panel">
        <section className="a-login-form">
          <span className="a-brand-icon">{icon === "mail" ? <LockKeyhole size={21} /> : <KeyRound size={21} />}</span>
          <h2>{title}</h2>
          <p>{description}</p>
          {children}
        </section>
      </main>
    </div>
  );
}

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });

  return (
    <RecoveryLayout
      icon="mail"
      title={submitted ? "Check your inbox" : "Reset your password"}
      description={
        submitted
          ? "If an active administrator account matches that email, a reset link will be sent."
          : "Enter your administrator email and we’ll send a one-time reset link if the account is active."
      }
    >
      {!submitted && (
        <form
          className="a-stack"
          onSubmit={handleSubmit(async (values) => {
            setError("");
            try {
              await adminRequest("auth/forgot-password", {
                method: "POST",
                body: values,
              });
              setSubmitted(true);
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "Request failed. Try again.");
            }
          })}
        >
          <div className="a-field">
            <label htmlFor="recovery-email">Work email</label>
            <input
              id="recovery-email"
              className="a-input"
              type="email"
              autoComplete="username"
              aria-invalid={Boolean(errors.email)}
              {...register("email")}
            />
            {errors.email && <span role="alert" className="a-field-error">{errors.email.message}</span>}
          </div>
          {error && <p role="alert" className="a-field-error">{error}</p>}
          <Button type="submit" busy={isSubmitting}>Send reset link</Button>
        </form>
      )}
      <Link className="a-recovery-back" href="/admin/login"><ArrowLeft size={15} /> Back to sign in</Link>
    </RecoveryLayout>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const tokenSnapshot = useSyncExternalStore(
    subscribeToResetToken,
    getResetTokenSnapshot,
    getServerResetTokenSnapshot,
  );
  const token = tokenSnapshot && tokenSnapshot !== "missing" ? tokenSnapshot : "";
  const linkChecked = tokenSnapshot !== null;
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  return (
    <RecoveryLayout
      icon="key"
      title={success ? "Password updated" : "Choose a new password"}
      description={
        success
          ? "Your password was changed and existing sessions were signed out. You can now sign in."
          : "Choose a unique password with at least 14 characters. The reset link can only be used once."
      }
    >
      {!linkChecked ? (
        <p className="a-muted">Checking your reset link…</p>
      ) : !token ? (
        <p role="alert" className="a-field-error">This reset link is invalid. Request a new one.</p>
      ) : success ? (
        <Button type="button" onClick={() => router.replace("/admin/login")}>Go to sign in</Button>
      ) : (
        <form
          className="a-stack"
          onSubmit={handleSubmit(async (values) => {
            setError("");
            try {
              await adminRequest("auth/reset-password", {
                method: "POST",
                body: { token, newPassword: values.newPassword },
              });
              setSuccess(true);
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "Reset link invalid or expired.");
            }
          })}
        >
          {(["newPassword", "confirmPassword"] as const).map((name) => (
            <div className="a-field" key={name}>
              <label htmlFor={name}>{name === "newPassword" ? "New password" : "Confirm new password"}</label>
              <input
                id={name}
                className="a-input"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors[name])}
                {...register(name)}
              />
              {errors[name] && <span role="alert" className="a-field-error">{errors[name]?.message || "Enter at least 14 characters"}</span>}
            </div>
          ))}
          {error && <p role="alert" className="a-field-error">{error}</p>}
          <Button type="submit" busy={isSubmitting}>Update password</Button>
        </form>
      )}
      {!success && <Link className="a-recovery-back" href="/admin/login"><ArrowLeft size={15} /> Back to sign in</Link>}
    </RecoveryLayout>
  );
}
