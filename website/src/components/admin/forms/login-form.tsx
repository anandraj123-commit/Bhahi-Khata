"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, ShieldCheck, ArrowRight, LockKeyhole } from "lucide-react";
import { adminRequest } from "../../../lib/admin/api";
import { Button } from "../shared/ui";
const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password").max(128),
});
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  return (
    <div className="a-login">
      <section className="a-login-story">
        <div className="a-brand">
          <span className="a-brand-icon">
            <BookOpen />
          </span>
          <span>
            Digital Khata<small>PLATFORM ADMINISTRATION</small>
          </span>
        </div>
        <div className="a-login-statement">
          <div className="a-eyebrow" style={{ color: "#8ad2b7" }}>
            A CLEARER VIEW OF YOUR PLATFORM
          </div>
          <h1>
            Every shop.
            <br />
            One trusted workspace.
          </h1>
          <p>
            Understand platform growth, support shopkeepers, and oversee
            subscriptions with the clarity and control your team needs.
          </p>
        </div>
        <div className="a-login-security">
          <ShieldCheck size={19} />
          Separate identities. Protected access. Audited actions.
        </div>
      </section>
      <main id="admin-content" className="a-login-panel">
        <form
          className="a-login-form"
          onSubmit={handleSubmit(async (values) => {
            setError("");
            try {
              await adminRequest("auth/login", {
                method: "POST",
                body: values,
              });
              router.replace("/admin");
              router.refresh();
            } catch (error) {
              setError(
                error instanceof Error ? error.message : "Sign-in failed",
              );
            }
          })}
        >
          <span className="a-brand-icon">
            <LockKeyhole size={21} />
          </span>
          <h2>Welcome back</h2>
          <p>Sign in to your administrator account.</p>
          <div className="a-stack">
            {(["email", "password"] as const).map((name) => (
              <div className="a-field" key={name}>
                <label htmlFor={name}>
                  {name === "email"
                    ? "Username (email)"
                    : "Password"}
                </label>
                <input
                  id={name}
                  className="a-input"
                  type={
                    name === "password"
                      ? "password"
                      : "email"
                  }
                  autoComplete={
                    name === "email"
                      ? "username"
                      : "current-password"
                  }
                  aria-invalid={Boolean(errors[name])}
                  {...register(name)}
                />
                {errors[name] && (
                  <span role="alert" className="a-field-error">
                    {errors[name]?.message}
                  </span>
                )}
              </div>
            ))}
            {error && (
              <p role="alert" className="a-field-error">
                {error}
              </p>
            )}
            <div className="a-login-recovery">
              <Link href="/admin/forgot-password">Forgot password?</Link>
            </div>
            <Button type="submit" busy={isSubmitting}>
              Sign in securely <ArrowRight size={15} />
            </Button>
          </div>
          <div className="a-login-foot">
            Restricted to authorized platform administrators.
            <br />
            Shopkeeper OTP accounts cannot sign in here.
            <br />
            Use Forgot password to receive a password reset link.
          </div>
        </form>
      </main>
    </div>
  );
}
