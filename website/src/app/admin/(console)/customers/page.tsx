import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { CustomerManagement } from "../../../../components/admin/tables/customer-management";
import { Skeleton } from "../../../../components/admin/shared/ui";

async function Content() {
  await requireAdmin("customers:read");
  return <CustomerManagement />;
}

export default function Page() {
  return <Suspense fallback={<Skeleton />}><Content /></Suspense>;
}
