import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../../lib/admin/server";
import { PaymentOrderDetail } from "../../../../../components/admin/tables/payment-order-management";
import { Skeleton } from "../../../../../components/admin/shared/ui";
async function Content({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("payments:read");
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  return <PaymentOrderDetail id={id} />;
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
