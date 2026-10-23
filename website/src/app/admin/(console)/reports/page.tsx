import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { Overview } from "../../../../components/admin/dashboard/overview";
import { Skeleton } from "../../../../components/admin/shared/ui";
async function Content() {
  await requireAdmin("reports:read");
  return <Overview report />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
