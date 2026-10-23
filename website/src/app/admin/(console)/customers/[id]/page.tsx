import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireAdmin } from "../../../../../lib/admin/server";
import { CustomerDetail } from "../../../../../components/admin/tables/customer-management";
import { Skeleton } from "../../../../../components/admin/shared/ui";

async function Content({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("customers:read");
  const { id } = await params;
  if (!/^[a-f\d]{24}$/i.test(id)) notFound();
  return <CustomerDetail id={id} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Skeleton />}><Content params={params} /></Suspense>;
}
