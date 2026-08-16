import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Attachment, Bot, Group, GroupMessage, Message } from "../types";
import { store, useStore } from "../store";
import { api } from "../api";
import { Composer } from "./Composer";
import { BotAvatar } from "./BotAvatar";
import { FileCard, WorkLog } from "./Messages";
import { Markdown } from "./Markdown";
import { formatDayDivider } from "../util";
import { ScreenIcon } from "./icons";
import { useT } from "../i18n";

interface Props {
  group: Group;
  panelOpen: boolean;
  onTogglePanel: () => void;
}

const EMPTY_MESSAGES: GroupMessage[] = [];
const EMPTY_MEMBERS: Bot[] = [];

// 群聊线程：独立 transcript，不写成员私聊。
// 用户 @ 指定；Bot 用 send_message next/done 交接；否则主持人判断。
export function GroupChatView({ group, panelOpen, onTogglePanel }: Props) {
  const messages = useStore((s) => s.groupMessages[group.id]) ?? EMPTY_MESSAGES;
  const members = useStore((s) => s.groupMembers[group.id]) ?? EMPTY_MEMBERS;
  const working = useStore((s) => s.working);
  const workingChannel = useStore((s) => s.workingChannel);
  const stream = useStore((s) => s.stream);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const tr = useT();
  const groupChannel = `group:${group.id}`;
  const busy = members.filter((m) => working[m.id] && workingChannel[m.id] === groupChannel);

  useEffect(() => {
    store.loadGroup(group.id);
  }, [group.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, stream, busy.length]);

  const mentionNames = useMemo(
    () => [...members.map((m) => m.name), "everyone"],
    [members],
  );

  const colorOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m.avatar_color]));
    return (botId: string | null) => (botId ? (map.get(botId) ?? "#8B5CF6") : "#4b5563");
  }, [members]);

  return (
    <div style={root}>
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ display: "flex" }}>
            {members.slice(0, 3).map((m, i) => (
              <div key={m.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 3 - i }}>
                <BotAvatar
                  id={m.id}
                  color={m.avatar_color}
                  size={24}
                  status={m.status}
                  working={busy.some((b) => b.id === m.id)}
                  listening={listening}
                />
              </div>
            ))}
          </div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{group.name}</span>
          <span style={memberCount}>{tr("group.bots", { n: members.length })}</span>
        </div>
        <button
          style={{ ...hIconBtn, color: panelOpen ? "var(--text-primary)" : "var(--text-secondary)" }}
          onClick={onTogglePanel}
          title={tr("computer.shared")}
        >
          <ScreenIcon />
        </button>
      </div>

      <div style={scroll} ref={scrollRef}>
        <div style={thread}>
          {messages.length > 0 && (
            <div style={dayDivider}>{formatDayDivider(messages[0].created_at)}</div>
          )}
          {messages.length === 0 && (
            <div style={hint}>
              {tr("group.hint", { name: members[0]?.name ?? "Name" })}
            </div>
          )}
          <GroupThread messages={messages} colorOf={colorOf} live={busy.length > 0} />
          {busy.map((b) => {
            const live = stream[b.id] ?? "";
            if (live) {
              return (
                <div key={b.id} style={{ display: "flex", gap: 9, margin: "6px 0", alignItems: "flex-start" }}>
                  <BotAvatar id={b.id} color={b.avatar_color} size={26} working />
                  <div style={{ minWidth: 0 }}>
                    <div style={authorLine}>{b.name}</div>
                    <div style={bubbleBot}>
                      <Markdown text={live + "▍"} />
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 9, margin: "6px 2px" }}>
                <BotAvatar id={b.id} color={b.avatar_color} size={20} working />
                <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {tr("group.working", { name: b.name })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Composer
        botName={group.name}
        allowAttachments
        mentionNames={mentionNames}
        working={busy.length > 0}
        busy={uploading}
        onFocusChange={setListening}
        onStop={() => store.abortGroup(group.id)}
        onSend={async (text, files) => {
          if (files.length === 0) {
            store.groupPrompt(group.id, text);
            return;
          }
          setUploading(true);
          try {
            const attachments: Attachment[] = [];
            for (const file of files) {
              const { attachment } = await api.uploadGroupFile(
                group.id,
                file.name,
                await toBase64(file),
                file.type,
              );
              attachments.push(attachment);
            }
            store.groupPrompt(group.id, text, attachments);
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

function asMessage(message: GroupMessage): Message {
  return {
    id: message.id,
    bot_id: message.bot_id ?? "",
    thread_id: "",
    role: message.bot_id ? "assistant" : "user",
    author: message.author,
    content: message.content,
    kind: (message.kind as Message["kind"]) || "text",
    meta: message.meta ?? null,
    created_at: message.created_at,
  };
}

function GroupThread({
  messages,
  colorOf,
  live,
}: {
  messages: GroupMessage[];
  colorOf: (botId: string | null) => string;
  live: boolean;
}) {
  const out: ReactNode[] = [];
  let run: GroupMessage[] = [];
  const flush = (isTail: boolean) => {
    if (run.length === 0) return;
    out.push(
      <WorkLog
        key={`work-${run[0].id}`}
        messages={run.map(asMessage)}
        live={live && isTail}
      />,
    );
    run = [];
  };
  for (const message of messages) {
    if (message.kind === "tool") {
      if (run.length > 0 && run[0].bot_id !== message.bot_id) flush(false);
      run.push(message);
      continue;
    }
    flush(false);
    if (message.kind === "file") {
      out.push(<FileCard key={message.id} message={asMessage(message)} />);
      continue;
    }
    out.push(
      <GroupBubble key={message.id} message={message} color={colorOf(message.bot_id)} botId={message.bot_id} />,
    );
  }
  flush(true);
  return <>{out}</>;
}

function GroupBubble({
  message,
  color,
  botId,
}: {
  message: GroupMessage;
  color: string;
  botId: string | null;
}) {
  if (message.kind === "system") {
    return <div style={systemLine}>{message.content}</div>;
  }
  const isUser = message.bot_id === null;
  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "3px 0" }}>
        <div style={bubbleUser}>{message.content}</div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", gap: 9, margin: "6px 0", alignItems: "flex-start" }}>
      <BotAvatar id={botId ?? undefined} color={color} size={26} />
      <div style={{ minWidth: 0 }}>
        <div style={authorLine}>{message.author}</div>
        <div style={message.kind === "handoff" ? bubbleHandoff : bubbleBot}>
          <Markdown text={message.content} />
        </div>
      </div>
    </div>
  );
}

const root: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-main)",
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
const memberCount: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-secondary)",
  background: "var(--bg-active)",
  padding: "2px 8px",
  borderRadius: 10,
};
const scroll: React.CSSProperties = { flex: 1, overflowY: "auto" };
const thread: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "18px 20px 8px" };
const dayDivider: React.CSSProperties = {
  textAlign: "center",
  fontSize: 11.5,
  color: "var(--text-secondary)",
  margin: "6px 0 14px",
};
const hint: React.CSSProperties = {
  textAlign: "center",
  fontSize: 12.5,
  color: "var(--text-placeholder)",
  lineHeight: 1.6,
  padding: "40px 40px 0",
};
const systemLine: React.CSSProperties = {
  textAlign: "center",
  fontSize: 12,
  color: "var(--text-secondary)",
  margin: "10px 24px",
  lineHeight: 1.5,
};
const authorLine: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-secondary)",
  margin: "0 0 3px 3px",
};
const bubbleUser: React.CSSProperties = {
  maxWidth: "74%",
  padding: "9px 14px",
  borderRadius: 18,
  borderBottomRightRadius: 6,
  fontSize: 14,
  background: "var(--bg-bubble-user)",
  wordBreak: "break-word",
  animation: "fade-up 0.18s ease",
};
const bubbleBot: React.CSSProperties = {
  maxWidth: "100%",
  padding: "9px 14px",
  borderRadius: 18,
  borderTopLeftRadius: 6,
  fontSize: 14,
  background: "var(--bg-bubble-bot)",
  border: "1px solid var(--border-subtle)",
  wordBreak: "break-word",
  animation: "fade-up 0.18s ease",
};
const bubbleHandoff: React.CSSProperties = {
  ...bubbleBot,
  opacity: 0.88,
  fontSize: 13,
  borderStyle: "dashed",
};
