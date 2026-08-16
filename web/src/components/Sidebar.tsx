import { useEffect, useRef, useState } from "react";
import type { Bot, Group } from "../types";
import { BotAvatar } from "./BotAvatar";
import {
  PlusIcon,
  SearchIcon,
  ChevronRight,
  MoreIcon,
  UsersIcon,
  GearIcon,
} from "./icons";
import { formatTime } from "../util";
import { api } from "../api";
import { store, useStore } from "../store";
import { askConfirm } from "../prefs";
import { useT } from "../i18n";

export type Selection = { kind: "bot" | "group"; id: string } | null;

interface Props {
  bots: Bot[];
  groups: Group[];
  working: Record<string, boolean>;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onNewBot: () => void;
  onNewGroup: () => void;
  onOpenSettings: () => void;
  onEditBot: (bot: Bot) => void;
  onOpenMemory: (bot: Bot) => void;
}

export function Sidebar({
  bots,
  groups,
  working,
  selection,
  onSelect,
  onNewBot,
  onNewGroup,
  onOpenSettings,
  onEditBot,
  onOpenMemory,
}: Props) {
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const unread = useStore((s) => s.unread);
  const groupUnread = useStore((s) => s.groupUnread);
  const groupRunning = useStore((s) => s.groupRunning);
  const groupRunBots = useStore((s) => s.groupRunBots);
  const workingChannel = useStore((s) => s.workingChannel);
  const tr = useT();

  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const visible = bots.filter((b) => (showHidden ? true : !b.hidden));
  const hiddenCount = bots.filter((b) => b.hidden).length;
  const filtered = visible.filter((b) => matches(b.name) || matches(b.last_message));
  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    return (b.last_activity || b.created_at) - (a.last_activity || a.created_at);
  });
  const filteredGroups = [...groups.filter((g) => matches(g.name) || matches(g.last_message ?? ""))].sort(
    (a, b) => (b.last_activity || b.created_at) - (a.last_activity || a.created_at),
  );

  return (
    <div style={S.root}>
      <div style={S.topbar}>
        <div style={{ position: "relative" }}>
          <button style={S.iconBtn} onClick={() => setAddMenu((v) => !v)} title={tr("sidebar.new")}>
            <PlusIcon size={18} />
          </button>
          {addMenu && (
            <Menu onClose={() => setAddMenu(false)} align="right">
              <MenuItem
                onClick={() => {
                  setAddMenu(false);
                  onNewBot();
                }}
              >
                {tr("sidebar.newBot")}
              </MenuItem>
              <MenuItem
                disabled={bots.length < 2}
                onClick={() => {
                  setAddMenu(false);
                  onNewGroup();
                }}
              >
                {tr("sidebar.newThread")}
              </MenuItem>
            </Menu>
          )}
        </div>
      </div>

      <div style={S.searchWrap}>
        <span style={S.searchIcon}>
          <SearchIcon />
        </span>
        <input
          style={S.search}
          placeholder={tr("sidebar.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div style={S.list}>
        {filteredGroups.map((g) => {
          const active = selection?.kind === "group" && selection.id === g.id;
          const groupBusy =
            !!groupRunning[g.id] ||
            Object.entries(workingChannel).some(
              ([botId, channel]) => working[botId] && channel === `group:${g.id}`,
            );
          const unseen = !!groupUnread[g.id];
          return (
            <div key={g.id} className="side-row" style={{ position: "relative" }}>
              <button
                className="side-item"
                style={{ ...S.item, ...(active ? S.itemActive : {}) }}
                onClick={() => onSelect({ kind: "group", id: g.id })}
              >
                <div style={{ position: "relative" }}>
                  <div style={S.groupAvatar}>
                    <UsersIcon size={18} color="var(--text-primary)" />
                  </div>
                  {groupBusy && <span style={{ ...S.statusDot, background: "var(--accent-blue)" }} />}
                </div>
                <div style={S.itemBody}>
                  <div style={S.itemTop}>
                    <span style={S.itemName}>{g.name}</span>
                    {unseen && <span style={S.unreadDot} />}
                    <span className="row-time" style={S.itemTime}>
                      {formatTime(g.last_activity || g.created_at)}
                    </span>
                  </div>
                  <div
                    style={{
                      ...S.itemPreview,
                      ...(unseen ? { color: "var(--text-primary)", fontWeight: 500 } : {}),
                    }}
                  >
                    {g.last_message || tr("sidebar.groupThread")}
                  </div>
                </div>
              </button>
              <button
                className={menuFor === g.id ? "row-more open" : "row-more"}
                style={S.moreBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuFor(menuFor === g.id ? null : g.id);
                }}
                title={tr("sidebar.options")}
              >
                <MoreIcon />
              </button>
              {menuFor === g.id && (
                <Menu onClose={() => setMenuFor(null)} align="right" top={44}>
                  <MenuItem
                    danger
                    onClick={() => {
                      if (askConfirm(tr("sidebar.deleteThreadConfirm", { name: g.name }))) {
                        api.deleteGroup(g.id);
                      }
                      setMenuFor(null);
                    }}
                  >
                    {tr("sidebar.deleteThread")}
                  </MenuItem>
                </Menu>
              )}
            </div>
          );
        })}

        {sorted.map((b) => {
          const active = selection?.kind === "bot" && selection.id === b.id;
          const inGroupRun = Object.entries(groupRunBots).some(
            ([id, ids]) => groupRunning[id] && ids.includes(b.id),
          );
          const botBusy = !!working[b.id] || inGroupRun;
          return (
            <div key={b.id} className="side-row" style={{ position: "relative" }}>
              <button
                className="side-item"
                style={{ ...S.item, ...(active ? S.itemActive : {}) }}
                onClick={() => onSelect({ kind: "bot", id: b.id })}
              >
                <div style={{ position: "relative" }}>
                  <BotAvatar id={b.id} color={b.avatar_color} size={40} status={b.status} working={botBusy} />
                  {(b.needs_attention || botBusy) && (
                    <span
                      style={{
                        ...S.statusDot,
                        background: botBusy ? "var(--accent-blue)" : "var(--green-dot)",
                      }}
                    />
                  )}
                </div>
                <div style={S.itemBody}>
                  <div style={S.itemTop}>
                    <span style={S.itemName}>
                      {b.pinned ? "📌 " : ""}
                      {b.name}
                    </span>
                    {unread[b.id] && <span style={S.unreadDot} />}
                    <span className="row-time" style={S.itemTime}>
                      {formatTime(b.last_activity || b.created_at)}
                    </span>
                  </div>
                  <div
                    style={{
                      ...S.itemPreview,
                      ...(unread[b.id]
                        ? { color: "var(--text-primary)", fontWeight: 500 }
                        : {}),
                    }}
                  >
                    {b.last_message || (
                      <span style={{ color: "var(--text-placeholder)" }}>
                        {b.role || tr("sidebar.newTeammate")}
                      </span>
                    )}
                  </div>
                </div>
              </button>
              <button
                className={menuFor === b.id ? "row-more open" : "row-more"}
                style={S.moreBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuFor(menuFor === b.id ? null : b.id);
                }}
                title={tr("sidebar.options")}
              >
                <MoreIcon />
              </button>
              {menuFor === b.id && (
                <Menu onClose={() => setMenuFor(null)} align="right" top={44}>
                  <MenuItem
                    onClick={() => {
                      setMenuFor(null);
                      onEditBot(b);
                    }}
                  >
                    {tr("sidebar.editBot")}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenuFor(null);
                      onOpenMemory(b);
                    }}
                  >
                    {tr("sidebar.memory")}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      store.markRead(b.id, !!unread[b.id]);
                      setMenuFor(null);
                    }}
                  >
                    {unread[b.id] ? tr("sidebar.markRead") : tr("sidebar.markUnread")}
                  </MenuItem>
                  <MenuItem
                    onClick={async () => {
                      setMenuFor(null);
                      await api.duplicateBot(b.id);
                    }}
                  >
                    {tr("sidebar.duplicate")}
                  </MenuItem>
                  <MenuItem onClick={() => api.pinBot(b.id, !b.pinned)}>
                    {b.pinned ? tr("sidebar.unpin") : tr("sidebar.pin")}
                  </MenuItem>
                  <MenuItem onClick={() => api.hideBot(b.id, !b.hidden)}>
                    {b.hidden ? tr("sidebar.unhide") : tr("sidebar.hide")}
                  </MenuItem>
                  {b.status === "stopped" ? (
                    <MenuItem onClick={() => api.startBot(b.id)}>{tr("sidebar.wake")}</MenuItem>
                  ) : (
                    <MenuItem onClick={() => api.stopBot(b.id)}>{tr("sidebar.sleep")}</MenuItem>
                  )}
                  <MenuItem
                    onClick={() => {
                      setMenuFor(null);
                      if (askConfirm(tr("sidebar.clearChatConfirm", { name: b.name }))) {
                        api.clearMessages(b.id);
                      }
                    }}
                  >
                    {tr("sidebar.clearChat")}
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      if (askConfirm(tr("sidebar.deleteBotConfirm", { name: b.name }))) {
                        api.deleteBot(b.id);
                      }
                    }}
                  >
                    {tr("sidebar.deleteBot")}
                  </MenuItem>
                </Menu>
              )}
            </div>
          );
        })}

        {sorted.length === 0 && filteredGroups.length === 0 && (
          <div style={S.empty}>{tr("sidebar.empty")}</div>
        )}
      </div>

      {hiddenCount > 0 && (
        <button style={S.hiddenRow} onClick={() => setShowHidden((v) => !v)}>
          <span>{tr("sidebar.hiddenChats")}</span>
          <span style={S.hiddenCount}>{hiddenCount}</span>
          <span style={{ display: "grid", transform: showHidden ? "rotate(90deg)" : undefined }}>
            <ChevronRight size={15} color="var(--text-secondary)" />
          </span>
        </button>
      )}

      <div style={S.footer}>
        <button style={S.footerRow} onClick={onOpenSettings}>
          <GearIcon size={16} />
          <span>{tr("sidebar.settings")}</span>
        </button>
      </div>
    </div>
  );
}

