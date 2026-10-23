"use client";
import { useState } from "react";
import { UserPlus, Pencil, History } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ResourceTable } from "../tables/resource-table";
import { useAdmin } from "../layout/shell";
import { useToast } from "../layout/providers";
import { Button, Modal } from "../shared/ui";
import { AdminForm } from "./admin-form";
import { adminRequest } from "../../../lib/admin/api";
import type { DataRow } from "../../../types/admin";
export function Administrators() {
  const session = useAdmin();
  const toast = useToast();
  const client = useQueryClient();
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<DataRow | null>(null);
  const [history, setHistory] = useState<DataRow | null>(null);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["admin"] });
    toast("Administrator changes saved. Affected sessions have been revoked.");
    setCreate(false);
    setEdit(null);
  };
  return (
    <>
      <div className="a-page-heading">
        <div>
          <div className="a-eyebrow">ACCESS MANAGEMENT</div>
          <h1>Administrators</h1>
          <p>
            Manage your platform team with explicit roles and audited changes.
          </p>
        </div>
        <Button onClick={() => setCreate(true)}>
          <UserPlus size={16} />
          Add administrator
        </Button>
      </div>
      <div className="a-notice">
        Administrator changes require recent password confirmation. You cannot
        change your own role or deactivate yourself.
      </div>
      <ResourceTable
        resource="administrators"
        actions={(row) => (
          <div className="a-inline-actions">
            <Button
              variant="ghost"
              aria-label={`Edit ${row.name}`}
              disabled={String(row.id) === session.administrator.id}
              onClick={() => setEdit(row)}
            >
              <Pencil size={15} />
              Edit
            </Button>
            <Button
              variant="ghost"
              aria-label={`Audit history for ${row.name}`}
              onClick={() => setHistory(row)}
            >
              <History size={15} />
              History
            </Button>
          </div>
        )}
      />
      <Modal
        title="Add administrator"
        description="Share the initial password through a protected channel."
        open={create}
        onOpenChange={setCreate}
      >
        <AdminForm
          fields={[
            { name: "name", label: "Full name", min: 2 },
            { name: "email", label: "Work email", type: "email" },
            {
              name: "role",
              label: "Role",
              options: ["SUPPORT", "ADMIN", "SUPER_ADMIN"],
              defaultValue: "SUPPORT",
            },
            {
              name: "password",
              label: "Initial password (14+ characters)",
              type: "password",
              min: 14,
            },
          ]}
          submitLabel="Create administrator"
          onSubmit={async (values) => {
            await adminRequest("administrators", {
              method: "POST",
              body: values,
              csrf: session.csrfToken,
            });
            await refresh();
          }}
        />
      </Modal>
      <Modal
        title="Edit administrator"
        description={
          edit
            ? `${edit.name} · ${edit.email}. Saving changes immediately revokes this administrator’s sessions.`
            : ""
        }
        open={Boolean(edit)}
        onOpenChange={(open) => {
          if (!open) setEdit(null);
        }}
      >
        {edit && (
          <AdminForm
            key={String(edit.id)}
            fields={[
              {
                name: "role",
                label: "Role",
                options: ["SUPPORT", "ADMIN", "SUPER_ADMIN"],
                defaultValue: String(edit.role),
              },
              {
                name: "active",
                label: "Account status",
                options: ["Enabled", "Disabled"],
                defaultValue: edit.active ? "Enabled" : "Disabled",
              },
            ]}
            submitLabel="Save access changes"
            onSubmit={async (values) => {
              await adminRequest(`administrators/${edit.id}`, {
                method: "PATCH",
                body: {
                  role: values.role,
                  active: values.active === "Enabled",
                },
                csrf: session.csrfToken,
              });
              await refresh();
            }}
          />
        )}
      </Modal>
      <Modal
        title="Administrator audit history"
        description={
          history
            ? `Actions performed by ${history.name}. Read-only audit history.`
            : ""
        }
        open={Boolean(history)}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
      >
        {history && (
          <ResourceTable resource="audit-logs" adminId={String(history.id)} />
        )}
      </Modal>
    </>
  );
}
