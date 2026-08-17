import { useSyncExternalStore } from "react";
import type {
  Attachment,
  ApprovalRule,
  Bot,
  Computer,
  Group,
  GroupMessage,
  GroupModeratorInput,
  McpServer,
  Message,
  ModelProfile,
  Skill,
} from "./types";
import { api } from "./api";
import { prefs } from "./prefs";
import { t } from "./i18n";

interface State {
  bots: Bot[];
  messages: Record<string, Message[]>;
  stream: Record<string, string>; // botId -> partial streaming assistant text
  working: Record<string, boolean>;
  workingChannel: Record<string, string>;
  connected: boolean;
  groups: Group[];
  groupMessages: Record<string, GroupMessage[]>;
  groupMembers: Record<string, Bot[]>;
  profiles: ModelProfile[];
  computer: Computer | null;
  skills: Skill[];
  mcpServers: McpServer[];
  approvalRules: ApprovalRule[];
  unread: Record<string, boolean>; // botId -> 有未读活动（打开会话即清除）
  groupUnread: Record<string, boolean>;
  groupRunning: Record<string, boolean>;
  groupRunBots: Record<string, string[]>;
  groupAssigning: Record<string, boolean>;
  groupWaiting: Record<string, boolean>;
  botSkillEpoch: number;
}

type Listener = () => void;

class Store {
  private state: State = {
    bots: [],
    messages: {},
    stream: {},
    working: {},
    workingChannel: {},
    connected: false,
    groups: [],
    groupMessages: {},
    groupMembers: {},
    profiles: [],
    computer: null,
    skills: [],
    mcpServers: [],
    approvalRules: [],
    unread: {},
    groupUnread: {},
    groupRunning: {},
    groupRunBots: {},
    groupAssigning: {},
    groupWaiting: {},
    botSkillEpoch: 0,
  };
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private started = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedBots = new Set<string>();
  private loadedGroups = new Set<string>();
  /** 当前正在看的 Bot / 群（App 同步过来），它的新消息不算未读 */
  activeBotId: string | null = null;
  activeGroupId: string | null = null;

  getState = () => this.state;
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  async init() {
    if (this.started) return;
    this.started = true;
    const [{ bots }, { groups }, { profiles }, { skills }, { servers }, { rules }] =
      await Promise.all([
      api.listBots(),
      api.listGroups(),
      api.listProfiles(),
      api.listSkills(),
      api.listMcpServers(),
      api.listApprovalRules(),
    ]);
    this.set({ bots, groups, profiles, skills, mcpServers: servers, approvalRules: rules });
    this.connect();
  }

  async refreshProfiles() {
    const { profiles } = await api.listProfiles();
    this.set({ profiles });
  }

  async refreshSkills() {
    const { skills } = await api.listSkills();
    this.set({ skills, botSkillEpoch: this.state.botSkillEpoch + 1 });
  }

  notifyBotSkillsChanged() {
    this.set({ botSkillEpoch: this.state.botSkillEpoch + 1 });
  }

  async refreshMcpServers() {
    const { servers } = await api.listMcpServers();
    this.set({ mcpServers: servers });
  }

  async refreshApprovalRules() {
    const { rules } = await api.listApprovalRules();
    this.set({ approvalRules: rules });
  }

  /** App 在切换会话时调用：同步活跃 Bot 并清掉它的未读 */
  setActiveBot(botId: string | null) {
    this.activeBotId = botId;
    if (botId && this.state.unread[botId]) this.markRead(botId, true);
  }

  setActiveGroup(groupId: string | null) {
    this.activeGroupId = groupId;
    if (groupId && this.state.groupUnread[groupId]) {
      const groupUnread = { ...this.state.groupUnread };
      delete groupUnread[groupId];
      this.set({ groupUnread });
    }
  }

  markRead(botId: string, read: boolean) {
    this.set({ unread: { ...this.state.unread, [botId]: !read } });
  }

