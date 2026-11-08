import Link from "next/link";
export function PaymentOrderLink({ id }: { id: unknown }) {
  return typeof id === "string" && /^[a-f\d]{24}$/i.test(id) ? (
    <Link href={`/admin/payment-orders/${id}`} className="a-order-link">
      <code>{id}</code>
    </Link>
  ) : (
    <span className="a-muted">Order reference unavailable</span>
  );
}
