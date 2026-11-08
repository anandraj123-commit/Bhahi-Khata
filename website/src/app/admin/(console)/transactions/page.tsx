import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { Skeleton } from "../../../../components/admin/shared/ui";
import { Transactions } from "../../../../components/admin/tables/transactions";
async function Content() {
  for (const permission of [
    "shops:read",
    "customers:read",
    "customers:financial:read",
    "customers:transactions:read",
  ])
    await requireAdmin(permission);
  return <Transactions />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
