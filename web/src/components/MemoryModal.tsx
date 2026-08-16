import { useEffect, useState } from "react";
import type { Bot } from "../types";
import { api } from "../api";
import { CloseIcon } from "./icons";
import { useT } from "../i18n";

interface Props {
  bot: Bot;
  onClose: () => void;
}

// 查看/编辑 Bot 的持久记忆（容器内 /config/bots/<id>/AGENTS.md）。
export function MemoryModal({ bot, onClose }: Props) {
  const tr = useT();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getMemory(bot.id)
      .then(({ content }) => setContent(content))
      .catch((e) => setError(String(e)));
  }, [bot.id]);

  const save = async () => {
    if (content === null) return;
    setBusy(true);
    setError("");
    try {
      await api.setMemory(bot.id, content);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <button style={closeBtn} onClick={onClose} title="Close">
          <CloseIcon />
        </button>
        <h2 style={h2}>{bot.name}'s memory</h2>
        <p style={hint}>{tr("memory.hint")}</p>

        {error && <div style={errStyle}>{error}</div>}
        {content === null && !error && <div style={loading}>Loading from bot's computer…</div>}
        {content !== null && (
          <>
            <textarea
              style={editor}
              value={content}
              spellCheck={false}
              onChange={(e) => setContent(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
              <button style={primaryBtn} onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button style={ghostBtn} onClick={onClose}>
                Close
              </button>
              {saved && <span style={savedTag}>Saved</span>}
            </div>
          </>
        )}
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
  zIndex: 45,
  backdropFilter: "blur(2px)",
};
const modal: React.CSSProperties = {
  width: 640,
  maxWidth: "94vw",
  maxHeight: "86vh",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-sidebar)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 16,
  padding: "22px 24px",
  position: "relative",
  animation: "fade-up 0.2s ease",
};
const closeBtn: React.CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  width: 30,
  height: 30,
  borderRadius: 7,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
};
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 600, margin: "0 0 6px" };
const hint: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
  margin: "0 0 14px",
};
const loading: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  padding: "30px 0",
  textAlign: "center",
};
const editor: React.CSSProperties = {
  flex: 1,
  minHeight: 320,
  background: "var(--bg-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 10,
  padding: "12px 14px",
  fontSize: 12.5,
  lineHeight: 1.6,
  fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
  outline: "none",
  resize: "vertical",
};
const errStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "#ef4444",
  margin: "0 0 10px",
  lineHeight: 1.5,
};
const primaryBtn: React.CSSProperties = {
  background: "var(--btn-primary-bg)",
  color: "var(--btn-primary-fg)",
  fontWeight: 600,
  fontSize: 13,
  padding: "8px 18px",
  borderRadius: 8,
};
const ghostBtn: React.CSSProperties = {
  background: "var(--bg-active)",
  color: "var(--text-primary)",
  fontSize: 13,
  padding: "8px 18px",
  borderRadius: 8,
};
const savedTag: React.CSSProperties = { fontSize: 12.5, color: "var(--green-dot)" };
