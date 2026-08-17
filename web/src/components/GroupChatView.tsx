import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  clampThinkingLevel,
  supportedThinkingLevels,
  type Attachment,
  type Bot,
  type Group,
  type GroupMessage,
  type Message,
} from "../types";
import { store, useStore } from "../store";
import { api } from "../api";
import { Composer } from "./Composer";
import { BotAvatar } from "./BotAvatar";
import { GroupCluster } from "./GroupCluster";
import { FileCard, WorkLog } from "./Messages";
import { Markdown } from "./Markdown";
import { formatDayDivider } from "../util";
import { ScreenIcon, GearIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";
import { translateThinkingLevel, useT } from "../i18n";

interface Props {
  group: Group;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onEditGroup: () => void;
}

const EMPTY_MESSAGES: GroupMessage[] = [];
const EMPTY_MEMBERS: Bot[] = [];

// 群聊线程：独立 transcript，不写成员私聊。
// 用户 @ 指定；Bot 用 send_message next/done 交接；否则主持人判断。
export function GroupChatView({ group, panelOpen, onTogglePanel, onEditGroup }: Props) {
  const messages = useStore((s) => s.groupMessages[group.id]) ?? EMPTY_MESSAGES;
  const members = useStore((s) => s.groupMembers[group.id]) ?? EMPTY_MEMBERS;
  const working = useStore((s) => s.working);
  const workingChannel = useStore((s) => s.workingChannel);
  const assigning = useStore((s) => !!s.groupAssigning[group.id]);
  const waiting = useStore((s) => !!s.groupWaiting[group.id]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [moderatorOpen, setModeratorOpen] = useState(false);
  const tr = useT();
  const hostName = group.moderator_name?.trim() || tr("group.hostFallback");
  const groupChannel = `group:${group.id}`;
  const busy = members.filter((m) => working[m.id] && workingChannel[m.id] === groupChannel);

  useEffect(() => {
    store.loadGroup(group.id);
    setModeratorOpen(false);
  }, [group.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy.length, assigning, waiting]);

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
        <button className="group-title-btn" style={titleBtn} onClick={onEditGroup} title={tr("sidebar.editThread")}>
          <GroupCluster
            members={members}
            size={24}
            overlap={8}
            workingIds={busy.map((b) => b.id)}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {group.name}
            </div>
            {group.description?.trim() ? (
              <div style={descLine}>{group.description}</div>
            ) : null}
          </div>
          <span style={memberCount}>{tr("group.bots", { n: members.length })}</span>
        </button>
        <div style={{ display: "flex", gap: 4, alignItems: "center", position: "relative" }}>
          <ThemeToggle />
          <button
            style={{ ...hIconBtn, color: panelOpen ? "var(--text-primary)" : "var(--text-secondary)" }}
            onClick={onTogglePanel}
            title={tr("computer.shared")}
          >
            <ScreenIcon />
          </button>
          <button
            data-moderator-toggle=""
            style={{ ...hIconBtn, color: moderatorOpen ? "var(--text-primary)" : "var(--text-secondary)" }}
            onClick={() => setModeratorOpen((v) => !v)}
            title={tr("group.moderatorSettings")}
          >
            <GearIcon />
          </button>
          {moderatorOpen && (
            <ModeratorPanel key={group.id} group={group} onClose={() => setModeratorOpen(false)} />
          )}
        </div>
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
          <GroupThread messages={messages} colorOf={colorOf} live={busy.length > 0 || assigning} />
          {assigning && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "6px 2px" }}>
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {tr("group.assigning", { name: hostName })}
              </span>
            </div>
          )}
          {waiting && !assigning && busy.length === 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "6px 2px" }}>
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {tr("group.waiting")}
              </span>
            </div>
          )}
          {busy.map((b) => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 9, margin: "6px 2px" }}>
              <BotAvatar id={b.id} color={b.avatar_color} size={20} working />
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {tr("group.working", { name: b.name })}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Composer
        botName={group.name}
        allowAttachments
        mentionNames={mentionNames}
        working={busy.length > 0 || assigning}
        busy={uploading}
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

