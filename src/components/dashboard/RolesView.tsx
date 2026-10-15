"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { addRoleAction, removeRoleAction, renameRoleAction, reorderRolesAction } from "@/app/dashboard/website/exec/actions";
import { Icon } from "@/components/membership/icons";
import Dialog from "./Dialog";
import { Toast } from "./MembersView";
import { useSave } from "./Shell";
import { DragHandle, useReorder } from "./useReorder";

const FAILED = { ok: false as const, error: "Something went wrong. Please try again." };

// The positions exec pick from when editing a person, in the club's order.
export default function RolesView({ roles, holders }: { roles: string[]; holders: Record<string, string[]> }) {
  const router = useRouter();
  const save = useSave();
  const [order, setOrder] = useState(roles);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const clearNotice = useCallback(() => setNotice(""), []);
  const reorder = useReorder<HTMLTableSectionElement>({ count: order.length, onMove: (from, to) => void saveOrder(from, to) });

  useEffect(() => setOrder(roles), [roles]);

  async function saveOrder(from: number, to: number) {
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next);
    const result = await save(() => reorderRolesAction(next));
    if (!result.ok) setOrder(roles);
    router.refresh();
  }

  return (
    <main className="d-page">
      <div className="d-section-head">
        <h1 className="d-h2">Roles <span className="d-count">{order.length}</span></h1>
        <button type="button" className="d-icon-btn" aria-label="Add role" data-tip="Add role" onClick={() => setEditing("new")}><Icon name="plus" size={16} /></button>
      </div>
      <p className="d-section-note">The positions active exec can have. Renaming a role renames it for the active exec who have it. Alumni keep the title they held.</p>
      <div className="d-table-wrap">
        <table className={`d-table is-roomy d-links d-roles${reorder.sorting ? " is-sorting" : ""}`}>
          <thead>
            <tr><th className="d-drag-cell" aria-hidden="true" /><th>Role</th><th className="is-wide">Active</th><th className="is-end"><span className="d-sr">Actions</span></th></tr>
          </thead>
          <tbody ref={reorder.listRef}>
            {order.map((role, i) => {
              const { className, ...row } = reorder.rowProps(i);
              const people = holders[role] || [];
              return (
                <tr key={role} {...row} className={className || undefined}>
                  <td className="d-drag-cell"><DragHandle label={role} {...reorder.handleProps(i)} /></td>
                  <td>
                    <button type="button" className="d-name-btn" onClick={() => setEditing(role)}>{role}</button>
                    <span className="d-member-meta">{people.join(", ") || "Nobody"}</span>
                  </td>
                  <td className="is-soft is-wide">{people.join(", ") || <span className="is-faint">Nobody</span>}</td>
                  <td className="is-action">
                    <button type="button" className="d-more-btn" aria-label={`Edit ${role}`} onClick={() => setEditing(role)}><Icon name="more" size={18} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {order.length === 0 && <p className="d-empty-row">No roles yet.</p>}
      </div>
      <Toast message={notice} onDone={clearNotice} />
      {editing && (
        <RoleDialog
          role={editing === "new" ? null : editing} holders={editing === "new" ? [] : holders[editing] || []}
          onClose={() => setEditing(null)}
          onDone={(message) => { setNotice(message); router.refresh(); }}
        />
      )}
    </main>
  );
}

function RoleDialog({ role, holders, onClose, onDone }: { role: string | null; holders: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const [name, setName] = useState(role || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string, close: (then?: () => void) => void) {
    setBusy(true);
    setError("");
    const result = await work().catch(() => FAILED);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    close(() => { onClose(); onDone(message); });
  }

  function submit(event: FormEvent, close: (then?: () => void) => void) {
    event.preventDefault();
    const clean = name.replace(/\s+/g, " ").trim();
    if (role === clean) return close();
    void run(() => (role ? renameRoleAction(role, clean) : addRoleAction(clean)), role ? `Renamed it to ${clean}.` : `Added ${clean}.`, close);
  }

  function remove(close: (then?: () => void) => void) {
    if (!role || !window.confirm(`Remove the role “${role}”? Alumni who had it keep it.`)) return;
    void run(() => removeRoleAction(role), `Removed ${role}.`, close);
  }

  return (
    <Dialog title={role ? "Edit role" : "Add role"} onClose={onClose}>
      {(close) => (
        <form className="d-dialog-form" onSubmit={(e) => submit(e, close)}>
          <label className="d-field">
            <span className="m-label">Role</span>
            <input className="m-input is-compact" value={name} required maxLength={60} data-autofocus placeholder="Social Chair" onChange={(e) => setName(e.target.value)} />
            {role && holders.length > 0 && <span className="d-field-note">Renaming also changes it for {holders.join(", ")}.</span>}
          </label>
          {error && <p className="m-error" role="alert">{error}</p>}
          <button type="submit" className="m-btn is-medium" disabled={busy}>{busy ? "Saving…" : role ? "Save" : "Add role"}</button>
          {role && (
            <button
              type="button" className="d-danger-link" disabled={busy || holders.length > 0} onClick={() => remove(close)}
              data-tip={holders.length ? "Change the position of everyone who has this role first" : undefined}
            >
              Remove role
            </button>
          )}
        </form>
      )}
    </Dialog>
  );
}
