import { useEffect, useState } from "react";
import { store, useStore } from "./store";
import { Sidebar, type Selection } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { GroupChatView } from "./components/GroupChatView";
import { ComputerPanel } from "./components/ComputerPanel";
import { CreateBotModal } from "./components/CreateBotModal";
import { CreateGroupModal } from "./components/CreateGroupModal";
import { SettingsModal } from "./components/SettingsModal";
import { EditBotModal } from "./components/EditBotModal";
import { MemoryModal } from "./components/MemoryModal";
import { CommandPalette } from "./components/CommandPalette";
import { BotAvatar } from "./components/BotAvatar";
import { usePrefs, localeTag } from "./prefs";
import { useT } from "./i18n";

export default function App() {
  const bots = useStore((s) => s.bots);
  const groups = useStore((s) => s.groups);
  const working = useStore((s) => s.working);
  const connected = useStore((s) => s.connected);
  const prefsState = usePrefs();
  const tr = useT();
  const [selection, setSelection] = useState<Selection>(null);
  const [panelOpen, setPanelOpen] = useState(prefsState.panelOpenByDefault);
  const [showCreateBot, setShowCreateBot] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editBotId, setEditBotId] = useState<string | null>(null);
  const [memoryBotId, setMemoryBotId] = useState<string | null>(null);
  const [showPalette, setShowPalette] = useState(false);

  useEffect(() => {
    store.init();
  }, []);

  useEffect(() => {
    document.documentElement.lang = localeTag(prefsState.locale);
  }, [prefsState.locale]);

  // Ctrl/Cmd+K 打开命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 告诉 store 当前正在看哪个会话（它的新消息不算未读）
  useEffect(() => {
    store.setActiveBot(selection?.kind === "bot" ? selection.id : null);
    store.setActiveGroup(selection?.kind === "group" ? selection.id : null);
  }, [selection]);

  // 保持选中项有效：没有选中时默认选第一个 Bot；选中项被删除时回退
  useEffect(() => {
    const stillExists =
      selection?.kind === "bot"
        ? bots.some((b) => b.id === selection.id)
        : selection?.kind === "group"
          ? groups.some((g) => g.id === selection.id)
          : false;
    if (!stillExists) {
      setSelection(bots.length > 0 ? { kind: "bot", id: bots[0].id } : null);
    }
  }, [bots, groups, selection]);

  const activeBot =
    selection?.kind === "bot" ? (bots.find((b) => b.id === selection.id) ?? null) : null;
  const activeGroup =
    selection?.kind === "group" ? (groups.find((g) => g.id === selection.id) ?? null) : null;

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <Sidebar
        bots={bots}
        groups={groups}
        working={working}
        selection={selection}
        onSelect={setSelection}
        onNewBot={() => setShowCreateBot(true)}
        onNewGroup={() => setShowCreateGroup(true)}
        onOpenSettings={() => setShowSettings(true)}
        onEditBot={(b) => setEditBotId(b.id)}
        onOpenMemory={(b) => setMemoryBotId(b.id)}
      />

      {activeBot ? (
        <ChatView
          bot={activeBot}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((v) => !v)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenAgentSettings={() => setEditBotId(activeBot.id)}
        />
      ) : activeGroup ? (
        <GroupChatView
          group={activeGroup}
          panelOpen={panelOpen}
          onTogglePanel={() => setPanelOpen((v) => !v)}
        />
      ) : (
        <EmptyState onNew={() => setShowCreateBot(true)} />
      )}

      {(activeBot || activeGroup) && panelOpen && (
        <ComputerPanel bot={activeBot} onClose={() => setPanelOpen(false)} />
      )}

      {showCreateBot && (
        <CreateBotModal
          onClose={() => setShowCreateBot(false)}
          onCreated={(id) => {
            setShowCreateBot(false);
            setSelection({ kind: "bot", id });
          }}
          onOpenSettings={() => {
            setShowCreateBot(false);
            setShowSettings(true);
          }}
        />
      )}

      {showCreateGroup && (
        <CreateGroupModal
          bots={bots}
          onClose={() => setShowCreateGroup(false)}
          onCreated={(id) => {
            setShowCreateGroup(false);
            setSelection({ kind: "group", id });
          }}
        />
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {editBotId && bots.find((b) => b.id === editBotId) && (
        <EditBotModal bot={bots.find((b) => b.id === editBotId)!} onClose={() => setEditBotId(null)} />
      )}

      {memoryBotId && bots.find((b) => b.id === memoryBotId) && (
        <MemoryModal bot={bots.find((b) => b.id === memoryBotId)!} onClose={() => setMemoryBotId(null)} />
      )}

      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          onSelect={setSelection}
          onNewBot={() => setShowCreateBot(true)}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      {!connected && <div style={offline}>{tr("app.reconnecting")}</div>}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const tr = useT();
  return (
    <div style={empty}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
        <BotAvatar color="#0a0a0a" size={40} mono />
        <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em" }}>
          {tr("app.meetPibot")}
        </span>
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 24 }}>
        {tr("app.tagline")}
      </div>
      <button style={cta} onClick={onNew}>
        {tr("app.createFirst")}
      </button>
    </div>
  );
}

const empty: React.CSSProperties = {
  flex: 1,
  height: "100%",
  background: "var(--bg-main)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
};
const cta: React.CSSProperties = {
  background: "#fff",
  color: "#000",
  fontWeight: 600,
  fontSize: 14,
  padding: "11px 22px",
  borderRadius: 22,
};
const offline: React.CSSProperties = {
  position: "fixed",
  bottom: 16,
  left: "50%",
  transform: "translateX(-50%)",
  background: "var(--bg-active)",
  color: "var(--text-secondary)",
  fontSize: 12.5,
  padding: "6px 14px",
  borderRadius: 20,
  zIndex: 60,
};
