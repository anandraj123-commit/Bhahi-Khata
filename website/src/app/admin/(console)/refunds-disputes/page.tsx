import { Suspense } from "react";
import { requireAdmin } from "../../../../lib/admin/server";
import { PaymentMonitoring } from "../../../../components/admin/tables/payment-monitoring";
import { Skeleton } from "../../../../components/admin/shared/ui";
async function Content() {
  await requireAdmin("payments:read");
  return <PaymentMonitoring kind="refunds" />;
}
export default function Page() {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content />
    </Suspense>
  );
}
