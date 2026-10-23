import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { ResourcePage } from "../../../../components/admin/tables/resource-table";
import { Skeleton } from "../../../../components/admin/shared/ui";
async function Content() {
  await requireAdmin("payments:read");
  return <ResourcePage resource="payments" />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
