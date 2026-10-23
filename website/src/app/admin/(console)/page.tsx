import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/server";
import { Overview } from "@/components/admin/dashboard/overview";
import { Skeleton } from "@/components/admin/shared/ui";
async function Content() {
  const session = await requireAdmin();
  if (!session.permissions.includes("dashboard:read")) redirect("/admin/shops");
  return <Overview />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
