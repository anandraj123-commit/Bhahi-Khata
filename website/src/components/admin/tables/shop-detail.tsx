"use client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ShopDetail as Detail } from "../../../types/admin";
import { useAdminQuery } from "../../../hooks/admin/use-admin-query";
import { date } from "../../../lib/admin/api";
import { useAdmin } from "../layout/shell";
import { Badge, Button, Empty, ErrorState, Skeleton } from "../shared/ui";
import { ResourceTable } from "./resource-table";
import { ShopCustomers } from "./customer-management";
export function ShopDetail({ id }: { id: string }) {
  const query = useAdminQuery<Detail>(`shops/${id}`);
  const session = useAdmin();
  const d = query.data?.data;
  return (
    <>
      <div className="a-page-heading">
        <div>
          <div className="a-eyebrow">SHOP DIRECTORY</div>
          <h1>{d ? String(d.shop.name || "Unnamed shop") : "Shop details"}</h1>
          <p>
            Read-only account information. Customer ledgers and balances are not
            exposed.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/shops">
            <ArrowLeft size={15} />
            All shops
          </Link>
        </Button>
      </div>
      {query.isPending ? (
        <Skeleton />
      ) : query.isError ? (
        <ErrorState
          message={query.error.message}
          retry={() => void query.refetch()}
        />
      ) : d ? (
        <>
          <div className="a-grid-2">
            <section className="a-card">
              <div className="a-card-head">
                <h2>Shop profile</h2>
                <Badge tone={String(d.shop.accountStatus)}>
                  {String(d.shop.accountStatus)}
                </Badge>
              </div>
              <dl className="a-card-body a-detail-grid">
                {Object.entries({
                  "Shop ID": d.shop._id,
                  Owner: d.shop.owner,
                  Registered: date(d.shop.createdAt),
                  ...(d.shop.phone
                    ? {
                        Phone: d.shop.phone,
                        Address: d.shop.address,
                        WhatsApp: d.shop.whatsapp,
                      }
                    : {}),
                }).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(value || "—")}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="a-card">
              <div className="a-card-head">
                <h2>Current subscription</h2>
                <Badge>{String(d.subscription.planCode)}</Badge>
              </div>
              <dl className="a-card-body a-detail-grid">
                <div>
                  <dt>Recorded status</dt>
                  <dd>{String(d.subscription.status)}</dd>
                </div>
                <div>
                  <dt>Starts</dt>
                  <dd>{date(d.subscription.startsAt)}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{date(d.subscription.expiresAt)}</dd>
                </div>
              </dl>
              <p className="a-definition" style={{ padding: "0 22px 20px" }}>
                A shop without an effective subscription uses the existing
                Free-plan fallback. No administrative entitlement changes are
                available.
              </p>
            </section>
          </div>
          {session.permissions.includes("customers:read") && (
            <ShopCustomers shopId={id} />
          )}
          {session.permissions.includes("subscriptions:read") && (
            <>
              <h2 className="a-title" style={{ margin: "24px 0 14px" }}>
                Subscription records
              </h2>
              <ResourceTable resource="subscriptions" shopId={id} />
              <section className="a-card" style={{ marginTop: 22 }}>
                <div className="a-card-head">
                  <h2>Recent subscription history</h2>
                  <Badge>Latest 20 events</Badge>
                </div>
                {d.history.length ? (
                  <div className="a-list">
                    {d.history.map((row) => (
                      <div key={row._id} className="a-list-row">
                        <div>
                          <strong>{String(row.eventType)}</strong>
                          <small>{String(row.actorType)}</small>
                        </div>
                        <small>{date(row.occurredAt)}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="No subscription history" />
                )}
              </section>
            </>
          )}
          {session.permissions.includes("payments:read") && (
            <>
              <h2 className="a-title" style={{ margin: "24px 0 14px" }}>
                Payment history
              </h2>
              <ResourceTable resource="payments" shopId={id} />
            </>
          )}
          <p className="a-definition">
            Suspension, reactivation, refunds, and manual paid-plan activation
            are intentionally unavailable.
          </p>
        </>
      ) : null}
    </>
  );
}
