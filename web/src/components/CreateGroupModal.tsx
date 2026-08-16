import { useState } from "react";
import type { Bot } from "../types";
import { api } from "../api";
import { store } from "../store";
import { BotAvatar } from "./BotAvatar";
import { CloseIcon } from "./icons";
import { useT } from "../i18n";

interface Props {
  bots: Bot[];
  onClose: () => void;
  onCreated: (groupId: string) => void;
}

const MAX_MEMBERS = 6;

export function CreateGroupModal({ bots, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const tr = useT();

  const toggle = (id: string) =>
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= MAX_MEMBERS) return p;
      return [...p, id];
    });

  const submit = async () => {
    if (!name.trim() || picked.length < 2 || picked.length > MAX_MEMBERS || busy) return;
    setBusy(true);
    try {
      const { group } = await api.createGroup(name.trim(), picked);
      await store.refreshGroups();
      onCreated(group.id);
    } finally {
      setBusy(false);
    }
  };

  const ready = name.trim() && picked.length >= 2 && picked.length <= MAX_MEMBERS && !busy;

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>{tr("createGroup.title")}</span>
          <button style={closeBtn} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
          {tr("createGroup.subtitle")}
        </div>

        <label style={label}>{tr("createGroup.name")}</label>
        <input
          style={input}
          placeholder={tr("createGroup.namePh")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />

        <label style={label}>{tr("createGroup.members")}</label>
        <div style={list}>
          {bots.map((b) => {
            const on = picked.includes(b.id);
            const blocked = !on && picked.length >= MAX_MEMBERS;
            return (
              <button
                key={b.id}
                style={{ ...row, ...(on ? rowOn : {}), ...(blocked ? rowBlocked : {}) }}
                onClick={() => toggle(b.id)}
                disabled={blocked}
              >
                <BotAvatar id={b.id} color={b.avatar_color} size={28} />
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{b.name}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-secondary)" }}>
                  {on ? tr("createGroup.added") : ""}
                </span>
              </button>
            );
          })}
          {bots.length < 2 && (
            <div style={{ fontSize: 12.5, color: "var(--text-placeholder)", padding: "10px 4px" }}>
              {tr("createGroup.needTwo")}
            </div>
          )}
        </div>
        {picked.length >= MAX_MEMBERS && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8 }}>
            {tr("createGroup.max")}
          </div>
        )}

        <button style={{ ...create, opacity: ready ? 1 : 0.5 }} onClick={submit} disabled={!ready}>
          {busy ? tr("createGroup.creating") : tr("createGroup.create")}
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
const create: React.CSSProperties = {
  width: "100%",
  marginTop: 18,
  background: "var(--btn-primary-bg)",
  color: "var(--btn-primary-fg)",
  fontWeight: 600,
  fontSize: 14,
  padding: "11px",
  borderRadius: 10,
};
