import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { Skeleton } from "../../../../components/admin/shared/ui";
import { NotificationManagement } from "../../../../components/admin/notifications/management";
async function Content() {
  await requireAdmin("notifications:read");
  return <NotificationManagement />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
