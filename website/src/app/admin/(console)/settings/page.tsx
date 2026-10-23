import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { Settings } from "../../../../components/admin/forms/settings";
import { Skeleton } from "../../../../components/admin/shared/ui";
async function Content() {
  await requireAdmin();
  return <Settings />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
