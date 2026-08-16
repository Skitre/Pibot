import { useEffect, useRef, useState } from "react";
import type { Bot, Routine } from "../types";
import { api } from "../api";
import { useStore } from "../store";
import { GearIcon, CloseIcon, PlayIcon, TrashIcon } from "./icons";
import { askConfirm } from "../prefs";
import { useT } from "../i18n";

interface Props {
  bot?: Bot | null;
  onClose: () => void;
}

export function ComputerPanel({ bot, onClose }: Props) {
  const computer = useStore((s) => s.computer);
  const [expanded, setExpanded] = useState(false);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [creating, setCreating] = useState(false);
  const [computerStartFailed, setComputerStartFailed] = useState(false);
  const [computerRestartFailed, setComputerRestartFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tr = useT();
  // 共享电脑架构：整个账户一台电脑，KasmVNC 端口是全局的
  const url =
    computer?.vncPort ? `http://${location.hostname}:${computer.vncPort}/` : null;

  useEffect(() => {
    if (!bot) {
      setRoutines([]);
      return;
    }
    api.routines(bot.id).then((r) => setRoutines(r.routines));
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the selected bot changes
  }, [bot?.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [menuOpen]);

  const online = computer?.status === "online";
  const computerStarting = computer?.status === "starting";

  useEffect(() => {
    if (!online) return;
    setComputerStartFailed(false);
    setComputerRestartFailed(false);
  }, [online]);

  const openOrStartComputer = async () => {
    if (online && url) {
      setExpanded(true);
      return;
    }
    if (computerStarting) return;
    setComputerStartFailed(false);
    setComputerRestartFailed(false);
    try {
      await api.startComputer();
    } catch {
      setComputerStartFailed(true);
    }
  };

  const restartComputer = async () => {
    setMenuOpen(false);
    if (computerStarting) return;
    if (!askConfirm(tr("computer.restartConfirm"))) return;
    setComputerStartFailed(false);
    setComputerRestartFailed(false);
    try {
      await api.restartComputer();
    } catch {
      setComputerRestartFailed(true);
    }
  };

  if (expanded && url) {
    return (
      <div style={fullOverlay}>
        <div style={fullBar}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{tr("computer.shared")}</span>
          <span style={controlTag}>{tr("computer.inControl")}</span>
          <button style={iconBtn} onClick={() => setExpanded(false)} title={tr("computer.minimize")}>
            <CloseIcon />
          </button>
        </div>
        <iframe src={url} style={fullFrame} title="bot-screen-full" />
      </div>
    );
  }

  return (
    <div style={panel}>
      <div style={panelHeader}>
        <span />
        <div style={{ display: "flex", gap: 4 }}>
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              style={iconBtn}
              title={tr("computer.settings")}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <GearIcon size={15} />
            </button>
            {menuOpen && (
              <div style={settingsMenu}>
                <button
                  style={{
                    ...settingsMenuItem,
                    opacity: computerStarting ? 0.4 : 1,
                    cursor: computerStarting ? "default" : "pointer",
                  }}
                  disabled={computerStarting}
                  onClick={restartComputer}
                >
                  {tr("computer.restart")}
                </button>
              </div>
            )}
          </div>
          <button style={iconBtn} onClick={onClose} title={tr("computer.closePanel")}>
            <CloseIcon />
          </button>
        </div>
      </div>

      <div style={{ padding: "0 16px" }}>
        <button
          style={{ ...thumb, cursor: online && url || !computerStarting ? "pointer" : "default" }}
          onClick={openOrStartComputer}
        >
          {online && url ? (
            <>
              <iframe src={url} style={thumbFrame} title="bot-screen" scrolling="no" />
              <div style={thumbOverlay}>
                <span style={{ ...controlTag, position: "static" }}>
                  {tr("computer.working")}
                </span>
              </div>
            </>
          ) : (
            <div style={thumbPlaceholder}>
              <span>{computerStarting ? tr("computer.booting") : tr("computer.offline")}</span>
              {!computerStarting && (
                <span style={computerStartFailed || computerRestartFailed ? startError : startHint}>
                  {tr(
                    computerRestartFailed
                      ? "computer.restartFailed"
                      : computerStartFailed
                        ? "computer.startFailed"
                        : "computer.startHint",
                  )}
                </span>
              )}
            </div>
          )}
        </button>
        <div style={thumbLabel}>{tr("computer.label")}</div>
      </div>

      {bot && (
      <div style={routinesSection}>
        {routines.length === 0 && !creating && (
          <div style={routinesEmpty}>Routines are recurring tasks this agent runs on a schedule.</div>
        )}
        {routines.map((r) => (
          <RoutineRow key={r.id} routine={r} onChange={() => api.routines(bot.id).then((x) => setRoutines(x.routines))} />
        ))}
        {creating ? (
          <RoutineForm
            botId={bot.id}
            onDone={() => {
              setCreating(false);
              api.routines(bot.id).then((x) => setRoutines(x.routines));
            }}
          />
        ) : (
          <button style={createBtn} onClick={() => setCreating(true)}>
            Create Routine
          </button>
        )}
      </div>
      )}
    </div>
  );
}

function RoutineRow({ routine, onChange }: { routine: Routine; onChange: () => void }) {
  const [ran, setRan] = useState(false);
  return (
    <div style={routineRow}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {routine.name}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
          {ran ? "Running now…" : routine.cron}
        </div>
      </div>
      <button
        style={routineBtn}
        title="Run now"
        onClick={async () => {
          setRan(true);
          await api.runRoutine(routine.id);
          setTimeout(() => setRan(false), 2000);
          onChange();
        }}
      >
        <PlayIcon size={12} color="var(--text-secondary)" />
      </button>
      <button
        style={routineBtn}
        title="Delete routine"
        onClick={async () => {
          if (!confirm(`Delete routine "${routine.name}"?`)) return;
          await api.deleteRoutine(routine.id);
          onChange();
        }}
      >
        <TrashIcon size={13} color="var(--text-secondary)" />
      </button>
      <label style={{ display: "flex", alignItems: "center" }}>
        <input
          type="checkbox"
          checked={!!routine.enabled}
          onChange={(e) => api.toggleRoutine(routine.id, e.target.checked).then(onChange)}
        />
      </label>
    </div>
  );
}

function RoutineForm({ botId, onDone }: { botId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <input style={formInput} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={formInput} placeholder="Cron (e.g. 0 9 * * *)" value={cron} onChange={(e) => setCron(e.target.value)} />
      <textarea style={{ ...formInput, minHeight: 54, resize: "vertical" }} placeholder="Task to run" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          style={createBtn}
          onClick={async () => {
            if (!name || !prompt) return;
            await api.createRoutine(botId, name, cron, prompt);
            onDone();
          }}
        >
          Save
        </button>
        <button style={{ ...createBtn, background: "transparent" }} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  width: 300,
  minWidth: 300,
  height: "100%",
  background: "var(--bg-panel)",
  borderLeft: "1px solid var(--border-subtle)",
  display: "flex",
  flexDirection: "column",
};
const panelHeader: React.CSSProperties = {
  height: 52,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 12px",
};
const iconBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 7,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
};
const settingsMenu: React.CSSProperties = {
  position: "absolute",
  top: 34,
  right: 0,
  zIndex: 30,
  minWidth: 170,
  background: "#232326",
  border: "1px solid var(--border-subtle)",
  borderRadius: 10,
  padding: 4,
  boxShadow: "0 12px 32px rgba(0, 0, 0, 0.55)",
};
const settingsMenuItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: 7,
  color: "var(--text-primary)",
};
const thumb: React.CSSProperties = {
  width: "100%",
  aspectRatio: "16 / 10",
  borderRadius: 8,
  overflow: "hidden",
  background: "#000",
  border: "1px solid var(--border-subtle)",
  position: "relative",
  padding: 0,
};
const thumbFrame: React.CSSProperties = {
  width: "200%",
  height: "200%",
  border: "none",
  transform: "scale(0.5)",
  transformOrigin: "top left",
  pointerEvents: "none",
};
const thumbOverlay: React.CSSProperties = {
  position: "absolute",
  bottom: 6,
  left: 6,
};
const thumbPlaceholder: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  fontSize: 12,
  color: "var(--text-secondary)",
};
const startHint: React.CSSProperties = {
  fontSize: 10.5,
  color: "var(--text-tertiary)",
};
const startError: React.CSSProperties = {
  ...startHint,
  color: "#c2413b",
};
const thumbLabel: React.CSSProperties = {
  textAlign: "center",
  fontSize: 11.5,
  color: "var(--text-secondary)",
  marginTop: 6,
};
const controlTag: React.CSSProperties = {
  position: "absolute",
  fontSize: 10.5,
  background: "rgba(0,0,0,0.6)",
  color: "#fff",
  padding: "2px 7px",
  borderRadius: 6,
  backdropFilter: "blur(4px)",
};
const routinesSection: React.CSSProperties = {
  marginTop: "auto",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const routinesEmpty: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  textAlign: "center",
  lineHeight: 1.5,
};
const routineRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  background: "var(--bg-bubble-bot)",
  borderRadius: 8,
  padding: "8px 10px",
};
const routineBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 6,
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};
const createBtn: React.CSSProperties = {
  background: "var(--bg-active)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontWeight: 500,
  padding: "8px 14px",
  borderRadius: 8,
  alignSelf: "center",
};
const formInput: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 7,
  padding: "7px 10px",
  fontSize: 12.5,
  outline: "none",
};
const fullOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#000",
  zIndex: 50,
  display: "flex",
  flexDirection: "column",
};
const fullBar: React.CSSProperties = {
  height: 44,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "0 16px",
  borderBottom: "1px solid var(--border-subtle)",
};
const fullFrame: React.CSSProperties = { flex: 1, border: "none", width: "100%" };
