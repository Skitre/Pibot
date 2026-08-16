import { useEffect, useRef, useState } from "react";
import type { Attachment, Bot } from "../types";
import { store, useStore } from "../store";
import { api } from "../api";
import { usePrefs } from "../prefs";
import { MessageThread, BotBubble } from "./Messages";
import { Composer } from "./Composer";
import { BotAvatar } from "./BotAvatar";
import type { BotMarkHandle } from "../mark/BotMark";
import { ScreenIcon, GearIcon } from "./icons";
import { formatDayDivider, isMainChannel } from "../util";
import { useT } from "../i18n";

interface Props {
  bot: Bot;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onOpenSettings: () => void;
  onOpenAgentSettings: () => void;
}

const EMPTY_MESSAGES: import("../types").Message[] = [];

export function ChatView({ bot, panelOpen, onTogglePanel, onOpenSettings, onOpenAgentSettings }: Props) {
  // 选择器必须返回稳定引用，否则 useSyncExternalStore 会判定快照持续变化 → 无限更新
  const messages = useStore((s) => s.messages[bot.id]) ?? EMPTY_MESSAGES;
  const stream = useStore((s) => (isMainChannel(s.workingChannel[bot.id]) ? s.stream[bot.id] : undefined));
  const working = useStore((s) => !!s.working[bot.id] && isMainChannel(s.workingChannel[bot.id]));
  const busyGroup = useStore((s) => {
    const channel = s.workingChannel[bot.id] ?? "";
    if (s.working[bot.id] && channel.startsWith("group:")) {
      const id = channel.slice("group:".length);
      return s.groups.find((g) => g.id === id)?.name ?? id;
    }
    for (const [id, on] of Object.entries(s.groupRunning)) {
      if (!on) continue;
      if ((s.groupRunBots[id] ?? []).includes(bot.id)) {
        return s.groups.find((g) => g.id === id)?.name ?? id;
      }
    }
    return "";
  });
  const profiles = useStore((s) => s.profiles);
  const p = usePrefs();
  const tr = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<BotMarkHandle>(null);

  const activeProfile =
    profiles.find((x) => x.id === bot.model_profile_id) ??
    profiles.find((x) => x.is_default === 1);

  const visibleMessages = messages.filter(
    (m) =>
      (p.showToolCards || m.kind !== "tool") && (p.showSystemLines || m.kind !== "system"),
  );

  useEffect(() => {
    store.loadMessages(bot.id);
  }, [bot.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, stream, working]);

  return (
    <div style={root}>
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BotAvatar
            ref={markRef}
            id={bot.id}
            color={bot.avatar_color}
            size={26}
            status={bot.status}
            working={!!working}
            listening={listening}
          />
          <span style={{ fontSize: 15, fontWeight: 600 }}>{bot.name}</span>
          <StatusPill status={bot.status} />
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", position: "relative" }}>
          {activeProfile && (
            <button style={modelChip} onClick={() => setMenuOpen((v) => !v)} title={tr("chat.changeModel")}>
              {activeProfile.model_name}
            </button>
          )}
          <button
            style={{ ...hIconBtn, color: panelOpen ? "var(--text-primary)" : "var(--text-secondary)" }}
            onClick={onTogglePanel}
            title={tr("chat.botScreen")}
          >
            <ScreenIcon />
          </button>
          <button style={hIconBtn} title={tr("chat.settings")} onClick={onOpenAgentSettings}>
            <GearIcon />
          </button>

          {menuOpen && (
            <ModelMenu
              bot={bot}
              onClose={() => setMenuOpen(false)}
              onOpenSettings={() => {
                setMenuOpen(false);
                onOpenSettings();
              }}
            />
          )}
        </div>
      </div>

      {busyGroup ? <div style={busyBanner}>{tr("chat.busyInGroup", { name: bot.name, group: busyGroup })}</div> : null}

      <div style={scroll} ref={scrollRef}>
        <div style={thread}>
          {visibleMessages.length > 0 && (
            <div style={dayDivider}>{formatDayDivider(visibleMessages[0].created_at)}</div>
          )}
          <MessageThread messages={visibleMessages} live={!!working} />
          {stream !== undefined && stream.length > 0 && (
            <BotBubble text={stream + "▍"} />
          )}
          {working && (stream === undefined || stream.length === 0) && (
            <WorkingIndicator bot={bot} />
          )}
        </div>
      </div>

      <Composer
        botId={bot.id}
        botName={bot.name}
        working={!!working}
        busy={uploading}
        onFocusChange={setListening}
        onStop={() => store.abort(bot.id)}
        onSend={async (text, files) => {
          markRef.current?.bounce(2);
          if (files.length === 0) {
            store.prompt(bot.id, text);
            return;
          }
          setUploading(true);
          try {
            const attachments: Attachment[] = [];
            for (const f of files) {
              const { attachment } = await api.uploadFile(bot.id, f.name, await toBase64(f), f.type);
              attachments.push(attachment);
            }
            store.prompt(bot.id, text, attachments);
          } catch (err) {
            alert(tr("chat.attachFail", { error: (err as Error).message }));
          } finally {
            setUploading(false);
          }
        }}
      />
    </div>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// 单个 Bot 的模型切换：写库后由服务端经桥接下发到容器，无需重建容器
function ModelMenu({
  bot,
  onClose,
  onOpenSettings,
}: {
  bot: Bot;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const profiles = useStore((s) => s.profiles);
  const ref = useRef<HTMLDivElement>(null);
  const tr = useT();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const choose = async (id: string | null) => {
    await api.setBotModel(bot.id, id);
    onClose();
  };

  return (
    <div ref={ref} style={menu}>
      <div style={menuLabel}>{tr("chat.modelFor", { name: bot.name })}</div>
      <button style={menuItem} onClick={() => choose(null)}>
        {bot.model_profile_id === null ? "● " : ""}
        {tr("chat.useDefault")}
      </button>
      {profiles.map((p) => (
        <button key={p.id} style={menuItem} onClick={() => choose(p.id)}>
          {bot.model_profile_id === p.id ? "● " : ""}
          {p.name}
          <span style={{ color: "var(--text-secondary)", fontSize: 11.5 }}> · {p.model_id}</span>
        </button>
      ))}
      <div style={{ height: 1, background: "var(--border-subtle)", margin: "4px 0" }} />
      <button style={menuItem} onClick={onOpenSettings}>
        {tr("chat.manageModels")}
      </button>
    </div>
  );
}

function WorkingIndicator({ bot }: { bot: Bot }) {
  const tr = useT();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "8px 2px" }}>
      <BotAvatar id={bot.id} color={bot.avatar_color} size={22} working />
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        {tr("chat.working", { name: bot.name })}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tr = useT();
  if (status === "online") return null;
  const label =
    status === "provisioning"
      ? tr("chat.statusSetup")
      : status === "starting"
        ? tr("chat.statusStarting")
        : status === "stopped"
          ? tr("chat.statusOffline")
          : status === "error"
            ? tr("chat.statusError")
            : status;
  return <span style={statusPill}>{label}</span>;
}

const root: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-main)",
};
const busyBanner: React.CSSProperties = {
  margin: "0 16px 0",
  padding: "8px 12px",
  fontSize: 12.5,
  lineHeight: 1.45,
  color: "var(--text-secondary)",
  background: "var(--bg-active)",
  borderRadius: 10,
};
const header: React.CSSProperties = {
  height: 52,
  minHeight: 52,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 16px",
  borderBottom: "1px solid var(--border-subtle)",
};
const hIconBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
};
const scroll: React.CSSProperties = { flex: 1, overflowY: "auto" };
const thread: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "18px 20px 8px" };
const dayDivider: React.CSSProperties = {
  textAlign: "center",
  fontSize: 11.5,
  color: "var(--text-secondary)",
  margin: "6px 0 14px",
};
const statusPill: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  background: "var(--bg-active)",
  padding: "2px 8px",
  borderRadius: 10,
};
const modelChip: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-secondary)",
  background: "var(--bg-active)",
  padding: "4px 10px",
  borderRadius: 10,
  marginRight: 4,
  maxWidth: 180,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const menu: React.CSSProperties = {
  position: "absolute",
  top: 38,
  right: 0,
  zIndex: 30,
  minWidth: 230,
  background: "#232326",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 10,
  padding: 4,
  boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
  animation: "fade-up 0.12s ease",
};
const menuLabel: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  padding: "6px 10px 4px",
};
const menuItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontSize: 13,
  padding: "7px 10px",
  borderRadius: 7,
};
