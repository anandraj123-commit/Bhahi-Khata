"use client";
import imagePolicy from "../../../../../shared/notificationImagePolicy.json";
import { useState } from "react";
import { toISTInput, fromISTInput, formatIST } from "./time";
import { Eye, Pencil, Trash2, Plus, RefreshCw, Bell } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAdminQuery,
  useDebounced,
} from "../../../hooks/admin/use-admin-query";
import { adminRequest } from "../../../lib/admin/api";
import { useAdmin } from "../layout/shell";
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Modal,
  Skeleton,
} from "../shared/ui";
import {
  RichContent,
  RichEditor,
  emptyDocument,
  type RichDoc,
} from "./rich-editor";
type Campaign = {
  _id: string;
  title: string;
  preview: string;
  shortDescription: RichDoc | string;
  description: RichDoc | string;
  recipientType: "all" | "selected";
  shopIds: string[];
  displayOn: string;
  status: boolean;
  deletedAt?: string;
  publishedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  revision: number;
  state: string;
  publishedCount: number;
  attempts: number;
  lastError?: string;
  nextAttemptAt?: string;
  recipients?: { _id: string; name: string; phone: string }[];
  deliverySummary?: { state: string; count: number }[];
  receipts?: { _id: string; count: number }[];
  delivery?: {
    _id: string;
    count: number;
    read: number;
    accepted: number;
    rejected: number;
  }[];
};
const stamp = formatIST;
function RecipientPicker({
  selected,
  onChange,
}: {
  selected: { id: string; label: string }[];
  onChange: (v: { id: string; label: string }[]) => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1);
  const term = useDebounced(q);
  const rows = useAdminQuery<
    { _id: string; name: string; owner: string; phone: string }[]
  >(`notifications/recipients?q=${encodeURIComponent(term)}&page=${page}`);
  return (
    <div>
      <label className="a-field">
        Find shopkeepers
        <input
          className="a-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Shop, owner, phone or shop ID"
        />
      </label>
      <div className="a-notification-toolbar">
        {selected.map((s) => (
          <Button
            key={s.id}
            type="button"
            variant="outline"
            onClick={() => onChange(selected.filter((v) => v.id !== s.id))}
          >
            {s.label} ×
          </Button>
        ))}
      </div>
      {rows.isPending ? (
        <Skeleton rows={2} />
      ) : rows.error ? (
        <ErrorState
          message={rows.error.message}
          retry={() => void rows.refetch()}
        />
      ) : (
        <>
          <div className="a-notification-recipients">
            {rows.data?.data.map((s) => (
              <label key={s._id}>
                <input
                  type="checkbox"
                  checked={selected.some((v) => v.id === s._id)}
                  disabled={
                    selected.length >= 500 &&
                    !selected.some((v) => v.id === s._id)
                  }
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, { id: s._id, label: s.name || s.phone }]
                        : selected.filter((v) => v.id !== s._id),
                    )
                  }
                />
                {s.name} · {s.owner} · {s.phone}
              </label>
            ))}
          </div>
          {!rows.data?.data.length && <p>No eligible shops found.</p>}
          <Button
            type="button"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((n) => n - 1)}
          >
            Previous shops
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={page * 20 >= (rows.data?.pagination?.total || 0)}
            onClick={() => setPage((n) => n + 1)}
          >
            Next shops
          </Button>
        </>
      )}
      <small>
        {selected.length} selected · maximum500 per selected campaign
      </small>
    </div>
  );
}
function Form({
  row,
  done,
}: {
  row?: Campaign;
  done: (saved?: boolean) => void;
}) {
  const session = useAdmin();
  const [createKey] = useState(() => crypto.randomUUID());
  const [shortValid, setShortValid] = useState(false),
    [descriptionValid, setDescriptionValid] = useState(false);
  const [title, setTitle] = useState(row?.title || ""),
    [short, setShort] = useState<RichDoc | string>(
      row?.shortDescription || emptyDocument,
    ),
    [description, setDescription] = useState<RichDoc | string>(
      row?.description || emptyDocument,
    ),
    [recipientType, setType] = useState<"all" | "selected">(
      row?.recipientType || "all",
    ),
    [shops, setShops] = useState(
      (row?.shopIds || []).map((id) => ({
        id,
        label: row?.recipients?.find((s) => s._id === id)?.name || id,
      })),
    ),
    [displayOn, setDate] = useState(
      toISTInput(row?.displayOn || new Date().toISOString()),
    ),
    [status, setStatus] = useState(row?.status ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!shortValid || !descriptionValid) {
      setError("Review unsupported editor content before saving.");
      return;
    }
    const serialized = JSON.stringify({ short, description });
    if (
      new TextEncoder().encode(serialized).length >
      imagePolicy.documentBytes - 65536
    ) {
      setError(
        "Notification exceeds the 4 MiB document limit. Remove or resize images.",
      );
      return;
    }
    const embedded =
      serialized.match(
        /data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}/g,
      ) || [];
    if (
      embedded.reduce((sum, image) => sum + image.length, 0) >
      imagePolicy.totalImageDataBytes
    ) {
      setError("Combined embedded images exceed 3 MiB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await adminRequest(row ? `notifications/${row._id}` : "notifications", {
        method: row ? "PATCH" : "POST",
        csrf: session.csrfToken,
        body: {
          ...(!row ? { createKey } : {}),
          title,
          shortDescription: short,
          description,
          recipientType,
          shopIds: recipientType === "selected" ? shops.map((s) => s.id) : [],
          displayOn:
            row && displayOn === toISTInput(row.displayOn)
              ? row.displayOn
              : fromISTInput(displayOn),
          status,
          ...(row ? { revision: row.revision } : {}),
        },
      });
      done(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save notification");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="a-notification-form">
      {error && <p role="alert">{error}</p>}
      <section className="a-notification-section">
        <h3>Notification Information</h3>
        <label className="a-field">
          Title (160 characters)
          <input
            className="a-input"
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>Short description (1,000 text characters)</label>
        <RichEditor
          key={`${row?._id || "new"}:short`}
          label="Short description"
          value={short}
          onChange={setShort}
          onValidityChange={setShortValid}
        />
        <label>Description (12,000 text characters)</label>
        <RichEditor
          key={`${row?._id || "new"}:full`}
          onValidityChange={setDescriptionValid}
          label="Description"
          value={description}
          onChange={setDescription}
        />
      </section>
      <fieldset
        className="a-notification-section"
        disabled={Boolean(
          row?.publishedAt ||
          (row?.status && Date.parse(row.displayOn) <= Date.now()),
        )}
      >
        <legend>Recipients</legend>
        {row?.publishedAt && (
          <p>
            Published targeting and schedule are locked. Editing content does
            not resend notifications.
          </p>
        )}
        <label>
          <input
            type="radio"
            checked={recipientType === "all"}
            onChange={() => setType("all")}
          />
          All eligible shopkeepers at publication time
        </label>
        <label>
          <input
            type="radio"
            checked={recipientType === "selected"}
            onChange={() => setType("selected")}
          />
          Choose shopkeepers
        </label>
        {recipientType === "selected" &&
        !(
          row?.publishedAt ||
          (row?.status && Date.parse(row.displayOn) <= Date.now())
        ) ? (
          <RecipientPicker selected={shops} onChange={setShops} />
        ) : recipientType === "selected" ? (
          <p>{shops.map((s) => s.label).join(", ")}</p>
        ) : null}
      </fieldset>
      <fieldset
        className="a-notification-section"
        disabled={Boolean(
          row?.publishedAt ||
          (row?.status && Date.parse(row.displayOn) <= Date.now()),
        )}
      >
        <legend>Scheduling</legend>
        <label className="a-field">
          Display On (IST)
          <input
            className="a-input"
            required
            type="datetime-local"
            value={displayOn}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <p className="a-muted">
          Asia/Kolkata (UTC+05:30). Publication uses server time; timestamps are
          saved in UTC.
        </p>
      </fieldset>
      <section className="a-notification-section">
        <h3>Status</h3>
        {row ? (
          <label>
            <input
              type="checkbox"
              checked={status}
              onChange={(e) => setStatus(e.target.checked)}
            />
            Active
          </label>
        ) : (
          <p>Active · eligible for publication at the scheduled time.</p>
        )}
      </section>
      <p className="a-muted">
        Active notifications are visible to eligible recipients when Display On
        is reached. The worker is only needed for optional push delivery. Push
        acceptance is separate from inbox publication. Embedded images: 500 KiB
        each, 3 MiB combined. Complete notification: 4 MiB maximum.
      </p>
      <div className="a-notification-actions">
        <Button
          busy={busy}
          disabled={
            !shortValid ||
            !descriptionValid ||
            (recipientType === "selected" && !shops.length)
          }
        >
          Save Notification
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => done()}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
function Details({
  id,
  edit,
  done,
}: {
  id: string;
  edit: boolean;
  done: (saved?: boolean) => void;
}) {
  const q = useAdminQuery<Campaign>(`notifications/${id}`);
  if (q.isPending) return <Skeleton />;
  if (q.error)
    return (
      <ErrorState message={q.error.message} retry={() => void q.refetch()} />
    );
  const r = q.data?.data;
  if (!r) return <Empty />;
  if (edit && !r.deletedAt)
    return <Form key={r.revision} row={r} done={done} />;
  return (
    <>
      <h2>{r.title}</h2>
      <RichContent value={r.shortDescription} />
      <RichContent value={r.description} />
      <dl className="a-detail-grid">
        {[
          ["Notification ID", r._id],
          [
            "Recipients",
            r.recipientType === "all"
              ? "All eligible shops"
              : r.recipients?.map((s) => s.name || s._id).join(", "),
          ],
          ["Active", r.status ? "Yes" : "No"],
          [
            "Inbox visibility",
            r.status && !r.deletedAt && Date.parse(r.displayOn) <= Date.now()
              ? "Eligible now (server enforces access)"
              : "Scheduled or inactive",
          ],
          ["Publication", r.state],
          ["Display On", stamp(r.displayOn)],
          ["First publication", stamp(r.publishedAt)],
          ["Publication completed", stamp(r.completedAt)],
          ["Published inbox records", r.publishedCount],
          ["Publication attempts", r.attempts],
          ["Last publication error", r.lastError || "None recorded"],
          ["Next retry", stamp(r.nextAttemptAt)],
          ["Created by", r.createdBy],
          ["Created At", stamp(r.createdAt)],
          ["Updated At", stamp(r.updatedAt)],
        ].map(([k, v]) => (
          <div key={String(k)}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h3>Stored delivery evidence</h3>
      <p>
        Expo receipts:{" "}
        {r.receipts?.length
          ? r.receipts.map((v) => `${v._id}: ${v.count}`).join(" · ")
          : "No receipt evidence recorded"}
        . An OK receipt confirms provider handoff, not device display.
      </p>
      <p>
        Ticket acceptance is not confirmed device delivery. Read counts describe
        stored recipient read state. Eligible unread recipients without a stored receipt are not included in this delivery-evidence table.
      </p>
      {r.delivery?.length ? (
        <table className="a-table">
          <thead>
            <tr>
              <th>Push state</th>
              <th>Inbox records</th>
              <th>Read</th>
              <th>Unread</th>
              <th>Tickets accepted</th>
              <th>Tickets rejected</th>
            </tr>
          </thead>
          <tbody>
            {r.delivery.map((d) => (
              <tr key={d._id || "none"}>
                <td>{d._id || "Not recorded"}</td>
                <td>{d.count}</td>
                <td>{d.read}</td>
                <td>{d.count - d.read}</td>
                <td>{d.accepted}</td>
                <td>{d.rejected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No recipient publication records yet.</p>
      )}
    </>
  );
}
export function NotificationManagement() {
  const session = useAdmin(),
    client = useQueryClient(),
    canManage = session.permissions.includes("notifications:manage");
  const [success, setSuccess] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState(20),
    [modal, setModal] = useState<{ id?: string; edit: boolean } | null>(null),
    [deleting, setDeleting] = useState<Campaign | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const term = useDebounced(JSON.stringify(filters));
  const params = new URLSearchParams(JSON.parse(term));
  params.set("page", String(page));
  params.set("limit", String(limit));
  const q = useAdminQuery<Campaign[]>(`notifications?${params}`);
  const total = q.data?.pagination?.total;
  const change = (key: string, value: string) => {
    setPage(1);
    setFilters((old) => {
      const n = { ...old };
      if (value) n[key] = value;
      else delete n[key];
      return n;
    });
  };
  const done = (saved = false) => {
    if (saved)
      setSuccess(
        "Notification saved. Active notifications are available to eligible shopkeepers when Display On is reached.",
      );
    setModal(null);
    setDeleting(null);
    void client.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "admin" &&
        String(q.queryKey[1]).startsWith("notifications"),
    });
  };
  const select = (key: string, label: string, options: string[]) => (
    <label className="a-filter-field">
      {label}
      <select
        className="a-select"
        value={filters[key] || ""}
        onChange={(e) => change(key, e.target.value)}
      >
        <option value="">All / default</option>
        {options.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
  return (
    <section>
      {success && (
        <p role="status" className="a-muted">
          {success}
        </p>
      )}
      <header className="a-payment-header">
        <div>
          <h1>
            <Bell size={25} /> Notifications
          </h1>
          <p>
            Create announcements, schedule publication and inspect stored
            delivery evidence.
          </p>
        </div>
        <div className="a-notification-toolbar">
          <Button
            variant="outline"
            busy={q.isFetching}
            onClick={() => void q.refetch()}
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
          {canManage && (
            <Button onClick={() => setModal({ edit: true })}>
              <Plus size={16} />
              Add notification
            </Button>
          )}
        </div>
      </header>
      <div className="a-card a-monitor-filters">
        <label className="a-filter-field">
          Search
          <input
            className="a-input"
            value={filters.q || ""}
            onChange={(e) => change("q", e.target.value.trimStart())}
            placeholder="Title, preview or notification ID"
          />
        </label>
        {select("recipientType", "Recipients", ["all", "selected"])}
        {select("status", "Active", ["true", "false"])}
        {select("state", "Publication state", [
          "scheduled",
          "processing",
          "published",
          "failed",
        ])}
        {select("deliveryState", "Recipient push state", [
          "pending",
          "claimed",
          "ticket_accepted",
          "failed",
          "unknown",
          "skipped",
        ])}
        {select("dateField", "Date field", [
          "displayOn",
          "createdAt",
          "updatedAt",
        ])}
        {["from", "to"].map((k) => (
          <label className="a-filter-field" key={k}>
            {k === "from" ? "From" : "To"} (IST)
            <input
              className="a-input"
              type="datetime-local"
              value={filters[k] ? toISTInput(filters[k]) : ""}
              onChange={(e) =>
                change(k, e.target.value ? fromISTInput(e.target.value) : "")
              }
            />
          </label>
        ))}
        {["shopId", "createdBy"].map((k) => (
          <label key={k} className="a-filter-field">
            {k === "shopId" ? "Target shop ID" : "Creator ID"}
            <input
              className="a-input"
              value={filters[k] || ""}
              onChange={(e) => change(k, e.target.value.trim())}
            />
          </label>
        ))}
        {select("sort", "Sort by", [
          "createdAt",
          "updatedAt",
          "displayOn",
          "title",
        ])}
        {select("direction", "Direction", ["desc", "asc"])}
        <Button
          variant="outline"
          onClick={() => {
            setFilters({});
            setPage(1);
          }}
        >
          Reset filters
        </Button>
      </div>
      <div className="a-notification-toolbar">
        {Object.entries(filters).map(([k, v]) => (
          <Button variant="ghost" key={k} onClick={() => change(k, "")}>
            {k}: {v} ×
          </Button>
        ))}
      </div>
      {q.isPending ? (
        <Skeleton />
      ) : q.error ? (
        <ErrorState message={q.error.message} retry={() => void q.refetch()} />
      ) : q.data?.data.length ? (
        <div className="a-card a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                {[
                  "Notification ID",
                  "Title",
                  "Short description",
                  "Recipients",
                  "Recipient count",
                  "Display On (IST)",
                  "Active",
                  "Inbox publication",
                  "Recipient push evidence",
                  "Published",
                  "Created At (IST)",
                  "Updated At (IST)",
                  "Actions",
                ].map((v) => (
                  <th key={v}>{v}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((r) => (
                <tr key={r._id}>
                  <td>{r._id}</td>
                  <td>{r.title}</td>
                  <td>{r.preview}</td>
                  <td>{r.recipientType}</td>
                  <td>
                    {r.recipientType === "selected"
                      ? r.shopIds.length
                      : r.completedAt
                        ? r.publishedCount
                        : "Resolved at publication"}
                  </td>
                  <td>{stamp(r.displayOn)}</td>
                  <td>
                    <Badge>
                      {r.deletedAt
                        ? "Deleted"
                        : r.status
                          ? "Active"
                          : "Inactive"}
                    </Badge>
                  </td>
                  <td>
                    <Badge>{r.state}</Badge>
                  </td>
                  <td>
                    {r.deliverySummary?.length
                      ? r.deliverySummary
                          .map((v) => `${v.state}: ${v.count}`)
                          .join(" · ")
                      : "No push evidence"}
                  </td>
                  <td>{r.publishedCount}</td>
                  <td>{stamp(r.createdAt)}</td>
                  <td>{stamp(r.updatedAt)}</td>
                  <td>
                    <div className="a-notification-toolbar">
                      <Button
                        variant="ghost"
                        aria-label="View notification"
                        onClick={() => setModal({ id: r._id, edit: false })}
                      >
                        <Eye size={17} />
                      </Button>
                      {canManage && (
                        <>
                          <Button
                            variant="ghost"
                            disabled={!!r.deletedAt}
                            aria-label="Edit notification"
                            onClick={() => setModal({ id: r._id, edit: true })}
                          >
                            <Pencil size={17} />
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!!r.deletedAt}
                            aria-label="Soft delete notification"
                            onClick={() => {
                              setError("");
                              setDeleting(r);
                            }}
                          >
                            <Trash2 size={17} />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty message="No notifications match these filters." />
      )}
      <div className="a-pagination">
        <span>
          {total === undefined ? "Count unavailable" : `${total} records`} ·
          Page {page}
          {total !== undefined
            ? ` of ${Math.max(1, Math.ceil(total / limit))}`
            : ""}
        </span>
        <div className="a-pagination-controls">
          <select
            aria-label="Page size"
            className="a-select"
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
          >
            {[20, 50, 100].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((n) => n - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={!q.isSuccess || page * limit >= (total || 0)}
            onClick={() => setPage((n) => n + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      <Modal
        open={!!modal}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
        title={
          modal?.edit
            ? modal.id
              ? "Edit notification"
              : "Add notification"
            : "View notification"
        }
        description="IST scheduling · stored inbox publication is distinct from push delivery."
      >
        {modal?.id ? (
          <Details id={modal.id} edit={modal.edit} done={done} />
        ) : modal ? (
          <Form done={done} />
        ) : null}
      </Modal>
      <Modal
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
        title="Soft delete notification?"
        description="The record and read history remain. It becomes inactive and disappears from inboxes after synchronization. Already accepted pushes cannot be recalled."
      >
        {error && <p role="alert">{error}</p>}
        <Button
          variant="destructive"
          busy={busy}
          onClick={async () => {
            if (!deleting) return;
            setBusy(true);
            try {
              await adminRequest(`notifications/${deleting._id}/soft-delete`, {
                method: "POST",
                csrf: session.csrfToken,
                body: { revision: deleting.revision },
              });
              done();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Unable to delete");
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm soft deletion
        </Button>
      </Modal>
    </section>
  );
}
