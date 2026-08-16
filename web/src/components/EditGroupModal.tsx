import { useState } from "react";
import type { Bot, Group } from "../types";
import { apiErrorMessage } from "../api";
import { store, useStore } from "../store";
import { BotAvatar } from "./BotAvatar";
import { CloseIcon } from "./icons";
import { useT } from "../i18n";

interface Props {
  group: Group;
  bots: Bot[];
  onClose: () => void;
}

const MAX_MEMBERS = 6;
const MIN_MEMBERS = 2;

export function EditGroupModal({ group, bots, onClose }: Props) {
  const storedMembers = useStore((s) => s.groupMembers[group.id]);
  const initialIds =
    group.bot_ids?.length ? group.bot_ids : (storedMembers?.map((m) => m.id) ?? []);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [picked, setPicked] = useState<string[]>(initialIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tr = useT();

  const toggle = (id: string) =>
    setPicked((p) => {
      if (p.includes(id)) {
        if (p.length <= MIN_MEMBERS) return p;
        return p.filter((x) => x !== id);
      }
      if (p.length >= MAX_MEMBERS) return p;
      return [...p, id];
    });

  const submit = async () => {
    if (!name.trim() || picked.length < MIN_MEMBERS || picked.length > MAX_MEMBERS || busy) return;
    setBusy(true);
    setError("");
    try {
      await store.updateGroup(group.id, {
        name: name.trim(),
        description: description.trim(),
        botIds: picked,
      });
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = name.trim() && picked.length >= MIN_MEMBERS && picked.length <= MAX_MEMBERS && !busy;

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{tr("editGroup.title")}</span>
          <button style={closeBtn} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
          {tr("editGroup.subtitle")}
        </div>

        <label style={label}>{tr("createGroup.name")}</label>
        <input
          style={input}
          placeholder={tr("createGroup.namePh")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <label style={label}>{tr("createGroup.description")}</label>
        <textarea
          style={{ ...input, minHeight: 64, resize: "vertical" }}
          placeholder={tr("createGroup.descriptionPh")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />

        <label style={label}>{tr("createGroup.members")}</label>
        <div style={list}>
          {bots.map((b) => {
            const on = picked.includes(b.id);
            const blocked = !on && picked.length >= MAX_MEMBERS;
            const last = on && picked.length <= MIN_MEMBERS;
            return (
              <button
                key={b.id}
                style={{ ...row, ...(on ? rowOn : {}), ...(blocked ? rowBlocked : {}) }}
                onClick={() => toggle(b.id)}
                disabled={blocked}
                title={last ? tr("editGroup.minMembers") : undefined}
              >
                <BotAvatar id={b.id} color={b.avatar_color} size={28} />
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{b.name}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-secondary)" }}>
                  {on ? tr("createGroup.added") : ""}
                </span>
              </button>
            );
          })}
        </div>
        {picked.length >= MAX_MEMBERS && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}>
            {tr("createGroup.max")}
          </div>
        )}
        {error && <div style={err}>{error}</div>}

        <button style={{ ...save, opacity: ready ? 1 : 0.5 }} onClick={() => void submit()} disabled={!ready}>
          {busy ? tr("editGroup.saving") : tr("editGroup.save")}
        </button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  display: "grid",
  placeItems: "center",
  zIndex: 40,
  backdropFilter: "blur(2px)",
};
const modal: React.CSSProperties = {
  width: 460,
  maxWidth: "92vw",
  maxHeight: "88vh",
  overflowY: "auto",
  background: "var(--bg-sidebar)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 16,
  padding: 22,
  animation: "fade-up 0.2s ease",
};
const head: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 6,
};
const closeBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 7,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--text-secondary)",
  margin: "10px 0 5px",
};
const input: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-input)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 9,
  padding: "9px 12px",
  fontSize: 14,
  outline: "none",
  color: "var(--text-primary)",
};
const list: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 260,
  overflowY: "auto",
};
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "transparent",
  background: "var(--bg-input)",
  textAlign: "left",
};
const rowOn: React.CSSProperties = { borderColor: "var(--text-primary)", background: "var(--bg-active)" };
const rowBlocked: React.CSSProperties = { opacity: 0.45 };
const err: React.CSSProperties = { fontSize: 12, color: "#ef4444", marginTop: 10 };
const save: React.CSSProperties = {
  width: "100%",
  marginTop: 18,
  background: "var(--btn-primary-bg)",
  color: "var(--btn-primary-fg)",
  fontWeight: 600,
  fontSize: 14,
  padding: "11px",
  borderRadius: 10,
};
