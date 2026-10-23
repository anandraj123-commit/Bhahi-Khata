import { Suspense } from "react";
import { requireAdmin } from "../../../lib/admin/server";
import { AdminShell } from "../../../components/admin/layout/shell";
import { Skeleton } from "../../../components/admin/shared/ui";
async function Protected({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  return <AdminShell session={session}>{children}</AdminShell>;
}
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Protected>{children}</Protected>
    </Suspense>
  );
}