  private connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const prev = this.ws;
      prev.onclose = null;
      prev.onmessage = null;
      prev.onopen = null;
      if (prev.readyState === WebSocket.OPEN || prev.readyState === WebSocket.CONNECTING) prev.close();
      this.ws = null;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => this.set({ connected: true });
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.set({ connected: false });
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data));
  }

  private handle(msg: any) {
    switch (msg.type) {
      case "bots":
        this.set({ bots: msg.bots });
        break;
      case "bot_update": {
        const others = this.state.bots.filter((b) => b.id !== msg.bot.id);
        const groupMembers = { ...this.state.groupMembers };
        for (const [gid, members] of Object.entries(groupMembers)) {
          if (!members.some((m) => m.id === msg.bot.id)) continue;
          groupMembers[gid] = members.map((m) => (m.id === msg.bot.id ? { ...m, ...msg.bot } : m));
        }
        this.set({ bots: [...others, msg.bot], groupMembers });
        break;
      }
      case "bot_deleted": {
        const id = String(msg.id ?? "");
        const groupMembers = { ...this.state.groupMembers };
        for (const [gid, members] of Object.entries(groupMembers)) {
          groupMembers[gid] = members.filter((m) => m.id !== id);
        }
        this.set({
          bots: this.state.bots.filter((b) => b.id !== id),
          groupMembers,
          groups: this.state.groups.map((g) => ({
            ...g,
            bot_ids: (g.bot_ids ?? []).filter((botId) => botId !== id),
          })),
        });
        break;
      }
      case "computer":
        this.set({ computer: msg.computer });
        break;
      case "message": {
        const bid = msg.message.bot_id;
        const list = this.state.messages[bid] ?? [];
        const patch: Partial<State> = {};
        if (!list.find((m) => m.id === msg.message.id)) {
          patch.messages = { ...this.state.messages, [bid]: [...list, msg.message] };
        }
        // 未读：不在看的会话来了 Bot 消息（用户自己发的不算）
        if (bid !== this.activeBotId && msg.message.role !== "user") {
          patch.unread = { ...this.state.unread, [bid]: true };
        }
        this.set(patch);
        break;
      }
      case "skills_changed":
        this.refreshSkills();
        break;
      case "bot_settings_changed":
        this.notifyBotSkillsChanged();
        break;
      case "mcp_changed":
        this.refreshMcpServers();
        break;
      case "approval_rules_changed":
        this.refreshApprovalRules();
        break;
      case "message_update_row": {
        const bid = msg.message.bot_id;
        const list = (this.state.messages[bid] ?? []).map((m) =>
          m.id === msg.message.id ? msg.message : m,
        );
        this.set({ messages: { ...this.state.messages, [bid]: list } });
        break;
      }
      case "group_run_state": {
        const groupRunning: Record<string, boolean> = {};
        const groupRunBots: Record<string, string[]> = { ...this.state.groupRunBots };
        for (const row of msg.groups ?? []) {
          groupRunning[row.id] = true;
          if (row.botIds) groupRunBots[row.id] = row.botIds;
        }
        this.set({ groupRunning, groupRunBots });
        break;
      }
      case "group_run": {
        const groupRunning = { ...this.state.groupRunning, [msg.groupId]: !!msg.running };
        const groupRunBots = { ...this.state.groupRunBots };
        const groupAssigning = { ...this.state.groupAssigning };
        const groupWaiting = { ...this.state.groupWaiting };
        if (msg.running && Array.isArray(msg.botIds)) groupRunBots[msg.groupId] = msg.botIds;
        if (msg.running) delete groupWaiting[msg.groupId];
        if (!msg.running) {
          delete groupRunBots[msg.groupId];
          delete groupAssigning[msg.groupId];
        }
        this.set({ groupRunning, groupRunBots, groupAssigning, groupWaiting });
        break;
      }
      case "group_moderator_state": {
        const groupAssigning: Record<string, boolean> = {};
        const ids = Array.isArray(msg.groupIds) ? (msg.groupIds as string[]) : [];
        for (const id of ids) groupAssigning[id] = true;
        this.set({ groupAssigning });
        break;
      }
      case "group_moderator": {
        const groupId = String(msg.groupId ?? "");
        if (!groupId) break;
        const groupAssigning = { ...this.state.groupAssigning, [groupId]: !!msg.assigning };
        if (!msg.assigning) delete groupAssigning[groupId];
        this.set({ groupAssigning });
        break;
      }
      case "group_wait_state": {
        const groupWaiting: Record<string, boolean> = {};
        const ids = Array.isArray(msg.groupIds) ? (msg.groupIds as string[]) : [];
        for (const id of ids) groupWaiting[id] = true;
        this.set({ groupWaiting });
        break;
      }
      case "group_wait": {
        const groupId = String(msg.groupId ?? "");
        if (!groupId) break;
        const groupWaiting = { ...this.state.groupWaiting, [groupId]: !!msg.waiting };
        if (!msg.waiting) delete groupWaiting[groupId];
        this.set({ groupWaiting });
        break;
      }
      case "group_update": {
        const group = msg.group as Group | undefined;
        if (!group?.id) break;
        this.patchGroup(group, Array.isArray(msg.members) ? (msg.members as Bot[]) : undefined);
        break;
      }
      case "working_state": {
        const working: Record<string, boolean> = {};
        const workingChannel: Record<string, string> = {};
        for (const row of msg.bots ?? []) {
          working[row.botId] = !!row.working;
          if (row.channel) workingChannel[row.botId] = row.channel;
        }
        this.set({ working, workingChannel });
        break;
      }
      case "stream":
        this.set({
          stream: {
            ...this.state.stream,
            [msg.botId]: (this.state.stream[msg.botId] ?? "") + msg.delta,
          },
          workingChannel: msg.channel
            ? { ...this.state.workingChannel, [msg.botId]: msg.channel }
            : this.state.workingChannel,
        });
        break;
      case "stream_end": {
        const s = { ...this.state.stream };
        delete s[msg.botId];
        this.set({ stream: s });
        break;
      }
      case "working": {
        const was = this.state.working[msg.botId];
        const channel = typeof msg.channel === "string" ? msg.channel : this.state.workingChannel[msg.botId] ?? "";
        this.set({
          working: { ...this.state.working, [msg.botId]: msg.working },
          workingChannel: { ...this.state.workingChannel, [msg.botId]: channel },
        });
        if (was && !msg.working) {
          const groupId = channel.startsWith("group:") ? channel.slice("group:".length) : "";
          const name = groupId
            ? (this.state.groups.find((g) => g.id === groupId)?.name ?? "Group")
            : (this.state.bots.find((b) => b.id === msg.botId)?.name ?? "Bot");
          this.notify(msg.botId, t("notify.finished", { name }), t("notify.finishedBody"));
        }
        break;
      }
      case "approval":
        this.notify(
          msg.botId,
          t("notify.approval", { name: this.state.bots.find((b) => b.id === msg.botId)?.name ?? "Bot" }),
          msg.title || msg.message || "",
        );
        break;
      case "messages_cleared":
        this.set({ messages: { ...this.state.messages, [msg.botId]: [] } });
        break;
      case "group_deleted": {
        this.loadedGroups.delete(msg.id);
        const groupUnread = { ...this.state.groupUnread };
        delete groupUnread[msg.id];
        const groupRunning = { ...this.state.groupRunning };
        delete groupRunning[msg.id];
        const groupRunBots = { ...this.state.groupRunBots };
        delete groupRunBots[msg.id];
        const groupAssigning = { ...this.state.groupAssigning };
        delete groupAssigning[msg.id];
        const groupWaiting = { ...this.state.groupWaiting };
        delete groupWaiting[msg.id];
        this.set({
          groups: this.state.groups.filter((g) => g.id !== msg.id),
          groupUnread,
          groupRunning,
          groupRunBots,
          groupAssigning,
          groupWaiting,
        });
        break;
      }
      case "group_message": {
        const list = this.state.groupMessages[msg.groupId] ?? [];
        if (list.find((m) => m.id === msg.message.id)) break;
        const kind = String(msg.message.kind ?? "text");
        const preview =
          kind === "tool"
            ? "[tool]"
            : String(msg.message.content ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 80);
        const patch: Partial<State> = {
          groupMessages: {
            ...this.state.groupMessages,
            [msg.groupId]: [...list, msg.message],
          },
          groups: this.state.groups.map((g) =>
            g.id === msg.groupId
              ? { ...g, last_message: preview, last_activity: msg.message.created_at }
              : g,
          ),
        };
        if (msg.groupId !== this.activeGroupId && msg.message.bot_id) {
          patch.groupUnread = { ...this.state.groupUnread, [msg.groupId]: true };
        }
        this.set(patch);
        break;
      }
    }
  }

  async loadMessages(botId: string) {
    if (this.loadedBots.has(botId)) return;
    this.loadedBots.add(botId);
    const { messages } = await api.messages(botId);
    this.set({ messages: { ...this.state.messages, [botId]: messages } });
  }

  async loadGroup(groupId: string) {
    const { messages, members } = await api.groupMessages(groupId);
    const prev = this.state.groupMessages[groupId] ?? [];
    const byId = new Map(prev.map((row) => [row.id, row]));
    for (const row of messages) byId.set(row.id, row);
    const merged = [...byId.values()].sort((a, b) => a.id - b.id);
    this.loadedGroups.add(groupId);
    this.set({
      groupMessages: { ...this.state.groupMessages, [groupId]: merged },
      groupMembers: { ...this.state.groupMembers, [groupId]: members },
    });
  }

  async refreshGroups() {
    const { groups } = await api.listGroups();
    this.set({ groups });
  }

  private patchGroup(group: Group, members?: Bot[]) {
    const groups = this.state.groups.some((g) => g.id === group.id)
      ? this.state.groups.map((g) =>
          g.id === group.id
            ? {
                ...g,
                ...group,
                bot_ids: group.bot_ids ?? g.bot_ids,
                description: group.description ?? g.description ?? "",
              }
            : g,
        )
      : [...this.state.groups, group];
    if (members) {
      this.set({ groups, groupMembers: { ...this.state.groupMembers, [group.id]: members } });
      return;
    }
    this.set({ groups });
  }

  async updateGroup(groupId: string, input: { name?: string; description?: string; botIds?: string[] }) {
    const { group, members } = await api.updateGroup(groupId, input);
    this.patchGroup(group, members);
    return group;
  }

  async updateGroupModerator(groupId: string, input: GroupModeratorInput) {
    const { group } = await api.updateGroupModerator(groupId, input);
    this.patchGroup(group);
    return group;
  }

  send(msg: Record<string, unknown>) {
    this.ws?.send(JSON.stringify(msg));
  }

  prompt(botId: string, text: string, attachments?: Attachment[]) {
    this.send({ type: "prompt", botId, text, attachments });
  }

  // 桌面通知：仅当用户开了偏好、授权过、且当前没在看页面时才打扰
  private notify(_botId: string, title: string, body: string) {
    if (!prefs.get().notifications) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!document.hidden) return;
    try {
      new Notification(title, { body: body.slice(0, 120) });
    } catch {
      // 某些环境（如无窗口服务）不允许构造通知
    }
  }

  respondApproval(botId: string, requestId: string, value: string | boolean) {
    this.send({ type: "approval_response", botId, requestId, value });
  }

  abort(botId: string) {
    this.send({ type: "abort", botId, channel: "main" });
  }

  abortGroup(groupId: string) {
    this.send({ type: "abort_group", groupId });
  }

  groupPrompt(groupId: string, text: string, attachments?: Attachment[]) {
    this.send({ type: "group_prompt", groupId, text, attachments });
  }
}

export const store = new Store();

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
