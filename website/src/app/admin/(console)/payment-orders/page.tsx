import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { PaymentOrderList } from "../../../../components/admin/tables/payment-order-management";
import { Skeleton } from "../../../../components/admin/shared/ui";
async function Content() {
  await requireAdmin("payments:read");
  return <PaymentOrderList />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
