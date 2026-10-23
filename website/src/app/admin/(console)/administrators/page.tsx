import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { Administrators } from "../../../../components/admin/forms/administrators";
import { Skeleton } from "../../../../components/admin/shared/ui";
async function Content() {
  await requireAdmin("administrators:manage");
  return <Administrators />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
