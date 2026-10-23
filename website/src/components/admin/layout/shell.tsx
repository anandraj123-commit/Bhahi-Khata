"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  LayoutDashboard,
  Store,
  Users,
  CreditCard,
  Wallet,
  ShieldCheck,
  ChartNoAxesCombined,
  ScrollText,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Moon,
  Sun,
  ChevronDown,
  LogOut,
  X,
  BookOpen,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { adminRequest } from "../../../lib/admin/api";
import type { AdminSession } from "../../../types/admin";
import { useToast } from "./providers";
export const navigation = [
  {
    href: "/admin",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: "dashboard:read",
  },
  {
    href: "/admin/shops",
    label: "Shops",
    icon: Store,
    permission: "shops:read",
  },
  {
    href: "/admin/customers",
    label: "Customers",
    icon: Users,
    permission: "customers:read",
  },
  {
    href: "/admin/subscriptions",
    label: "Subscriptions",
    icon: CreditCard,
    permission: "subscriptions:read",
  },
  {
    href: "/admin/payments",
    label: "Payments",
    icon: Wallet,
    permission: "payments:read",
  },
  {
    href: "/admin/administrators",
    label: "Administrators",
    icon: ShieldCheck,
    permission: "administrators:manage",
  },
  {
    href: "/admin/reports",
    label: "Reports & analytics",
    icon: ChartNoAxesCombined,
    permission: "reports:read",
  },
  {
    href: "/admin/audit-logs",
    label: "Audit logs",
    icon: ScrollText,
    permission: "audit:read",
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
    permission: "",
  },
];
type AdminContextValue = AdminSession & {
  refreshSession: () => Promise<AdminSession>;
};
const SessionContext = createContext<AdminContextValue | null>(null);
export function useAdmin() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Admin context required");
  return value;
}
export function AdminShell({
  session,
  children,
}: {
  session: AdminSession;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dark, setDark] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [currentSession, setCurrentSession] = useState(session);
  const refreshSession = useCallback(async () => {
    const result = await adminRequest<AdminSession>("auth/me");
    setCurrentSession(result.data);
    return result.data;
  }, []);
  const sessionContext = useMemo(
    () => ({ ...currentSession, refreshSession }),
    [currentSession, refreshSession],
  );
  useEffect(() => {
    const stored = (() => {
      try {
        return localStorage.getItem("dk-admin-theme");
      } catch {
        return null;
      }
    })();
    const next = stored
      ? stored === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document
      .querySelector(".dk-admin-root")
      ?.setAttribute("data-theme", next ? "dark" : "light");
    queueMicrotask(() => setDark(next));
  }, []);
  useEffect(() => {
    const expired = () => {
      queryClient.clear();
      router.replace("/admin/login");
      router.refresh();
    };
    window.addEventListener("admin-session-expired", expired);
    return () => window.removeEventListener("admin-session-expired", expired);
  }, [queryClient, router]);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document
      .querySelector(".dk-admin-root")
      ?.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("dk-admin-theme", next ? "dark" : "light");
    } catch {}
  };
  const links = navigation.filter(
    (item) => !item.permission || currentSession.permissions.includes(item.permission),
  );
  const current =
    navigation.find((item) => item.href === path) ||
    (path.startsWith("/admin/shops/")
      ? { label: "Shop details" }
      : path.startsWith("/admin/customers/")
        ? { label: "Customer details" }
        : { label: "Administration" });
  const sidebar = (
    <>
      <Link href="/admin" className="a-brand">
        <span className="a-brand-icon">
          <BookOpen size={22} />
        </span>
        <span className="a-brand-copy">
          Digital Khata<small>ADMINISTRATION</small>
        </span>
      </Link>
      <div className="a-nav-label">WORKSPACE</div>
      <nav aria-label="Administration">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={collapsed ? item.label : undefined}
            onClick={() => setDrawer(false)}
            className={`a-nav-link ${path === item.href || (item.href !== "/admin" && path.startsWith(item.href + "/")) ? "is-active" : ""}`}
            aria-current={path === item.href ? "page" : undefined}
          >
            <item.icon size={19} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="a-sidebar-note">
        <ShieldCheck size={18} />
        <span>
          Protected workspace<small>Administrator access only</small>
        </span>
      </div>
    </>
  );
  return (
    <SessionContext.Provider value={sessionContext}>
      <div className={`a-shell ${collapsed ? "is-collapsed" : ""}`}>
        <aside className="a-sidebar">{sidebar}</aside>
        <Dialog.Root open={drawer} onOpenChange={setDrawer}>
          <Dialog.Portal>
            <Dialog.Overlay className="a-dialog-overlay" />
            <Dialog.Content className="dk-admin a-mobile-drawer">
              <Dialog.Title className="a-sr-only">Navigation</Dialog.Title>
              <Dialog.Description className="a-sr-only">
                Administration pages
              </Dialog.Description>
              <Dialog.Close
                className="a-dialog-close"
                aria-label="Close navigation"
              >
                <X />
              </Dialog.Close>
              {sidebar}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <div className="a-main">
          <header className="a-topbar">
            <button
              className="a-icon-button a-desktop-toggle"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
            <button
              className="a-icon-button a-mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setDrawer(true)}
            >
              <Menu />
            </button>
            <div className="a-breadcrumb">
              <span>Workspace</span>
              <span>/</span>
              <strong>{current.label}</strong>
            </div>
            <div className="a-top-actions">
              <button
                className="a-icon-button"
                aria-label={
                  dark ? "Switch to light theme" : "Switch to dark theme"
                }
                onClick={toggleTheme}
              >
                {dark ? <Sun size={19} /> : <Moon size={19} />}
              </button>
              <Dropdown.Root>
                <Dropdown.Trigger className="a-profile">
                  <span className="a-avatar">
                    {currentSession.administrator.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="a-profile-text">
                    {currentSession.administrator.name}
                    <small>
                      {currentSession.administrator.role
                        .replaceAll("_", " ")
                        .toLowerCase()}
                    </small>
                  </span>
                  <ChevronDown size={15} />
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Content
                    className="dk-admin a-menu"
                    align="end"
                    sideOffset={10}
                  >
                    <Dropdown.Item asChild>
                      <Link href="/admin/settings">Profile & security</Link>
                    </Dropdown.Item>
                    <Dropdown.Separator />
                    <Dropdown.Item
                      disabled={loggingOut}
                      onSelect={async () => {
                        setLoggingOut(true);
                        try {
                          await adminRequest("auth/logout", {
                            method: "POST",
                            body: {},
                            csrf: currentSession.csrfToken,
                          });
                          queryClient.clear();
                          router.replace("/admin/login");
                          router.refresh();
                        } catch (error) {
                          toast(
                            error instanceof Error
                              ? error.message
                              : "Logout failed",
                            true,
                          );
                        } finally {
                          setLoggingOut(false);
                        }
                      }}
                    >
                      <LogOut size={16} />
                      {loggingOut ? "Signing out…" : "Sign out"}
                    </Dropdown.Item>
                  </Dropdown.Content>
                </Dropdown.Portal>
              </Dropdown.Root>
            </div>
          </header>
          <main id="admin-content" className="a-content">
            {children}
          </main>
          <footer className="a-footer">
            Digital Khata · Platform administration
            <span>All dates shown in UTC</span>
          </footer>
        </div>
      </div>
    </SessionContext.Provider>
  );
}