function ModeratorPanel({ group, onClose }: { group: Group; onClose: () => void }) {
  const profiles = useStore((s) => s.profiles);
  const tr = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(group.moderator_name ?? tr("group.hostFallback"));
  const [profileId, setProfileId] = useState(group.moderator_profile_id ?? "");
  const [instructions, setInstructions] = useState(group.moderator_instructions ?? "");
  const [maxTokens, setMaxTokens] = useState(String(group.moderator_max_tokens || ""));
  const [history, setHistory] = useState(String(group.moderator_history || ""));
  const [thinking, setThinking] = useState(group.moderator_thinking ?? "");
  const defaultProfile = profiles.find((profile) => profile.is_default === 1) ?? profiles[0];
  const selectedProfile = profileId
    ? (profiles.find((profile) => profile.id === profileId) ?? defaultProfile)
    : defaultProfile;
  const reasoning = selectedProfile?.reasoning === 1;
  const thinkingLevelMap = selectedProfile?.thinking_level_map ?? "{}";
  const thinkingLevels = supportedThinkingLevels(reasoning, thinkingLevelMap);
  const inheritedThinking = clampThinkingLevel(
    reasoning,
    thinkingLevelMap,
    selectedProfile?.thinking ?? "off",
  );
  const draft = useRef({ name, profileId, instructions, maxTokens, history, thinking });
  draft.current = { name, profileId, instructions, maxTokens, history, thinking };

  const save = (d: typeof draft.current) =>
    store.updateGroupModerator(group.id, {
      name: d.name,
      profileId: d.profileId || null,
      instructions: d.instructions,
      maxTokens: Number(d.maxTokens) || 0,
      history: Number(d.history) || 0,
      thinking: d.thinking,
    });

  const persist = async (next?: Partial<typeof draft.current>) => {
    await save({ ...draft.current, ...next });
  };

  useEffect(() => {
    return () => {
      void save(draft.current);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- flush the draft only when switching group
  }, [group.id]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (wrapRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-moderator-toggle]")) return;
      onClose();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div ref={wrapRef} style={moderatorMenu}>
      <div style={moderatorTitle}>{tr("group.moderatorTitle")}</div>
      <p style={moderatorHint}>{tr("group.moderatorHint")}</p>
      <label style={moderatorLabel}>{tr("group.moderatorName")}</label>
      <input
        style={moderatorInput}
        value={name}
        placeholder={tr("group.moderatorNamePh")}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void persist()}
      />
      <label style={moderatorLabel}>{tr("group.moderatorModel")}</label>
      <select
        style={moderatorInput}
        value={profileId}
        onChange={(e) => {
          const next = e.target.value;
          const nextProfile = next
            ? (profiles.find((profile) => profile.id === next) ?? defaultProfile)
            : defaultProfile;
          const nextThinking =
            thinking && nextProfile?.reasoning === 1
              ? clampThinkingLevel(true, nextProfile.thinking_level_map, thinking)
              : "";
          setProfileId(next);
          setThinking(nextThinking);
          void persist({ profileId: next, thinking: nextThinking });
        }}
      >
        <option value="">{tr("group.moderatorDefault")}</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.model_id}
          </option>
        ))}
      </select>
      <label style={moderatorLabel}>{tr("group.moderatorThinking")}</label>
      <select
        style={moderatorInput}
        value={thinking ? clampThinkingLevel(reasoning, thinkingLevelMap, thinking) : ""}
        disabled={!reasoning}
        onChange={(e) => {
          const next = e.target.value;
          setThinking(next);
          void persist({ thinking: next });
        }}
      >
        <option value="">
          {tr("group.moderatorInherit")} ({translateThinkingLevel(inheritedThinking, tr)})
        </option>
        {thinkingLevels.map((level) => (
          <option key={level} value={level}>
            {translateThinkingLevel(level, tr)}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={moderatorLabel}>{tr("group.moderatorMaxTokens")}</label>
          <input
            style={moderatorInput}
            type="number"
            min={0}
            value={maxTokens}
            placeholder={tr("group.moderatorInherit")}
            onChange={(e) => setMaxTokens(e.target.value)}
            onBlur={() => void persist()}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={moderatorLabel}>{tr("group.moderatorHistory")}</label>
          <input
            style={moderatorInput}
            type="number"
            min={0}
            value={history}
            placeholder={tr("group.moderatorInherit")}
            onChange={(e) => setHistory(e.target.value)}
            onBlur={() => void persist()}
          />
        </div>
      </div>
      <label style={moderatorLabel}>{tr("group.moderatorNotes")}</label>
      <textarea
        style={{ ...moderatorInput, minHeight: 72, resize: "vertical" }}
        value={instructions}
        placeholder={tr("group.moderatorNotesPh")}
        onChange={(e) => setInstructions(e.target.value)}
        onBlur={() => void persist()}
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
  minHeight: 52,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 16px",
  borderBottom: "1px solid var(--border-subtle)",
};
const titleBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
  padding: "2px 6px 2px 2px",
  marginLeft: -2,
  borderRadius: 8,
  textAlign: "left",
  color: "inherit",
};
const descLine: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-secondary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: 280,
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
  color: "var(--text-bubble-user)",
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
const moderatorMenu: React.CSSProperties = {
  position: "absolute",
  top: 38,
  right: 0,
  zIndex: 30,
  width: 300,
  background: "var(--bg-elevated)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 10,
  padding: "10px 12px 12px",
  boxShadow: "var(--shadow)",
  animation: "fade-up 0.12s ease",
};
const moderatorTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
};
const moderatorHint: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-secondary)",
  lineHeight: 1.45,
  margin: "0 0 10px",
};
const moderatorLabel: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--text-secondary)",
  margin: "8px 0 4px",
};
const moderatorInput: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 13,
  outline: "none",
  color: "var(--text-primary)",
};
