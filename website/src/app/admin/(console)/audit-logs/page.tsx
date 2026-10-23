import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { ResourcePage } from "../../../../components/admin/tables/resource-table";
import { Skeleton } from "../../../../components/admin/shared/ui";
async function Content() {
  await requireAdmin("audit:read");
  return <ResourcePage resource="audit-logs" />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
