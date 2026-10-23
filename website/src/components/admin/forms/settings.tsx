"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, UserRound, MonitorSmartphone } from "lucide-react";
import { useAdminQuery } from "../../../hooks/admin/use-admin-query";
import { useClock } from "../../../hooks/admin/use-clock";
import { adminRequest, date } from "../../../lib/admin/api";
import type { Settings as SettingsData } from "../../../types/admin";
import { useAdmin } from "../layout/shell";
import { useToast } from "../layout/providers";
import { AdminForm } from "./admin-form";
import { Badge, Button, ErrorState, Skeleton } from "../shared/ui";
export function Settings() {
  const session = useAdmin();
  const query = useAdminQuery<SettingsData>("settings");
  const client = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const now = useClock();
  const verifiedUntil = session.reauthenticatedAt
    ? Date.parse(session.reauthenticatedAt) + 5 * 60 * 1000
    : 0;
  const secondsLeft = Math.max(0, Math.ceil((verifiedUntil - now) / 1000));
  const identityVerified = now > 0 && secondsLeft > 0;
  const send = async (path: string, body: unknown, method = "POST") =>
    adminRequest(path, { method, body, csrf: session.csrfToken });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["admin"] });
    router.refresh();
  };
  const guarded = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Request failed", true);
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <div className="a-page-heading">
        <div>
          <div className="a-eyebrow">PERSONAL WORKSPACE</div>
          <h1>Settings & security</h1>
          <p>
            Manage your profile, password, and active sessions.
          </p>
        </div>
        <Badge>{session.administrator.role.replaceAll("_", " ")}</Badge>
      </div>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState
          message={query.error.message}
          retry={() => void query.refetch()}
        />
      ) : query.data ? (
        <>
          <div className="a-settings-grid">
            <section className="a-card">
              <div className="a-card-head">
                <h2>Administrator profile</h2>
                <UserRound size={18} />
              </div>
              <div className="a-card-body">
                <p className="a-muted" style={{ marginBottom: 20 }}>
                  {query.data.data.administrator.email}
                </p>
                <AdminForm
                  fields={[
                    {
                      name: "name",
                      label: "Display name",
                      defaultValue: query.data.data.administrator.name,
                      min: 2,
                    },
                  ]}
                  submitLabel="Save profile"
                  onSubmit={async (values) => {
                    await send("settings/profile", values, "PATCH");
                    await refresh();
                    toast("Profile updated");
                  }}
                />
                <p className="a-definition">
                  Theme preference is stored only in this browser. Use the
                  sun/moon control in the top bar to switch between light and
                  dark.
                </p>
              </div>
            </section>
            <section className="a-card">
              <div className="a-card-head">
                <div>
                  <h2>Confirm your identity</h2>
                  <Badge tone={identityVerified ? "verified" : ""}>
                    {identityVerified
                      ? `Verified · ${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`
                      : "Not verified"}
                  </Badge>
                </div>
                <KeyRound size={18} />
              </div>
              <div className="a-card-body">
                <p className="a-muted" style={{ marginBottom: 20 }}>
                  Confirm your current password to unlock sensitive operations
                  for five minutes.
                </p>
                <AdminForm
                  fields={[
                    {
                      name: "password",
                      label: "Current password",
                      type: "password",
                      autoComplete: "current-password",
                    },
                  ]}
                  submitLabel={
                    identityVerified
                      ? `Verified · ${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`
                      : "Verify identity"
                  }
                  submitVariant={identityVerified ? "default" : "outline"}
                  onSubmit={async (values) => {
                    await adminRequest<{
                      success: boolean;
                      reauthenticatedAt: string;
                    }>("auth/reauth", {
                      method: "POST",
                      body: { password: values.password },
                      csrf: session.csrfToken,
                    });
                    await session.refreshSession();
                    toast("Password confirmed for five minutes");
                  }}
                />
              </div>
            </section>
            <section className="a-card">
              <div className="a-card-head">
                <h2>Change password</h2>
                <KeyRound size={18} />
              </div>
              <div className="a-card-body">
                <p className="a-muted" style={{ marginBottom: 20 }}>
                  Requires recent password confirmation. Changing your password
                  signs out every session, including this one.
                </p>
                <AdminForm
                  fields={[
                    {
                      name: "newPassword",
                      label: "New password (14+ characters)",
                      type: "password",
                      min: 14,
                    },
                  ]}
                  submitLabel="Change password & sign out"
                  onSubmit={async (values) => {
                    await send("settings/password", values);
                    client.clear();
                    router.replace("/admin/login");
                    router.refresh();
                  }}
                />
              </div>
            </section>
          </div>
          <section className="a-card" style={{ marginTop: 22 }}>
            <div className="a-card-head">
              <h2>Sessions</h2>
              <MonitorSmartphone size={18} />
            </div>
            <div className="a-list">
              {query.data.data.sessions.map((s) => (
                <div className="a-list-row" key={s.id}>
                  <div>
                    <strong>
                      {s.current ? "This session" : "Administrator session"}{" "}
                      {s.current && <Badge tone="active">Current</Badge>}
                    </strong>
                    <small>
                      Created {date(s.createdAt)} · Last seen{" "}
                      {date(s.lastSeenAt)} · Expires {date(s.expiresAt)}
                    </small>
                  </div>
                  <Button
                    variant="outline"
                    busy={busy === s.id}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void guarded(s.id, async () => {
                        await send(`settings/sessions/${s.id}`, {}, "DELETE");
                        if (s.current) {
                          client.clear();
                          router.replace("/admin/login");
                          router.refresh();
                        } else {
                          await refresh();
                          toast("Session revoked");
                        }
                      })
                    }
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
            <p className="a-definition" style={{ padding: "0 22px 18px" }}>
              Sessions expire after eight hours or thirty minutes of inactivity.
              Only your own sessions are shown. Revocation requires recent
              password confirmation.
            </p>
          </section>
        </>
      ) : null}
    </>
  );
}
