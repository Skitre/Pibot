import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { CloseIcon } from "./icons";

interface Props {
  onClose: () => void;
  onCreated: (id: string) => void;
  onOpenSettings: () => void;
}

// 官方 "Give each Bot a job" 预设模板
const TEMPLATES = [
  { name: "Sales Outbound", role: "Generate pipeline overnight: research accounts, score contacts with intent, and draft email and LinkedIn outreach in the user's voice, leaving a review list to approve." },
  { name: "Chief of Staff", role: "Coordinate the user's other bots, keep projects aligned, triage the inbox, and only surface judgment calls that need a decision." },
  { name: "Talent Scout", role: "Scan for hiring signals and job seekers, keep a candidate list, and suggest matches." },
  { name: "Paid Media", role: "Monitor ad campaigns, adjust budgets within limits, and report performance." },
  { name: "Expense Manager", role: "Process invoices and receipts, categorize expenses, and flag anomalies." },
  { name: "Bug Reproduction", role: "Reproduce reported bugs in the product UI, file tickets, and hand fixes to an engineering bot." },
  { name: "Account Health", role: "Keep customers warm: update CRM notes, send product updates, and file support tickets." },
  { name: "Custom", role: "" },
];

export function CreateBotModal({ onClose, onCreated, onOpenSettings }: Props) {
  const profiles = useStore((s) => s.profiles);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  // 用户是否手动改过输入框：改过就不再被预设覆盖，没改过则跟随预设切换
  const [nameEdited, setNameEdited] = useState(false);
  const [roleEdited, setRoleEdited] = useState(false);

  const pick = (t: (typeof TEMPLATES)[number]) => {
    setSelected(t.name);
    const isCustom = t.name === "Custom";
    if (!nameEdited) setName(isCustom ? "" : t.name);
    if (!roleEdited) setRole(t.role);
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { bot } = await api.createBot(name.trim(), role.trim(), modelId || undefined);
      onCreated(bot.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <span style={{ fontSize: 17, fontWeight: 600 }}>Meet your first Bot</span>
          <button style={closeBtn} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
          An AI teammate you can trust to get work done. Give it a job:
        </div>

        <div style={grid}>
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              style={{ ...tpl, ...(selected === t.name ? tplActive : {}) }}
              onClick={() => pick(t)}
            >
              {t.name}
            </button>
          ))}
        </div>

        <label style={label}>Name</label>
        <input
          style={input}
          placeholder="e.g. Bobby"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameEdited(true);
          }}
          autoFocus
        />

        <label style={label}>What should it do?</label>
        <textarea
          style={{ ...input, minHeight: 76, resize: "vertical" }}
          placeholder="Describe the bot's role and how you like work done…"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setRoleEdited(true);
          }}
        />

        <label style={label}>Model</label>
        {profiles.length === 0 ? (
          <div style={noModel}>
            还没有配置模型，Bot 创建后无法对话。
            <button style={linkBtn} onClick={onOpenSettings}>
              去设置里添加
            </button>
          </div>
        ) : (
          <select style={input} value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">
              Use default
              {profiles.find((p) => p.is_default === 1)
                ? ` (${profiles.find((p) => p.is_default === 1)!.name})`
                : ""}
            </option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.model_id}
              </option>
            ))}
          </select>
        )}

        <button style={{ ...create, opacity: name.trim() && !busy ? 1 : 0.5 }} onClick={submit} disabled={!name.trim() || busy}>
          {busy ? "Creating…" : "Create teammate"}
        </button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "grid",
  placeItems: "center",
  zIndex: 40,
  backdropFilter: "blur(2px)",
};
const modal: React.CSSProperties = {
  width: 520,
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
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: 8,
  marginBottom: 18,
};
// 用拆分属性而非 border 简写：与 tplActive 的 borderColor 混用会触发 React 样式冲突告警
const tpl: React.CSSProperties = {
  background: "var(--bg-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 13,
  fontWeight: 500,
  textAlign: "left",
  color: "var(--text-primary)",
};
const tplActive: React.CSSProperties = { borderColor: "#fff", background: "var(--bg-active)" };
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
const noModel: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--text-secondary)",
  background: "var(--bg-input)",
  borderRadius: 9,
  padding: "10px 12px",
  lineHeight: 1.6,
};
const linkBtn: React.CSSProperties = {
  color: "var(--accent-blue)",
  fontSize: 12.5,
  padding: 0,
  marginLeft: 4,
  textDecoration: "underline",
};
const create: React.CSSProperties = {
  width: "100%",
  marginTop: 18,
  background: "#fff",
  color: "#000",
  fontWeight: 600,
  fontSize: 14,
  padding: "11px",
  borderRadius: 10,
};
