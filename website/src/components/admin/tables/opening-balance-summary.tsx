"use client";

import { useId, useState } from "react";
import {
  BookOpen,
  Banknote,
  HandCoins,
  Wallet,
  Undo2,
  ArrowLeftRight,
  ChevronUp,
  ChevronDown,
  Info,
} from "lucide-react";
import { money } from "../../../lib/admin/api";
import { Button } from "../shared/ui";

const cards = [
  ["udhari", "Opening Udhari", BookOpen],
  ["received", "Opening Money Received", Banknote],
  ["recovered", "Opening Udhari Recovered", HandCoins],
  ["deposited", "Opening Advance Deposited", Wallet],
  ["refunded", "Opening Advance Refunded", Undo2],
  ["used", "Opening Advance Used", ArrowLeftRight],
] as const;

export function OpeningBalanceSummary({
  values,
  scoped,
  updating,
  stale,
}: {
  values: Record<string, number> | null;
  scoped: boolean;
  updating: boolean;
  stale: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const titleId = useId();
  return (
    <section className="a-card a-opening-summary" aria-labelledby={titleId}>
      <header className="a-opening-header">
        <div>
          <h2 id={titleId}>Opening Balance Summary</h2>
          <p className="a-muted">
            Existing customer balances and financial history recorded when
            customers were added.
          </p>
        </div>
        <Button
          variant="outline"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronUp size={16} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )}
          {expanded ? "Show Less" : "Show More"}
        </Button>
      </header>
      <div id={contentId} hidden={!expanded}>
        <div className="a-opening-explanations">
          <div>
            <h3>What are opening balances?</h3>
            <p>
              Opening balances represent existing customer dues, advances, or
              financial history entered when a customer was first added to
              Digital-Khata. These amounts existed before the transactions
              recorded in the app.
            </p>
          </div>
          <div>
            <h3>Why are they shown here?</h3>
            <p>
              They help explain the difference between the Transactions summary
              and the financial totals displayed on the Home screen and Shop
              Financial Overview.
            </p>
          </div>
        </div>
        <p className="a-opening-important">
          <Info size={18} aria-hidden="true" />
          <span>
            <strong>Important:</strong> Opening balances are not new
            transactions. They do not increase the Total Transactions count.
          </span>
        </p>
        <p className="a-opening-example">
          <strong>Example:</strong> If a customer already owed ₹3,000 when added
          to Digital-Khata and later received another ₹2,000 in credit, the
          opening Udhari is ₹3,000 and the new Udhari transaction is ₹2,000.
        </p>
        <p className="a-opening-scope" role="status">
          {stale
            ? "Values from the previous response; current filters or refresh have not been verified."
            : updating
              ? "Updating opening contributions for the selected scope…"
              : values
                ? scoped
                  ? "Filtered opening contributions · all-time balances for the selected shop and customer scope."
                  : "All-time opening contributions · all authorized shops and customers in the current accounting scope."
                : "Opening contributions are unavailable with the current transaction-level filters, including date ranges. Clear those filters to view applicable all-time opening contributions."}
        </p>
        {values && (
          <div className="a-opening-cards">
            {cards.map(([key, title, Icon]) => (
              <div className="a-opening-card" key={key}>
                <div className="a-opening-card-title">
                  <Icon size={19} aria-hidden="true" />
                  <h3>{title}</h3>
                </div>
                <strong className="a-opening-amount">
                  {typeof values[key] === "number" &&
                  Number.isFinite(values[key])
                    ? money(values[key])
                    : "—"}
                </strong>
              </div>
            ))}
          </div>
        )}
        <p className="a-opening-overlap">
          Some financial categories overlap. For example, Money Received may
          include Advance Deposited. Do not add all six amounts together to
          calculate total cash.
        </p>
        <aside
          className="a-opening-comparison"
          aria-label="How to compare financial totals"
        >
          <h3>How to compare financial totals</h3>
          <p>
            To compare with the Home screen, use the transaction amounts and the
            applicable opening contributions for the same shops, customers,
            dates, and accounting definitions.
          </p>
          <p className="a-muted">
            Opening balances are all-time contributions, not amounts occurring
            within a selected transaction date range. Do not add them to
            date-filtered transactions without checking the shared accounting
            scope.
          </p>
        </aside>
      </div>
    </section>
  );
}
