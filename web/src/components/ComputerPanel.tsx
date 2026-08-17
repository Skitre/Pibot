import { useEffect, useState, type MouseEvent } from "react";
import type { Bot, Group, Routine } from "../types";
import { api } from "../api";
import { useStore } from "../store";
import { MoreIcon, CloseIcon, PlayIcon, TrashIcon } from "./icons";
import { BotAvatar } from "./BotAvatar";
import { askConfirm } from "../prefs";
import { useT } from "../i18n";
import { isNativeContextTarget, MenuItem, MenuSep, useContextMenu } from "./ContextMenu";

interface Props {
  bot?: Bot | null;
  group?: Group | null;
  onClose: () => void;
}

export function ComputerPanel({ bot, group, onClose }: Props) {
  const computer = useStore((s) => s.computer);
  const bots = useStore((s) => s.bots);
  const groupMembers = useStore((s) => s.groupMembers);
  const working = useStore((s) => s.working);
  const workingChannel = useStore((s) => s.workingChannel);
  const members = group ? resolveGroupMembers(group, groupMembers, bots) : [];
  const [pickedByGroup, setPickedByGroup] = useState<Record<string, string>>({});
  const pickedId = group ? pickedByGroup[group.id] : undefined;
  const screenBot = bot ?? members.find((row) => row.id === pickedId) ?? members[0] ?? null;
  const [expanded, setExpanded] = useState(false);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [creating, setCreating] = useState(false);
  const [computerStartFailed, setComputerStartFailed] = useState(false);
  const [computerRestartFailed, setComputerRestartFailed] = useState(false);
  const [computerStopFailed, setComputerStopFailed] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const { open, openAt, close } = useContextMenu();
  const tr = useT();
  const screenPort = botScreenPort(computer, screenBot, bots, members);
  const url = screenPort ? `http://${location.hostname}:${screenPort}/` : null;
  const pickScreen = (id: string) => {
    if (!group) return;
    setPickedByGroup((prev) => (prev[group.id] === id ? prev : { ...prev, [group.id]: id }));
  };
  const screenTitle = screenBot
    ? tr("computer.botScreen", { name: screenBot.name })
    : tr("computer.shared");

  useEffect(() => {
    if (!bot) {
      setRoutines([]);
      return;
    }
    api.routines(bot.id).then((r) => setRoutines(r.routines));
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the selected bot changes
  }, [bot?.id]);

  const online = computer?.status === "online";
  const computerStarting = computer?.status === "starting";

  useEffect(() => {
    if (!online) return;
    setComputerStartFailed(false);
    setComputerRestartFailed(false);
    setComputerStopFailed(false);
  }, [online]);

  const openOrStartComputer = async () => {
    if (online && url) {
      setExpanded(true);
      return;
    }
    if (computerStarting) return;
    setComputerStartFailed(false);
    setComputerRestartFailed(false);
    setComputerStopFailed(false);
    try {
      await api.startComputer();
    } catch {
      setComputerStartFailed(true);
    }
  };

  const restartComputer = async () => {
    if (computerStarting) return;
    if (!askConfirm(tr("computer.restartConfirm"))) return;
    setComputerStartFailed(false);
    setComputerRestartFailed(false);
    setComputerStopFailed(false);
    try {
      await api.restartComputer();
    } catch {
      setComputerRestartFailed(true);
    }
  };

  const stopComputer = async () => {
    if (!online || computerStarting) return;
    if (!askConfirm(tr("computer.stopConfirm"))) return;
    setComputerStartFailed(false);
    setComputerRestartFailed(false);
    setComputerStopFailed(false);
    try {
      await api.stopComputer();
    } catch {
      setComputerStopFailed(true);
    }
  };

  const chromeMenu = () => (
    <>
      <MenuItem
        disabled={!online || !url}
        onClick={() => {
          if (url) setExpanded(true);
        }}
      >
        {tr("computer.fullscreen")}
      </MenuItem>
      <MenuItem disabled={computerStarting} onClick={() => void restartComputer()}>
        {tr("computer.restart")}
      </MenuItem>
      <MenuItem danger disabled={!online || computerStarting} onClick={() => void stopComputer()}>
        {tr("computer.stop")}
      </MenuItem>
      <MenuSep />
      <MenuItem onClick={onClose}>{tr("computer.closePanel")}</MenuItem>
    </>
  );

  const onChromeMenu = (e: MouseEvent) => {
    if (isNativeContextTarget(e.target)) return;
    if ((e.target as HTMLElement).closest("iframe")) return;
    open(e, chromeMenu());
  };

  const toggleDots = (el: HTMLElement) => {
    if (menuFor === "dots") {
      close();
      setMenuFor(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setMenuFor("dots");
    openAt(r.right - 8, r.bottom + 4, chromeMenu(), { onClose: () => setMenuFor(null) });
  };

  if (expanded && url) {
    return (
      <div style={fullOverlay} onContextMenu={onChromeMenu}>
        <div style={fullBar}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{screenTitle}</span>
          {group && members.length > 1 && (
            <div style={fullPicker}>
              {members.map((row) => (
                <button
                  key={row.id}
                  style={fullPickerBtn(row.id === screenBot?.id)}
                  title={tr("computer.botScreen", { name: row.name })}
                  onClick={() => pickScreen(row.id)}
                  onContextMenu={(e) =>
                    open(e, <MenuItem onClick={() => pickScreen(row.id)}>{tr("computer.watchScreen")}</MenuItem>)
                  }
                >
                  <BotAvatar
                    id={row.id}
                    color={row.avatar_color}
                    size={22}
                    working={!!working[row.id]}
                  />
                </button>
              ))}
            </div>
          )}
          <span style={{ ...controlTag, position: "static", marginLeft: "auto" }}>{tr("computer.inControl")}</span>
          <button style={iconBtn} onClick={() => setExpanded(false)} title={tr("computer.minimize")}>
            <CloseIcon />
          </button>
        </div>
        <iframe key={`${screenBot?.id ?? "none"}:${url}`} src={url} style={fullFrame} title="bot-screen-full" />
      </div>
    );
  }

  return (
    <div style={panel} onContextMenu={onChromeMenu}>
      <div style={panelHeader}>
        <span />
        <div style={{ display: "flex", gap: 4 }}>
          <button
            style={iconBtn}
            title={tr("computer.settings")}
            onClick={(e) => {
              e.stopPropagation();
              toggleDots(e.currentTarget);
            }}
          >
            <MoreIcon size={15} />
          </button>
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
              <iframe key={`${screenBot?.id ?? "none"}:${url}`} src={url} style={thumbFrame} title="bot-screen" scrolling="no" />
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
                <span style={computerStartFailed || computerRestartFailed || computerStopFailed ? startError : startHint}>
                  {tr(
                    computerStopFailed
                      ? "computer.stopFailed"
                      : computerRestartFailed
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
        <div style={thumbLabel}>{screenBot ? screenTitle : tr("computer.label")}</div>
      </div>

      {group && members.length > 0 && (
        <div style={pickerSection}>
          <div style={pickerTitle}>{tr("computer.pickScreen")}</div>
          {members.map((row) => {
            const selected = row.id === screenBot?.id;
            const busy = !!working[row.id] && workingChannel[row.id] === `group:${group.id}`;
            return (
              <button
                key={row.id}
                style={pickerRow(selected)}
                onClick={() => pickScreen(row.id)}
                onContextMenu={(e) =>
                  open(e, <MenuItem onClick={() => pickScreen(row.id)}>{tr("computer.watchScreen")}</MenuItem>)
                }
              >
                <BotAvatar id={row.id} color={row.avatar_color} size={26} working={busy} />
                <span style={pickerName}>{row.name}</span>
                {busy && <span style={pickerBusy}>{tr("computer.working")}</span>}
              </button>
            );
          })}
        </div>
      )}

      {bot && (
      <div style={routinesSection}>
        {routines.length === 0 && !creating && (
          <div style={routinesEmpty}>{tr("computer.routinesEmpty")}</div>
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
            {tr("computer.createRoutine")}
          </button>
        )}
      </div>
      )}
    </div>
  );
}

function resolveGroupMembers(
  group: Group,
  groupMembers: Record<string, Bot[]>,
  bots: Bot[],
): Bot[] {
  const stored = groupMembers[group.id];
  if (stored?.length) return stored;
  return (group.bot_ids ?? [])
    .map((id) => bots.find((row) => row.id === id))
    .filter((row): row is Bot => !!row);
}

function botScreenPort(
  computer: { vncPort: number; screens?: Record<string, { vncPort: number }>; slotCount?: number } | null,
  bot: Bot | null | undefined,
  bots: Bot[],
  members: Bot[],
) {
  if (!computer?.vncPort || !bot) return null;
  const claimed = computer.screens?.[bot.id]?.vncPort;
  if (claimed) return claimed;
  const idx = bots.findIndex((row) => row.id === bot.id);
  const fallback = idx >= 0 ? idx : members.findIndex((row) => row.id === bot.id);
  if (fallback < 0) return null;
  const count = computer.slotCount && computer.slotCount > 0 ? computer.slotCount : 6;
  return computer.vncPort + 1 + (fallback % count);
}

function RoutineRow({ routine, onChange }: { routine: Routine; onChange: () => void }) {
  const [ran, setRan] = useState(false);
  const { open } = useContextMenu();
  const tr = useT();
  const runNow = async () => {
    setRan(true);
    await api.runRoutine(routine.id);
    setTimeout(() => setRan(false), 2000);
    onChange();
  };
  const remove = async () => {
    if (!askConfirm(tr("computer.deleteRoutineConfirm", { name: routine.name }))) return;
    await api.deleteRoutine(routine.id);
    onChange();
  };
  return (
    <div
      style={routineRow}
      onContextMenu={(e) =>
        open(
          e,
          <>
            <MenuItem onClick={() => void runNow()}>{tr("computer.runNow")}</MenuItem>
            <MenuItem
              onClick={() => void api.toggleRoutine(routine.id, !routine.enabled).then(onChange)}
            >
              {routine.enabled ? tr("computer.disableRoutine") : tr("computer.enableRoutine")}
            </MenuItem>
            <MenuSep />
            <MenuItem danger onClick={() => void remove()}>
              {tr("computer.deleteRoutine")}
            </MenuItem>
          </>,
        )
      }
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {routine.name}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
          {ran ? tr("computer.runningNow") : routine.cron}
        </div>
      </div>
      <button
        style={routineBtn}
        title={tr("computer.runNow")}
        onClick={() => void runNow()}
      >
        <PlayIcon size={12} color="var(--text-secondary)" />
      </button>
      <button
        style={routineBtn}
        title={tr("computer.deleteRoutine")}
        onClick={() => void remove()}
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
  const tr = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <input style={formInput} placeholder={tr("computer.formName")} value={name} onChange={(e) => setName(e.target.value)} />
      <input style={formInput} placeholder={tr("computer.formCron")} value={cron} onChange={(e) => setCron(e.target.value)} />
      <textarea style={{ ...formInput, minHeight: 54, resize: "vertical" }} placeholder={tr("computer.formTask")} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          style={createBtn}
          onClick={async () => {
            if (!name || !prompt) return;
            await api.createRoutine(botId, name, cron, prompt);
            onDone();
          }}
        >
          {tr("computer.save")}
        </button>
        <button style={{ ...createBtn, background: "transparent" }} onClick={onDone}>
          {tr("computer.cancel")}
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
const pickerSection: React.CSSProperties = {
  marginTop: 14,
  padding: "0 16px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  minHeight: 0,
  overflowY: "auto",
};
const pickerTitle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  padding: "0 4px 4px",
};
const pickerRow = (selected: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "7px 8px",
  borderRadius: 8,
  background: selected ? "var(--bg-active)" : "transparent",
  color: "var(--text-primary)",
});
const pickerName: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const pickerBusy: React.CSSProperties = {
  fontSize: 10.5,
  color: "var(--text-secondary)",
  flexShrink: 0,
};
const fullPicker: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  marginLeft: 8,
};
const fullPickerBtn = (selected: boolean): React.CSSProperties => ({
  width: 28,
  height: 28,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  background: selected ? "var(--bg-active)" : "transparent",
  padding: 0,
});
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