function Menu({
  children,
  onClose,
  align,
  top,
}: {
  children: React.ReactNode;
  onClose: () => void;
  align: "left" | "right";
  top?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // 延迟一帧挂载，避免触发菜单的那次点击立即关闭它
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        ...S.menu,
        top: top ?? 34,
        ...(align === "right" ? { right: 0 } : { left: 0 }),
      }}
    >
      {children}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      style={{
        ...S.menuItem,
        color: danger ? "#ef4444" : "var(--text-primary)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const S: Record<string, React.CSSProperties> = {
  root: {
    width: 300,
    minWidth: 300,
    height: "100%",
    background: "var(--bg-sidebar)",
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid var(--border-subtle)",
  },
  topbar: {
    height: 52,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: "0 14px",
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    color: "var(--text-secondary)",
  },
  searchWrap: { position: "relative", padding: "0 12px 8px" },
  searchIcon: {
    position: "absolute",
    left: 24,
    top: "50%",
    transform: "translateY(-60%)",
    color: "var(--text-placeholder)",
    pointerEvents: "none",
  },
  search: {
    width: "100%",
    height: 34,
    borderRadius: 9,
    border: "1px solid transparent",
    background: "var(--bg-input)",
    padding: "0 10px 0 30px",
    fontSize: 13.5,
    outline: "none",
  },
  list: { flex: 1, overflowY: "auto", padding: "4px 8px" },
  item: {
    width: "100%",
    display: "flex",
    gap: 11,
    alignItems: "center",
    padding: "9px 10px",
    borderRadius: 11,
    textAlign: "left",
    marginBottom: 1,
  },
  itemActive: { background: "var(--bg-active)" },
  groupAvatar: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    background: "var(--bg-active)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  statusDot: {
    position: "absolute",
    left: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: "50%",
    border: "2px solid var(--bg-sidebar)",
  },
  itemBody: { flex: 1, minWidth: 0 },
  itemTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  itemName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  itemTime: { fontSize: 11.5, color: "var(--text-secondary)", flexShrink: 0 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--accent-blue)",
    flexShrink: 0,
    marginLeft: "auto",
    marginRight: 4,
  },
  itemPreview: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    marginTop: 2,
  },
  // 不要在这里设 opacity：会覆盖 .row-more 的悬停显隐规则
  moreBtn: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 24,
    height: 24,
    borderRadius: 6,
    display: "grid",
    placeItems: "center",
    color: "var(--text-secondary)",
    background: "var(--bg-active)",
  },
  menu: {
    position: "absolute",
    zIndex: 30,
    minWidth: 170,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 10,
    padding: 4,
    boxShadow: "var(--shadow)",
    animation: "fade-up 0.12s ease",
  },
  menuItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    fontSize: 13,
    padding: "8px 10px",
    borderRadius: 7,
  },
  empty: { padding: "24px 14px", fontSize: 12.5, color: "var(--text-placeholder)", lineHeight: 1.5 },
  hiddenRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 18px",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  },
  hiddenCount: { marginLeft: "auto", fontSize: 12 },
  footer: { borderTop: "1px solid var(--border-subtle)", padding: "8px 8px 12px" },
  footerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    fontSize: 13.5,
    color: "var(--text-primary)",
    width: "100%",
  },
};
