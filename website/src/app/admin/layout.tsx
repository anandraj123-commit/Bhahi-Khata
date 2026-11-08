import { adminFontVariables } from "../../lib/admin/fonts";
import type { Metadata } from "next";
import { AdminProviders } from "../../components/admin/layout/providers";
import "./admin.css";
export const metadata: Metadata = {
  title: {
    default: "Administration · Digital Khata",
    template: "%s · Digital Khata Admin",
  },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`dk-admin dk-admin-root ${adminFontVariables}`}>
      <a className="a-skip" href="#admin-content">
        Skip to content
      </a>
      <AdminProviders>{children}</AdminProviders>
    </div>
  );
}
