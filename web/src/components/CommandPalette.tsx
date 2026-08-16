import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "../types";
import { api } from "../api";
import { useStore } from "../store";
import { BotAvatar } from "./BotAvatar";
import { GroupCluster, resolveGroupMembers } from "./GroupCluster";
import { SearchIcon, GearIcon, PlusIcon } from "./icons";
import type { Selection } from "./Sidebar";
import { useT } from "../i18n";

interface Props {
  onClose: () => void;
  onSelect: (sel: Selection) => void;
  onNewBot: () => void;
  onOpenSettings: () => void;
}

interface Item {
  key: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  run: () => void;
}

// 命令面板（Ctrl+K）：切 Bot/群、全文搜消息、快捷动作
export function CommandPalette({ onClose, onSelect, onNewBot, onOpenSettings }: Props) {
  const bots = useStore((s) => s.bots);
  const groups = useStore((s) => s.groups);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const tr = useT();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 消息全文搜索（防抖 200ms）
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api.search(q).then((r) => setHits(r.messages)).catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => s.toLowerCase().includes(q);
    const list: Item[] = [];

    for (const b of bots.filter((b) => !q || match(b.name))) {
      list.push({
        key: `bot-${b.id}`,
        label: b.name,
        sub: b.role || tr("palette.bot"),
        icon: <BotAvatar id={b.id} color={b.avatar_color} size={22} />,
        run: () => {
          onSelect({ kind: "bot", id: b.id });
          onClose();
        },
      });
    }
    for (const g of groups.filter((g) => !q || match(g.name))) {
      list.push({
        key: `group-${g.id}`,
        label: g.name,
        sub: tr("palette.group"),
        icon: <GroupCluster members={resolveGroupMembers(g, bots)} size={22} />,
        run: () => {
          onSelect({ kind: "group", id: g.id });
          onClose();
        },
      });
    }
    if (!q || match(tr("palette.newBot")) || match(tr("sidebar.newBot"))) {
      list.push({
        key: "act-new",
        label: tr("palette.newBot"),
        sub: tr("palette.action"),
        icon: <PlusIcon size={16} />,
        run: () => {
          onClose();
          onNewBot();
        },
      });
    }
    if (!q || match(tr("palette.settings")) || match(tr("settings.title")) || match(tr("settings.models"))) {
      list.push({
        key: "act-settings",
        label: tr("palette.settings"),
        sub: tr("palette.action"),
        icon: <GearIcon size={16} />,
        run: () => {
          onClose();
          onOpenSettings();
        },
      });
    }
    for (const h of hits) {
      list.push({
        key: `msg-${h.id}`,
        label: h.content,
        sub: tr("palette.message", { name: h.bot_name }),
        icon: <SearchIcon size={14} />,
        run: () => {
          onSelect({ kind: "bot", id: h.bot_id });
          onClose();
        },
      });
    }
    return list.slice(0, 12);
  }, [query, bots, groups, hits, onClose, onNewBot, onOpenSettings, onSelect, tr]);

  useEffect(() => {
    setSel(0);
  }, [query, hits.length]);

  return (
    <div style={backdrop} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={inputRow}>
          <SearchIcon size={15} color="var(--text-placeholder)" />
          <input
            ref={inputRef}
            style={input}
            placeholder={tr("palette.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((v) => (v + 1) % Math.max(items.length, 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((v) => (v - 1 + items.length) % Math.max(items.length, 1));
              }
              if (e.key === "Enter" && items[sel]) items[sel].run();
            }}
          />
          <span style={escHint}>esc</span>
        </div>
        <div style={list}>
          {items.map((it, i) => (
            <button
              key={it.key}
              style={{ ...row, background: i === sel ? "var(--bg-active)" : "transparent" }}
              onMouseEnter={() => setSel(i)}
              onClick={it.run}
            >
              <span style={rowIcon}>{it.icon}</span>
              <span style={rowLabel}>{it.label}</span>
              {it.sub && <span style={rowSub}>{it.sub}</span>}
            </button>
          ))}
          {items.length === 0 && <div style={emptyRow}>{tr("palette.noResults", { query })}</div>}
        </div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--overlay)",
  display: "flex",
  justifyContent: "center",
  paddingTop: "16vh",
  zIndex: 55,
  backdropFilter: "blur(2px)",
};
const panel: React.CSSProperties = {
  width: 560,
  maxWidth: "92vw",
  maxHeight: "56vh",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-sidebar)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 14,
  overflow: "hidden",
  boxShadow: "var(--shadow)",
  animation: "fade-up 0.15s ease",
  alignSelf: "flex-start",
};
const inputRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "13px 16px",
  borderBottom: "1px solid var(--border-subtle)",
};
const input: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  fontSize: 14.5,
};
const escHint: React.CSSProperties = {
  fontSize: 10.5,
  color: "var(--text-placeholder)",
  background: "var(--bg-input)",
  padding: "2px 6px",
  borderRadius: 5,
};
const list: React.CSSProperties = { overflowY: "auto", padding: 6 };
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  width: "100%",
  textAlign: "left",
  padding: "9px 10px",
  borderRadius: 9,
};
const rowIcon: React.CSSProperties = {
  width: 24,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
  flexShrink: 0,
};
const rowLabel: React.CSSProperties = {
  fontSize: 13.5,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};
const rowSub: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: 11.5,
  color: "var(--text-placeholder)",
  flexShrink: 0,
};
const emptyRow: React.CSSProperties = {
  padding: "22px 0",
  textAlign: "center",
  fontSize: 12.5,
  color: "var(--text-placeholder)",
};
