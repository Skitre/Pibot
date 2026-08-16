import { randomUUID } from "node:crypto";
import db, { BotRow, MessageRow } from "./db.js";
import { AppConfig } from "./config.js";
import { DockerManager } from "./docker-manager.js";
import { RpcBridge } from "./rpc-bridge.js";
import { ModelProfileStore } from "./model-profiles.js";
import { SkillStore } from "./skills.js";
import { McpServerStore } from "./mcp-servers.js";
import { ApprovalRuleStore } from "./approval-rules.js";
import type { BotSkillRow } from "./skills.js";
import { WORK_TOOLS, addMemoryNote, addWorkSummary, isMemoryKind, normalizeAgentsMd } from "./memory.js";
import {
  GROUP_MEMBER_TIMEOUT_MS,
  isPassContent,
  isSendMessageTool,
  parseGroupPost,
  takeGroupPosts,
  type GroupPost,
} from "./group-chat.js";
import {
  WORKSPACE,
  fileBasename,
  guessMime,
  resolveWorkspacePath,
  toolWritePath,
} from "./workspace-files.js";

type Broadcast = (msg: Record<string, unknown>) => void;

const AVATAR_COLORS = [
  "#936439",
  "#FF263C",
  "#FF6700",
  "#FF9800",
  "#00C972",
  "#00BCA6",
  "#1084FE",
  "#9159FE",
  "#FF309B",
  "#777777",
];
const AVATAR_SHAPES = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"] as const;

export type BotLook = {
  avatar_color?: string;
  avatar_shape?: string | null;
};

export class BotLookError extends Error {
  statusCode = 400;
}

export function parseBotLook(input: { avatar_color?: unknown; avatar_shape?: unknown }): BotLook {
  const look: BotLook = {};
  if (input.avatar_color !== undefined) {
    if (typeof input.avatar_color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(input.avatar_color)) {
      throw new BotLookError("invalid avatar_color");
    }
    look.avatar_color = input.avatar_color;
  }
  if (input.avatar_shape !== undefined) {
    if (input.avatar_shape === null || input.avatar_shape === "") {
      look.avatar_shape = null;
    } else if (
      typeof input.avatar_shape === "string" &&
      (AVATAR_SHAPES as readonly string[]).includes(input.avatar_shape)
    ) {
      look.avatar_shape = input.avatar_shape;
    } else {
      throw new BotLookError("invalid avatar_shape");
    }
  }
  return look;
}

// 共享电脑架构（对齐官方）：整个账户一台容器，Bot 的 pi 进程都在里面。
// 每个 Bot 的私有目录（记忆/设置）在 /config/bots/<id>/，共享工作区在 /config/workspace。
const memoryPath = (botId: string) => `/config/bots/${botId}/AGENTS.md`;
const FILE_CARD_CAP = 12;

export interface Attachment {
  name: string;
  path: string;
  size: number;
  mime: string;
}

export interface ComputerState {
  containerId: string | null;
  status: "offline" | "starting" | "online";
  vncPort: number;
}

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingOverride = (typeof THINKING_LEVELS)[number];

export interface BotSettings {
  bot: BotRow;
  modelProfileId: string | null;
  thinkingOverride: ThinkingOverride | null;
  skills: BotSkillRow[];
}

export interface BotSettingsInput {
  modelProfileId: string | null;
  thinkingOverride: ThinkingOverride | null;
  skillIds: string[];
}

export class BotSettingsError extends Error {
  readonly statusCode: 400 | 404;
  constructor(statusCode: 400 | 404, message: string) {
    super(message);
    this.name = "BotSettingsError";
    this.statusCode = statusCode;
  }
}

function isThinkingOverride(value: unknown): value is ThinkingOverride {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

interface LiveBot {
  streaming: boolean;
  streamText: string;
  channel: string;
  queue: Array<{ job: PromptJob; resolve: (ok: boolean) => void }>;
  switching: Promise<boolean> | null;
  turnWork: boolean;
  lastAssistantText: string;
  groupSends: GroupPost[];
  usedAnyTool: boolean;
  groupDone: ((posts: GroupPost[]) => void) | null;
  groupStarted: boolean;
  idleWaiters: Array<() => void>;
  pendingWrites: Map<string, string>;
  producedFiles: string[];
}

interface PromptJob {
  text: string;
  author: string;
  attachments?: Attachment[];
  persist: boolean;
  channel: string;
  sessionName?: string;
}

function newLive(): LiveBot {
  return {
    streaming: false,
    streamText: "",
    channel: "unknown",
    queue: [],
    switching: null,
    turnWork: false,
    lastAssistantText: "",
    groupSends: [],
    usedAnyTool: false,
    groupDone: null,
    groupStarted: false,
    idleWaiters: [],
    pendingWrites: new Map(),
    producedFiles: [],
  };
}

export class BotManager {
  private docker: DockerManager;
  private bridge: RpcBridge | null = null;
  private computer: ComputerState;
  private ensuring: Promise<void> | null = null;
  private restarting: Promise<void> | null = null;
  private live = new Map<string, LiveBot>();
  private assistantListeners = new Set<(botId: string, text: string) => void>();
  private teammateHandoffListeners = new Set<
    (sender: BotRow, target: BotRow, message: string) => boolean
  >();
  private groupTurns = new Set<string>();
  private groupDeliverListeners = new Set<(botId: string, channel: string) => void>();
  private groupPersistListeners = new Set<
    (botId: string, channel: string, kind: string, content: string, meta?: unknown) => void
  >();
  private pendingRpc = new Map<
    string,
    { botId: string; resolve: (value: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private pendingMcpTests = new Map<
    string,
    { serverId: string; resolve: (value: any) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private pendingMcpApprovals = new Map<string, { serverId: string; toolName: string }>();

  constructor(
    private cfg: AppConfig,
    private broadcast: Broadcast,
    private profiles: ModelProfileStore,
    private skills: SkillStore,
    private mcpServers: McpServerStore,
    private approvalRules: ApprovalRuleStore,
  ) {
    this.docker = new DockerManager(cfg);
    this.computer = { containerId: null, status: "offline", vncPort: cfg.docker.vncBasePort };
  }

  onAssistantMessage(fn: (botId: string, text: string) => void) {
    this.assistantListeners.add(fn);
  }

  onTeammateHandoff(fn: (sender: BotRow, target: BotRow, message: string) => boolean) {
    this.teammateHandoffListeners.add(fn);
  }

  beginGroupTurn(botId: string) {
    this.groupTurns.add(botId);
  }

  endGroupTurn(botId: string) {
    this.groupTurns.delete(botId);
  }

  isGroupTurn(botId: string) {
    return this.groupTurns.has(botId);
  }

  currentChannel(botId: string) {
    return this.live.get(botId)?.channel ?? "unknown";
  }

  workingSnapshot() {
    const rows: { botId: string; working: boolean; channel: string }[] = [];
    for (const [botId, state] of this.live) {
      if (state.streaming) rows.push({ botId, working: true, channel: state.channel });
    }
    return rows;
  }

  abortGroup(groupId: string) {
    const channel = `group:${groupId}`;
    for (const bot of this.listBots()) {
      this.abort(bot.id, channel);
    }
  }

  private dropQueueForChannel(botId: string, channel: string) {
    const state = this.live.get(botId);
    if (!state) return;
    const keep: typeof state.queue = [];
    for (const item of state.queue) {
      if (item.job.channel === channel) item.resolve(false);
      else keep.push(item);
    }
    state.queue = keep;
  }

  onGroupDeliver(fn: (botId: string, channel: string) => void) {
    this.groupDeliverListeners.add(fn);
  }

  onGroupPersist(fn: (botId: string, channel: string, kind: string, content: string, meta?: unknown) => void) {
    this.groupPersistListeners.add(fn);
  }

  private emitGroupPersist(botId: string, kind: string, content: string, meta?: unknown) {
    const channel = this.live.get(botId)?.channel ?? "";
    if (!channel.startsWith("group:")) return;
    for (const fn of this.groupPersistListeners) fn(botId, channel, kind, content, meta);
  }

  hasSession(botId: string, channel: string) {
    return !!this.getSessionPath(botId, channel);
  }

  dropSessionsForGroup(groupId: string) {
    db.prepare("DELETE FROM bot_sessions WHERE channel = ?").run(`group:${groupId}`);
  }

  private getSessionPath(botId: string, channel: string): string | undefined {
    const row = db
      .prepare("SELECT session_path FROM bot_sessions WHERE bot_id = ? AND channel = ?")
      .get(botId, channel) as { session_path: string } | undefined;
    return row?.session_path;
  }

  private storeSessionPath(botId: string, channel: string, path: string) {
    db.prepare(
      "INSERT INTO bot_sessions (bot_id, channel, session_path) VALUES (?, ?, ?) ON CONFLICT(bot_id, channel) DO UPDATE SET session_path = excluded.session_path",
    ).run(botId, channel, path);
  }

  private channelForPath(botId: string, path: string): string | undefined {
    const row = db
      .prepare("SELECT channel FROM bot_sessions WHERE bot_id = ? AND session_path = ?")
      .get(botId, path) as { channel: string } | undefined;
    return row?.channel;
  }

  private inGroupSession(botId: string) {
    return (this.live.get(botId)?.channel ?? "").startsWith("group:");
  }

  private rpc(botId: string, data: Record<string, unknown>, timeoutMs = 20_000): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(`rpc ${String(data.type)} timed out`));
      }, timeoutMs);
      this.pendingRpc.set(id, { botId, resolve, reject, timer });
      this.sendToBot(botId, { ...data, id });
    });
  }

  private rejectPendingRpc(botId: string) {
    for (const [id, pending] of this.pendingRpc) {
      if (pending.botId !== botId) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error("bot stopped"));
      this.pendingRpc.delete(id);
    }
  }

  private async ensureChannel(botId: string, channel: string, sessionName?: string): Promise<boolean> {
    const state = this.live.get(botId);
    if (!state || !this.bridge?.connected) return false;
    if (state.switching) {
      await state.switching.catch(() => false);
    }
    if (state.channel === channel && this.getSessionPath(botId, channel)) return true;
    const run = this.switchChannel(botId, channel, sessionName);
    state.switching = run;
    try {
      return await run;
    } finally {
      if (state.switching === run) state.switching = null;
    }
  }

  private async switchChannel(botId: string, channel: string, sessionName?: string): Promise<boolean> {
    const state = this.live.get(botId);
    if (!state) return false;
    try {
      const current = await this.rpc(botId, { type: "get_state" });
      const currentPath = current?.data?.sessionFile as string | undefined;
      if (currentPath) {
        const known = this.channelForPath(botId, currentPath);
        if (known) state.channel = known;
        else if (!this.getSessionPath(botId, "main")) {
          this.storeSessionPath(botId, "main", currentPath);
          state.channel = "main";
        }
      }
      if (state.channel === channel && this.getSessionPath(botId, channel)) return true;

      if (channel === "main") {
        const mainPath = this.getSessionPath(botId, "main");
        if (!mainPath) return true;
        const res = await this.rpc(botId, { type: "switch_session", sessionPath: mainPath });
        if (!res?.success || res.data?.cancelled) return false;
        state.channel = "main";
        return true;
      }

      let path = this.getSessionPath(botId, channel);
      if (!path) {
        if (!this.getSessionPath(botId, "main") && currentPath) {
          this.storeSessionPath(botId, "main", currentPath);
        }
        const created = await this.rpc(botId, { type: "new_session" });
        if (!created?.success || created.data?.cancelled) return false;
        const next = await this.rpc(botId, { type: "get_state" });
        path = next?.data?.sessionFile as string | undefined;
        if (!path) return false;
        this.storeSessionPath(botId, channel, path);
        if (sessionName) {
          await this.rpc(botId, { type: "set_session_name", name: sessionName }).catch(() => undefined);
        }
        state.channel = channel;
        return true;
      }

      const res = await this.rpc(botId, { type: "switch_session", sessionPath: path });
      if (!res?.success || res.data?.cancelled) {
        db.prepare("DELETE FROM bot_sessions WHERE bot_id = ? AND channel = ?").run(botId, channel);
        const created = await this.rpc(botId, { type: "new_session" });
        if (!created?.success || created.data?.cancelled) return false;
        const next = await this.rpc(botId, { type: "get_state" });
        const fresh = next?.data?.sessionFile as string | undefined;
        if (!fresh) return false;
        this.storeSessionPath(botId, channel, fresh);
        state.channel = channel;
        return true;
      }
      state.channel = channel;
      return true;
    } catch (err) {
      console.warn(`[bots] switch ${botId} -> ${channel} failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ---------- 查询 ----------
  listBots(): BotRow[] {
    return db
      .prepare("SELECT * FROM bots ORDER BY pinned DESC, last_activity DESC, created_at DESC")
      .all() as BotRow[];
  }

  getBot(id: string): BotRow | undefined {
    return db.prepare("SELECT * FROM bots WHERE id = ?").get(id) as BotRow | undefined;
  }

  getBotSettings(id: string): BotSettings {
    const bot = this.getBot(id);
    if (!bot) throw new BotSettingsError(404, "bot not found");
    return {
      bot,
      modelProfileId: bot.model_profile_id,
      thinkingOverride: isThinkingOverride(bot.thinking_override) ? bot.thinking_override : null,
      skills: this.skills.listForBot(id),
    };
  }

  updateBotSettings(id: string, input: unknown): BotSettings {
    const bot = this.getBot(id);
    if (!bot) throw new BotSettingsError(404, "bot not found");
    if (!input || typeof input !== "object") {
      throw new BotSettingsError(400, "settings payload is required");
    }
    const body = input as Record<string, unknown>;
    if (!("modelProfileId" in body) || !("thinkingOverride" in body) || !("skillIds" in body)) {
      throw new BotSettingsError(400, "modelProfileId, thinkingOverride and skillIds are required");
    }
    if (body.modelProfileId !== null && typeof body.modelProfileId !== "string") {
      throw new BotSettingsError(400, "modelProfileId must be a string or null");
    }
    if (body.thinkingOverride !== null && !isThinkingOverride(body.thinkingOverride)) {
      throw new BotSettingsError(400, "thinkingOverride must be off, minimal, low, medium, high, xhigh, or null");
    }
    if (!Array.isArray(body.skillIds) || body.skillIds.some((item) => typeof item !== "string")) {
      throw new BotSettingsError(400, "skillIds must be an array of strings");
    }
    if (body.modelProfileId !== null && !this.profiles.get(body.modelProfileId)) {
      throw new BotSettingsError(400, "model profile not found");
    }

    db.prepare("UPDATE bots SET model_profile_id = ?, thinking_override = ? WHERE id = ?").run(
      body.modelProfileId,
      body.thinkingOverride,
      id,
    );
    this.skills.setEnabledForBot(id, body.skillIds);
    this.broadcastBot(id);
    this.broadcast({ type: "bot_settings_changed", botId: id });
    this.pushModelConfig(id);
    return this.getBotSettings(id);
  }

  /** 档案默认值 + Bot 思考强度覆盖，只影响当前 Bot 会话 */
  private containerConfigForBot(bot: BotRow) {
    const profile = this.profiles.effectiveFor(bot.model_profile_id);
    if (!profile) return undefined;
    const config = this.profiles.toContainerConfig(profile);
    if (isThinkingOverride(bot.thinking_override)) {
      config.thinking = bot.thinking_override;
    }
    return config;
  }

  getComputer(): ComputerState {
    return this.computer;
  }

  getMessages(botId: string, threadId = "main"): MessageRow[] {
    return db
      .prepare("SELECT * FROM messages WHERE bot_id = ? AND thread_id = ? ORDER BY id ASC")
      .all(botId, threadId) as MessageRow[];
  }

  private saveMessage(
    botId: string,
    role: string,
    content: string,
    kind = "text",
    author = "",
    meta?: unknown,
    threadId = "main",
  ): MessageRow | undefined {
    // 群 session 产生的助手/工具/系统行不写 1:1；用户私聊和审批仍落库
    if (this.inGroupSession(botId) && kind !== "approval" && role !== "user") return undefined;
    const now = Date.now();
    const info = db
      .prepare(
        "INSERT INTO messages (bot_id, thread_id, role, author, content, kind, meta, created_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(botId, threadId, role, author, content, kind, meta ? JSON.stringify(meta) : null, now);
    // 系统消息（错误、通知）和文件名直接展示，工具/审批用简短标签
    const preview = kind === "text" || kind === "system" || kind === "file" ? content : `[${kind}]`;
    db.prepare(
      "UPDATE bots SET last_message = ?, last_activity = ? WHERE id = ?",
    ).run(preview.slice(0, 120), now, botId);
    const row = db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(info.lastInsertRowid) as MessageRow;
    this.broadcast({ type: "message", message: row });
    this.broadcastBot(botId);
    return row;
  }

  private broadcastBot(botId: string) {
    const bot = this.getBot(botId);
    if (bot) this.broadcast({ type: "bot_update", bot });
  }

  private broadcastComputer() {
    this.broadcast({ type: "computer", computer: this.computer });
  }

  private setStatus(botId: string, status: string) {
    db.prepare("UPDATE bots SET status = ? WHERE id = ?").run(status, botId);
    this.broadcastBot(botId);
  }

  private setAttention(botId: string, val: boolean) {
    db.prepare("UPDATE bots SET needs_attention = ? WHERE id = ?").run(val ? 1 : 0, botId);
    this.broadcastBot(botId);
  }

  // ---------- 共享电脑生命周期 ----------

  /** 确保共享电脑容器在跑、桥接已连接。并发调用会合并成一次。 */
  async ensureComputer(): Promise<void> {
    if (this.computer.status === "online" && this.bridge?.connected) return;
    if (this.restarting) return this.restarting;
    if (this.ensuring) return this.ensuring;
    this.ensuring = this.doEnsureComputer().finally(() => {
      this.ensuring = null;
    });
    return this.ensuring;
  }

  /** 重启共享电脑：docker restart 现有容器，不重建、不删卷。 */
  async restartComputer(): Promise<void> {
    if (this.restarting) return this.restarting;
    this.restarting = (async () => {
      if (this.ensuring) await this.ensuring.catch(() => {});
      await this.doRestartComputer();
    })().finally(() => {
      this.restarting = null;
    });
    return this.restarting;
  }

  private attachBridgeIfNeeded(bridgePort: number) {
    if (this.bridge) return;
    const bridge = new RpcBridge(bridgePort);
    this.bridge = bridge;
    bridge.on("open", () => {
      this.computer.status = "online";
      this.broadcastComputer();
      // 先同步账户级 MCP 配置，再启动 Bot；WS 消息顺序保证新进程读取到最新配置。
      this.pushMcpConfig();
      // 电脑一连上，把所有不是用户主动停掉的 Bot 会话拉起来
      for (const bot of this.listBots()) {
        if (bot.status !== "stopped") this.startBotSession(bot.id);
      }
    });
    bridge.on("event", (evt: any) => this.routeEvent(evt));
    bridge.connect();
  }

  private dropAllLive() {
    for (const [botId, state] of this.live) {
      for (const item of state.queue) item.resolve(false);
      state.queue = [];
      this.abandonGroupMemberTurn(state);
      this.rejectPendingRpc(botId);
      if (state.streaming) {
        this.broadcast({ type: "working", botId, working: false, channel: state.channel });
        this.broadcast({ type: "stream_end", botId });
      }
    }
    this.live.clear();
    this.groupTurns.clear();
    this.broadcast({ type: "working_state", bots: [] });
  }

  private async doEnsureComputer(): Promise<void> {
    this.computer.status = "starting";
    this.broadcastComputer();
    try {
      const { containerId, vncPort, bridgePort } = await this.docker.ensureComputer();
      this.computer.containerId = containerId;
      this.computer.vncPort = vncPort;
      this.attachBridgeIfNeeded(bridgePort);
    } catch (err) {
      this.computer.status = "offline";
      this.broadcastComputer();
      throw err;
    }
  }

  private async doRestartComputer(): Promise<void> {
    this.computer.status = "starting";
    this.broadcastComputer();
    this.dropAllLive();
    for (const bot of this.listBots()) {
      if (bot.status !== "stopped") this.setStatus(bot.id, "starting");
    }
    try {
      const { containerId, vncPort, bridgePort } = await this.docker.restartComputer();
      this.computer.containerId = containerId;
      this.computer.vncPort = vncPort;
      this.attachBridgeIfNeeded(bridgePort);
    } catch (err) {
      this.computer.status = "offline";
      this.broadcastComputer();
      for (const bot of this.listBots()) {
        if (bot.status !== "stopped") this.setStatus(bot.id, "error");
      }
      throw err;
    }
  }

  /** 在共享电脑里启动某个 Bot 的 pi 会话 */
  private startBotSession(botId: string) {
    const bot = this.getBot(botId);
    if (!bot || !this.bridge) return;
    const model = this.containerConfigForBot(bot);
    if (!model) {
      this.setStatus(botId, "error");
      return;
    }
    if (!this.live.has(botId)) this.live.set(botId, newLive());
    this.setStatus(botId, "starting");
    this.bridge.send({
      type: "_pibot",
      cmd: "start_bot",
      botId,
      name: bot.name,
      role: bot.role,
      model,
    });
  }

  // ---------- Bot 生命周期 ----------
  async createBot(name: string, role: string, modelProfileId?: string): Promise<BotRow> {
    const id = randomUUID().slice(0, 8);
    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const now = Date.now();
    db.prepare(
      "INSERT INTO bots (id, name, role, avatar_color, status, created_at, last_activity, model_profile_id) VALUES (?,?,?,?,?,?,?,?)",
    ).run(id, name, role, color, "starting", now, now, modelProfileId ?? null);
    this.broadcast({ type: "bot_update", bot: this.getBot(id) });

    const profile = this.profiles.effectiveFor(modelProfileId ?? null);
    if (!profile) {
      this.setStatus(id, "error");
      this.saveMessage(
        id,
        "system",
        "No model configured. Open Settings → Models and add one, then start this bot.",
        "system",
      );
      return this.getBot(id)!;
    }

    try {
      await this.ensureComputer();
      this.startBotSession(id);
    } catch (err) {
      this.setStatus(id, "error");
      this.saveMessage(id, "system", `Failed to start the computer: ${(err as Error).message}`, "system");
    }
    return this.getBot(id)!;
  }

  async startBot(id: string) {
    await this.ensureComputer();
    this.startBotSession(id);
  }

  async stopBot(id: string) {
    this.groupTurns.delete(id);
    this.rejectPendingRpc(id);
    const state = this.live.get(id);
    if (state) this.abandonGroupMemberTurn(state);
    this.bridge?.send({ type: "_pibot", cmd: "stop_bot", botId: id });
    this.live.delete(id);
    this.setStatus(id, "stopped");
  }

  async deleteBot(id: string) {
    this.groupTurns.delete(id);
    this.rejectPendingRpc(id);
    const state = this.live.get(id);
    if (state) this.abandonGroupMemberTurn(state);
    db.prepare("DELETE FROM bot_sessions WHERE bot_id = ?").run(id);
    this.bridge?.send({ type: "_pibot", cmd: "stop_bot", botId: id });
    this.live.delete(id);
    // 清掉共享电脑上的私有目录（共享 workspace 里的产物保留，与官方一致）
    if (this.computer.containerId && (await this.docker.isRunning(this.computer.containerId))) {
      try {
        await this.docker.removePath(this.computer.containerId, `/config/bots/${id}`);
      } catch (err) {
        console.warn(`[bots] failed to remove bot dir for ${id}: ${(err as Error).message}`);
      }
    }
    db.prepare("DELETE FROM bots WHERE id = ?").run(id);
    db.prepare("DELETE FROM messages WHERE bot_id = ?").run(id);
    db.prepare("DELETE FROM routines WHERE bot_id = ?").run(id);
    db.prepare("DELETE FROM group_members WHERE bot_id = ?").run(id);
    this.skills.removeForBot(id);
    this.broadcast({ type: "bot_deleted", id });
  }

  setPinned(id: string, pinned: boolean) {
    db.prepare("UPDATE bots SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
    this.broadcastBot(id);
  }

  setHidden(id: string, hidden: boolean) {
    db.prepare("UPDATE bots SET hidden = ? WHERE id = ?").run(hidden ? 1 : 0, id);
    this.broadcastBot(id);
  }

  /** 重命名/改角色/改头像：写库、同步电脑里 AGENTS.md 身份行，插入事件行 */
  async updateBot(id: string, name: string, role: string, look?: BotLook) {
    const bot = this.getBot(id);
    if (!bot) throw new Error("bot not found");
    const renamed = name.trim() && name !== bot.name;
    const roleChanged = role !== bot.role;
    const nextColor = look?.avatar_color !== undefined ? look.avatar_color : bot.avatar_color;
    const nextShape =
      look && Object.prototype.hasOwnProperty.call(look, "avatar_shape")
        ? look.avatar_shape ?? null
        : bot.avatar_shape;
    const colorChanged = nextColor !== bot.avatar_color;
    const shapeChanged = nextShape !== bot.avatar_shape;
    if (!renamed && !roleChanged && !colorChanged && !shapeChanged) return bot;

    db.prepare("UPDATE bots SET name = ?, role = ?, avatar_color = ?, avatar_shape = ? WHERE id = ?").run(
      renamed ? name.trim() : bot.name,
      role,
      nextColor,
      nextShape,
      id,
    );

    // 尽力同步 AGENTS.md 的身份两行；电脑离线就等下次编辑记忆时自然一致
    const cid = this.computer.containerId;
    if (cid && (await this.docker.isRunning(cid))) {
      try {
        const buf = await this.docker.readFile(cid, memoryPath(id));
        if (buf) {
          const lines = buf.toString("utf8").split("\n");
          const updated = lines.map((l) => {
            if (l.startsWith("# You are "))
              return `# You are ${name.trim() || bot.name}, a persistent AI teammate`;
            if (l.startsWith("- Your role: "))
              return `- Your role: ${role || "a general-purpose assistant that gets real work done"}.`;
            return l;
          });
          await this.docker.writeFile(cid, memoryPath(id), Buffer.from(updated.join("\n")));
        }
      } catch (err) {
        console.warn(`[bots] AGENTS.md sync failed for ${id}: ${(err as Error).message}`);
      }
    }

    if (renamed) this.saveMessage(id, "system", `Renamed to ${name.trim()}`, "system");
    else this.broadcastBot(id);
    return this.getBot(id)!;
  }

  /** 清空会话历史（不动电脑与记忆） */
  clearMessages(id: string) {
    db.prepare("DELETE FROM messages WHERE bot_id = ?").run(id);
    db.prepare("UPDATE bots SET last_message = '' WHERE id = ?").run(id);
    this.broadcast({ type: "messages_cleared", botId: id });
    this.broadcastBot(id);
  }

  // ---------- 附件与共享电脑文件 ----------

  private async requireComputer(): Promise<string> {
    const cid = this.computer.containerId;
    if (!cid || !(await this.docker.isRunning(cid))) {
      throw new Error("the shared computer is offline");
    }
    return cid;
  }

  /** 把上传的文件写进共享 workspace，返回容器内路径 */
  async uploadAttachment(
    _botId: string,
    filename: string,
    data: Buffer,
    mime: string,
  ): Promise<Attachment> {
    const cid = await this.requireComputer();
    const safe = filename.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(-120) || "file";
    // 每次上传独立目录，保留原始文件名且不会互相覆盖
    const dir = `uploads/${Date.now().toString(36)}`;
    const path = `${WORKSPACE}/${dir}/${safe}`;
    await this.docker.writeFile(cid, path, data);
    return { name: safe, path, size: data.length, mime };
  }

  /** 读取 workspace 下的文件（回显聊天里的图片附件）。路径限制在 workspace 内。 */
  async readWorkspaceFile(_botId: string, relPath: string): Promise<Buffer | null> {
    const cid = this.computer.containerId;
    if (!cid) return null;
    if (relPath.includes("..") || relPath.startsWith("/")) return null;
    return this.docker.readFile(cid, `${WORKSPACE}/${relPath}`);
  }

  // ---------- 记忆（per-Bot AGENTS.md） ----------

  async getMemory(botId: string): Promise<string> {
    const cid = await this.requireComputer();
    const buf = await this.docker.readFile(cid, memoryPath(botId));
    const raw = buf ? buf.toString("utf8") : "";
    const normalized = normalizeAgentsMd(raw);
    if (normalized !== raw) {
      await this.docker.writeFile(cid, memoryPath(botId), Buffer.from(normalized, "utf8"));
    }
    return normalized;
  }

  async setMemory(botId: string, content: string): Promise<void> {
    const cid = await this.requireComputer();
    await this.docker.writeFile(cid, memoryPath(botId), Buffer.from(normalizeAgentsMd(content), "utf8"));
  }

  private channelLabel(botId: string): string {
    const channel = this.live.get(botId)?.channel ?? "main";
    if (channel.startsWith("group:")) {
      const groupId = channel.slice("group:".length);
      const row = db.prepare("SELECT name FROM groups WHERE id = ?").get(groupId) as { name: string } | undefined;
      return `群:${row?.name ?? groupId}`;
    }
    return "私聊";
  }

  private async applyMemoryNote(botId: string, kind: "preference" | "fact" | "work", note: string) {
    try {
      const cid = await this.requireComputer();
      const buf = await this.docker.readFile(cid, memoryPath(botId));
      const next = addMemoryNote(buf ? buf.toString("utf8") : "", kind, note);
      await this.docker.writeFile(cid, memoryPath(botId), Buffer.from(next, "utf8"));
    } catch (err) {
      console.warn(`[bots] update_memory failed for ${botId}: ${(err as Error).message}`);
    }
  }

  /** 一轮结束：把本轮 write/edit 成功的文件做成会话卡片 */
  private async publishProducedFiles(botId: string, state: LiveBot) {
    const raw = state.producedFiles.splice(0);
    state.pendingWrites.clear();
    if (raw.length === 0) return;

    const seen = new Set<string>();
    const paths: string[] = [];
    for (const item of raw) {
      const abs = resolveWorkspacePath(item);
      if (!abs || seen.has(abs)) continue;
      seen.add(abs);
      paths.push(abs);
      if (paths.length >= FILE_CARD_CAP) break;
    }
    if (paths.length === 0) return;

    let cid: string;
    try {
      cid = await this.requireComputer();
    } catch {
      return;
    }
    const inGroup = this.inGroupSession(botId);
    for (const abs of paths) {
      const size = await this.docker.statFile(cid, abs);
      if (size == null) continue;
      const name = fileBasename(abs);
      const meta = { name, path: abs, size, mime: guessMime(name) };
      if (inGroup) this.emitGroupPersist(botId, "file", name, meta);
      else this.saveMessage(botId, "assistant", name, "file", "", meta);
    }
  }

  private async recordWorkSummary(botId: string, state: LiveBot) {
    if (!state.turnWork) return;
    const summary = state.lastAssistantText.trim();
    state.turnWork = false;
    state.lastAssistantText = "";
    if (!summary) return;
    try {
      const cid = await this.requireComputer();
      const buf = await this.docker.readFile(cid, memoryPath(botId));
      const next = addWorkSummary(buf ? buf.toString("utf8") : "", this.channelLabel(botId), summary);
      await this.docker.writeFile(cid, memoryPath(botId), Buffer.from(next, "utf8"));
    } catch (err) {
      console.warn(`[bots] work summary failed for ${botId}: ${(err as Error).message}`);
    }
  }

  // ---------- 事件路由 ----------

  /** 桥接来的消息：{type:"_bridge"...} 桥事件，或 {botId, data} 某个 Bot 的 pi 事件 */
  private routeEvent(evt: any) {
    if (evt.type === "_bridge") {
      this.handleBridgeEvent(evt);
      return;
    }
    if (evt.botId && evt.data) {
      const state = this.live.get(evt.botId);
      if (state) this.handleRpcEvent(evt.botId, state, evt.data);
    }
  }

  private handleBridgeEvent(evt: any) {
    switch (evt.event) {
      case "connected":
        this.computer.status = "online";
        this.broadcastComputer();
        // 桥接重连：核对哪些会话还活着
        for (const id of evt.running ?? []) {
          if (!this.live.has(id)) this.live.set(id, newLive());
          this.setStatus(id, "online");
        }
        return;
      case "bot_started":
        if (!this.live.has(evt.botId)) {
          this.live.set(evt.botId, newLive());
        }
        this.setStatus(evt.botId, "online");
        // 会话拉起后同步一次生效模型；内容相同桥接不会重启 pi
        this.pushModelConfig(evt.botId);
        return;
      case "bot_exited":
        if (!evt.intended && this.getBot(evt.botId)) {
          this.setStatus(evt.botId, "starting"); // 桥接会自动重启
        }
        return;
      case "bot_restarted":
        if (this.getBot(evt.botId)) this.setStatus(evt.botId, "online");
        return;
      case "model_applied":
        if (evt.changed && evt.botId) {
          const bot = this.getBot(evt.botId);
          const profile = bot ? this.profiles.effectiveFor(bot.model_profile_id) : undefined;
          this.saveMessage(
            evt.botId,
            "system",
            `Switched model to ${profile?.model_name ?? "new configuration"}.`,
            "system",
          );
        }
        return;
      case "mcp_test_result": {
        const pending = this.pendingMcpTests.get(evt.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingMcpTests.delete(evt.requestId);
        this.mcpServers.updateProbe(pending.serverId, {
          ok: !!evt.ok,
          tools: evt.tools,
          error: evt.error,
        });
        this.broadcast({ type: "mcp_changed" });
        pending.resolve(this.mcpServers.publicGet(pending.serverId));
        return;
      }
      default:
        return;
    }
  }

  /** 把 Bot 当前生效的模型配置下发到它的 pi 会话（切换模型只重启该会话） */
  pushModelConfig(botId: string) {
    const bot = this.getBot(botId);
    if (!bot || !this.bridge) return;
    const config = this.containerConfigForBot(bot);
    if (!config) return;
    this.bridge.send({
      type: "_pibot",
      cmd: "set_model",
      botId,
      config,
    });
  }

  /** 绑定模型档案到 Bot（传 null 表示跟随默认档案） */
  setBotModelProfile(botId: string, profileId: string | null) {
    db.prepare("UPDATE bots SET model_profile_id = ? WHERE id = ?").run(profileId, botId);
    this.broadcastBot(botId);
    this.pushModelConfig(botId);
  }

  /** 档案内容变更后，把所有在线 Bot 全部同步一遍 */
  pushModelConfigToAll() {
    for (const id of this.live.keys()) this.pushModelConfig(id);
  }

  /** 同步账户级 MCP server 配置；桥接只在内容变化时重启 Bot 会话。 */
  pushMcpConfig() {
    this.bridge?.send({
      type: "_pibot",
      cmd: "set_mcp",
      servers: this.mcpServers.enabledForContainer(this.approvalRules.list()),
    });
  }

  async testMcp(serverId: string) {
    await this.ensureComputer();
    const config = this.mcpServers.getContainerConfig(serverId, this.approvalRules.list());
    if (!config) throw new Error("MCP server not found");
    if (!this.bridge?.connected) throw new Error("Shared computer is not connected");

    this.mcpServers.markTesting(serverId);
    this.broadcast({ type: "mcp_changed" });
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingMcpTests.delete(requestId);
        this.mcpServers.updateProbe(serverId, {
          ok: false,
          error: "Connection test timed out after 60 seconds",
        });
        this.broadcast({ type: "mcp_changed" });
        resolve(this.mcpServers.publicGet(serverId));
      }, 60_000);
      this.pendingMcpTests.set(requestId, { serverId, resolve, timer });
      this.bridge!.send({ type: "_pibot", cmd: "test_mcp", requestId, server: config });
    });
  }

  private handleRpcEvent(botId: string, state: LiveBot, evt: any) {
    switch (evt.type) {
      // pi 拒绝了命令（最常见：中转 baseUrl/apiKey 无效导致没有可用模型）。
      // 不提示的话用户只会看到 Bot 沉默，无从判断问题。
      case "response":
        if (evt.id && this.pendingRpc.has(evt.id)) {
          const pending = this.pendingRpc.get(evt.id)!;
          this.pendingRpc.delete(evt.id);
          clearTimeout(pending.timer);
          pending.resolve(evt);
          return;
        }
        if (evt.success === false) {
          state.streaming = false;
          this.broadcast({ type: "working", botId, working: false, channel: state.channel });
          this.saveMessage(
            botId,
            "system",
            `Command "${evt.command}" failed: ${evt.error ?? "unknown error"}`,
            "system",
          );
          this.notifyIdle(state);
          this.finishGroupMemberTurn(botId, state, true);
        }
        return;

      case "agent_start":
        state.streaming = true;
        state.streamText = "";
        state.turnWork = false;
        state.lastAssistantText = "";
        state.usedAnyTool = false;
        state.groupStarted = true;
        state.pendingWrites.clear();
        state.producedFiles = [];
        this.broadcast({ type: "working", botId, working: true, channel: state.channel });
        return;

      case "message_update": {
        const a = evt.assistantMessageEvent;
        if (a?.type === "text_delta") {
          state.streamText += a.delta;
          this.broadcast({ type: "stream", botId, delta: a.delta, channel: state.channel });
        }
        return;
      }

      case "message_end": {
        const msg = evt.message;
        if (msg?.role === "assistant") {
          const text = this.extractText(msg.content);
          const inGroup = this.inGroupSession(botId);
          this.broadcast({ type: "stream_end", botId, channel: state.channel });
          state.streamText = "";
          if (text.trim()) state.lastAssistantText = text;
          if (text.trim() && !inGroup) {
            this.saveMessage(botId, "assistant", text, "text", "");
          }
          if ((text.trim() || this.groupTurns.has(botId)) && !inGroup) {
            for (const fn of this.assistantListeners) fn(botId, text);
          }
          if (msg.stopReason === "error" && !inGroup) {
            this.saveMessage(botId, "system", msg.errorMessage ?? "Model call failed.", "system");
          }
        }
        return;
      }

      case "tool_execution_start":
        state.usedAnyTool = true;
        if (WORK_TOOLS.has(String(evt.toolName ?? ""))) state.turnWork = true;
        // 社交/记忆工具由服务端落地；容器侧工具只做确认返回
        this.interceptTool(botId, evt.toolName, evt.args);
        {
          const writePath = toolWritePath(String(evt.toolName ?? ""), evt.args);
          if (writePath && evt.toolCallId) state.pendingWrites.set(String(evt.toolCallId), writePath);
        }
        this.broadcast({
          type: "tool",
          botId,
          channel: state.channel,
          status: "start",
          toolCallId: evt.toolCallId,
          toolName: evt.toolName,
          args: evt.args,
        });
        return;

      case "tool_execution_end": {
        const writePath = state.pendingWrites.get(String(evt.toolCallId ?? ""));
        if (writePath) {
          state.pendingWrites.delete(String(evt.toolCallId));
          if (!evt.isError) state.producedFiles.push(writePath);
        }
        const preview = this.toolResultPreview(evt.result);
        const toolName = String(evt.toolName ?? "");
        const skipCard =
          isSendMessageTool(toolName) || toolName === "message_teammate" || toolName === "update_memory";
        const meta = { toolName, isError: !!evt.isError, toolCallId: evt.toolCallId };
        if (!skipCard) {
          if (this.inGroupSession(botId)) this.emitGroupPersist(botId, "tool", preview, meta);
          else this.saveMessage(botId, "assistant", preview, "tool", "", meta);
        }
        this.broadcast({
          type: "tool",
          botId,
          channel: state.channel,
          status: "end",
          toolCallId: evt.toolCallId,
          toolName: evt.toolName,
          isError: !!evt.isError,
        });
        return;
      }

      case "extension_ui_request":
        this.handleUiRequest(botId, evt);
        return;

      case "agent_end":
        this.finishGroupMemberTurn(botId, state);
        return;

      case "agent_settled":
        state.streaming = false;
        this.broadcast({ type: "working", botId, working: false, channel: state.channel });
        this.notifyIdle(state);
        this.finishGroupMemberTurn(botId, state);
        void this.publishProducedFiles(botId, state)
          .catch((err) => console.warn(`[bots] file cards failed for ${botId}: ${(err as Error).message}`))
          .finally(() => this.recordWorkSummary(botId, state).finally(() => this.flushPromptQueue(botId)));
        return;

      default:
        return;
    }
  }

  private handleUiRequest(botId: string, evt: any) {
    const method = evt.method;
    if (method === "select" || method === "confirm" || method === "input") {
      const options =
        method === "confirm"
          ? ["Approve", "Reject"]
          : method === "select"
            ? evt.options ?? ["Approve", "Reject"]
            : [];
      const marker = String(evt.title ?? "").match(
        /^\[PIBOT_MCP_APPROVAL:([^:]+):([^\]]+)\]\s*(.*)$/,
      );
      const displayTitle = marker ? `MCP approval · ${marker[3]}` : evt.title;
      if (marker) {
        this.pendingMcpApprovals.set(`${botId}:${evt.id}`, {
          serverId: marker[1],
          toolName: decodeURIComponent(marker[2]),
        });
      }
      this.saveMessage(botId, "assistant", displayTitle ?? evt.message ?? "Approval needed", "approval", "", {
        requestId: evt.id,
        method,
        message: evt.message ?? "",
        options,
        placeholder: evt.placeholder ?? "",
        resolved: false,
      });
      this.setAttention(botId, true);
      this.broadcast({
        type: "approval",
        botId,
        requestId: evt.id,
        method,
        title: displayTitle ?? "",
        message: evt.message ?? "",
        options,
      });
    } else if (method === "notify") {
      this.saveMessage(botId, "system", evt.message ?? "", "system");
    }
    // fire-and-forget methods (setStatus/setWidget/…) are ignored
  }

  private interceptTool(botId: string, toolName: string, args: any) {
    const sender = this.getBot(botId);
    if (!sender || !args) return;

    if (isSendMessageTool(toolName)) {
      if (!this.inGroupSession(botId)) return;
      const post = parseGroupPost(args);
      const live = this.live.get(botId);
      if (live) live.groupSends.push({ ...post, persisted: !isPassContent(post.text) });
      if (post.text && !isPassContent(post.text)) {
        this.emitGroupPersist(botId, "text", post.text);
      }
      return;
    }

    if (toolName === "update_memory" && args.note) {
      const kind = isMemoryKind(args.kind) ? args.kind : "fact";
      void this.applyMemoryNote(botId, kind, String(args.note));
      return;
    }

    // Bot 保存技能 → 落库，之后所有 Bot 都能被 /slug 引用
    if (toolName === "save_skill" && args.name && args.content) {
      const skill = this.skills.upsertByName(
        { name: String(args.name), description: String(args.description ?? ""), content: String(args.content) },
        `bot:${sender.name}`,
      );
      this.broadcast({ type: "skills_changed" });
      this.saveMessage(botId, "system", `Saved skill "/${skill.slug}" — usable by every Bot.`, "system");
      return;
    }

    // Bot 给队友发消息 → 唤醒目标 Bot（官方 "Bots can message each other"）
    if (toolName === "message_teammate" && args.name && args.message) {
      const target = this.listBots().find(
        (b) => b.id !== botId && b.name.toLowerCase() === String(args.name).toLowerCase().trim(),
      );
      if (!target) {
        this.saveMessage(botId, "system", `No teammate named "${args.name}" found.`, "system");
        return;
      }
      for (const fn of this.teammateHandoffListeners) {
        if (fn(sender, target, String(args.message))) return;
      }
      // 没有共同群时才走 1:1；同群转交由 GroupManager 留下群内 handoff。
      this.sendPrompt(
        target.id,
        `[Message from your teammate ${sender.name}]\n${args.message}\n[Reply to the user if action is needed; use message_teammate to answer ${sender.name} directly.]`,
        `bot:${sender.name}`,
      );
    }
  }

  private sendToBot(botId: string, data: Record<string, unknown>) {
    this.bridge?.send({ botId, data });
  }

  respondApproval(botId: string, requestId: string, value: string | boolean) {
    let response: Record<string, unknown>;
    if (typeof value === "boolean") {
      response = { type: "extension_ui_response", id: requestId, confirmed: value };
    } else {
      response = { type: "extension_ui_response", id: requestId, value };
    }
    const pendingMcp = this.pendingMcpApprovals.get(`${botId}:${requestId}`);
    if (pendingMcp) {
      this.pendingMcpApprovals.delete(`${botId}:${requestId}`);
      if (value === "Always allow") {
        this.approvalRules.upsert({
          action: "allow",
          serverId: pendingMcp.serverId,
          toolName: pendingMcp.toolName,
        });
        this.pushMcpConfig();
        this.broadcast({ type: "approval_rules_changed" });
      }
    }
    this.sendToBot(botId, response);
    this.setAttention(botId, false);
    // 更新已存审批消息为已解决
    const row = db
      .prepare(
        "SELECT * FROM messages WHERE bot_id = ? AND kind = 'approval' ORDER BY id DESC LIMIT 1",
      )
      .get(botId) as MessageRow | undefined;
    if (row?.meta) {
      const meta = JSON.parse(row.meta);
      if (meta.requestId === requestId) {
        meta.resolved = true;
        meta.decision = value;
        db.prepare("UPDATE messages SET meta = ? WHERE id = ?").run(JSON.stringify(meta), row.id);
        this.broadcast({ type: "message_update_row", message: { ...row, meta: JSON.stringify(meta) } });
      }
    }
  }

  sendPrompt(
    botId: string,
    text: string,
    author = "user",
    attachments?: Attachment[],
    persist = true,
    channel = "main",
    sessionName?: string,
  ): Promise<boolean> {
    const state = this.live.get(botId);
    const meta = attachments?.length ? { attachments } : undefined;
    if (persist) {
      this.groupTurns.delete(botId);
      this.saveMessage(botId, "user", text, "text", author, meta);
    }
    if (!state || !this.bridge?.connected) {
      if (persist) {
        this.saveMessage(botId, "system", "Bot is offline. Start it to deliver this message.", "system");
      }
      return Promise.resolve(false);
    }
    const job: PromptJob = { text, author, attachments, persist, channel, sessionName };
    if (state.streaming && state.channel !== "unknown" && state.channel !== channel) {
      return new Promise((resolve) => state.queue.push({ job, resolve }));
    }
    if (state.streaming && channel.startsWith("group:")) {
      return new Promise((resolve) => state.queue.push({ job, resolve }));
    }
    return this.deliverJob(botId, job);
  }

  async runGroupMemberTurn(
    botId: string,
    prompt: string,
    channel: string,
    sessionName?: string,
  ): Promise<GroupPost[]> {
    const state = this.live.get(botId);
    if (!state || !this.bridge?.connected) return [];
    if (state.streaming && state.channel !== channel) {
      await this.waitUntilIdle(botId, 120_000);
    } else if (state.streaming) {
      await this.waitUntilIdle(botId, 20_000);
      const again = this.live.get(botId);
      if (again?.streaming && again.channel === channel) {
        this.abort(botId, channel);
        await this.waitUntilIdle(botId, 15_000);
      }
    }
    const live = this.live.get(botId);
    if (!live || !this.bridge?.connected) return [];
    if (live.streaming && live.channel !== channel) {
      // 另一频道还在忙：交给 sendPrompt 排队，不把那边掐掉
    } else if (live.streaming) {
      console.warn(`[bots] ${botId} still streaming on ${live.channel}, skip group turn`);
      return [];
    }
    live.groupSends = [];
    live.usedAnyTool = false;
    live.groupStarted = false;
    const posts = new Promise<GroupPost[]>((resolve) => {
      live.groupDone = resolve;
    });
    const soft = setTimeout(() => this.abort(botId, channel), GROUP_MEMBER_TIMEOUT_MS);
    const hard = setTimeout(() => {
      const current = this.live.get(botId);
      if (current) this.abandonGroupMemberTurn(current);
    }, GROUP_MEMBER_TIMEOUT_MS + 15_000);
    const ok = await this.sendPrompt(botId, prompt, "group", undefined, false, channel, sessionName);
    if (!ok) {
      clearTimeout(soft);
      clearTimeout(hard);
      this.abandonGroupMemberTurn(live);
      return [];
    }
    try {
      return await posts;
    } finally {
      clearTimeout(soft);
      clearTimeout(hard);
    }
  }

  private waitUntilIdle(botId: string, ms: number): Promise<void> {
    const state = this.live.get(botId);
    if (!state?.streaming) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.idleWaiters = state.idleWaiters.filter((fn) => fn !== done);
        resolve();
      }, ms);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      state.idleWaiters.push(done);
    });
  }

  private notifyIdle(state: LiveBot) {
    const waiters = state.idleWaiters;
    state.idleWaiters = [];
    for (const fn of waiters) fn();
  }

  private finishGroupMemberTurn(botId: string, state: LiveBot, force = false) {
    if (!state.groupDone) return;
    if (!force && !state.groupStarted) return;
    if (!state.channel.startsWith("group:") && !this.groupTurns.has(botId)) return;
    const done = state.groupDone;
    state.groupDone = null;
    state.groupStarted = false;
    const fallback = state.usedAnyTool ? undefined : state.lastAssistantText;
    const posts = takeGroupPosts(state.groupSends, fallback);
    state.groupSends = [];
    if (posts.length) state.lastAssistantText = posts.map((post) => post.text).join("\n");
    this.endGroupTurn(botId);
    done(posts);
  }

  private abandonGroupMemberTurn(state: LiveBot) {
    const done = state.groupDone;
    state.groupDone = null;
    state.groupSends = [];
    this.notifyIdle(state);
    if (done) done([]);
  }

  private async deliverJob(botId: string, job: PromptJob): Promise<boolean> {
    const state = this.live.get(botId);
    if (!state || !this.bridge?.connected) return false;
    const switched = await this.ensureChannel(botId, job.channel, job.sessionName);
    if (!switched) return false;
    if (job.channel.startsWith("group:")) {
      this.groupTurns.add(botId);
      for (const fn of this.groupDeliverListeners) fn(botId, job.channel);
    } else {
      this.groupTurns.delete(botId);
    }
    let prompt = job.text;
    if (job.attachments?.length) {
      const list = job.attachments.map((a) => `- ${a.path} (${a.mime || "file"}, ${a.size} bytes)`).join("\n");
      prompt = `${job.text || "(no message, files only)"}\n\n[The user sent file(s), already saved on the shared computer:\n${list}\nOpen or read them as needed.]`;
      const bot = this.getBot(botId);
      const profile = bot ? this.profiles.effectiveFor(bot.model_profile_id) : undefined;
      const hasImages = job.attachments.some((a) => a.mime.startsWith("image/"));
      if (hasImages && profile && profile.vision !== 1) {
        prompt +=
          "\n[Note: your model cannot view images directly. To inspect an image, open it in the browser (file:// URL) and use browser_screenshot, which describes visuals via a helper model.]";
      }
    }
    const referenced = this.skills.resolveReferences(job.text, botId);
    for (const s of referenced) {
      prompt += `\n\n[Skill "/${s.slug}" — ${s.name}]\n${s.content}\n[End of skill. Follow it for this task.]`;
    }
    const cmd: Record<string, unknown> = { type: "prompt", message: prompt };
    if (state.streaming) cmd.streamingBehavior = "steer";
    this.sendToBot(botId, cmd);
    return true;
  }

  private flushPromptQueue(botId: string) {
    const state = this.live.get(botId);
    const next = state?.queue.shift();
    if (!next) return;
    void this.deliverJob(botId, next.job).then(next.resolve);
  }

  /** 复制 Bot：带人设/模型/例行任务，不带会话历史与记忆（与官方一致） */
  async duplicateBot(sourceId: string): Promise<BotRow> {
    const src = this.getBot(sourceId);
    if (!src) throw new Error("bot not found");
    const bot = await this.createBot(`${src.name} copy`, src.role, src.model_profile_id ?? undefined);
    db.prepare("UPDATE bots SET avatar_color = ?, avatar_shape = ?, thinking_override = ? WHERE id = ?").run(
      src.avatar_color,
      src.avatar_shape,
      src.thinking_override,
      bot.id,
    );
    this.skills.copyForBot(sourceId, bot.id);
    const routines = db
      .prepare("SELECT * FROM routines WHERE bot_id = ?")
      .all(sourceId) as { name: string; cron: string; prompt: string }[];
    for (const r of routines) {
      db.prepare(
        "INSERT INTO routines (id, bot_id, name, cron, prompt, enabled, created_at) VALUES (?,?,?,?,?,0,?)",
      ).run(randomUUID().slice(0, 8), bot.id, r.name, r.cron, r.prompt, Date.now());
    }
    this.pushModelConfig(bot.id);
    this.broadcastBot(bot.id);
    return this.getBot(bot.id)!;
  }

  abort(botId: string, onlyChannel?: string) {
    if (onlyChannel) {
      this.dropQueueForChannel(botId, onlyChannel);
      const state = this.live.get(botId);
      if (state?.channel === onlyChannel && (state.streaming || this.groupTurns.has(botId))) {
        this.sendToBot(botId, { type: "abort" });
      }
      return;
    }
    this.sendToBot(botId, { type: "abort" });
  }

  // ---------- helpers ----------
  private extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text)
        .join("");
    }
    return "";
  }

  private toolResultPreview(result: any): string {
    if (!result?.content) return "";
    const parts: string[] = [];
    for (const b of result.content) {
      if (b.type === "text") parts.push(b.text);
      else if (b.type === "image") parts.push("[screenshot]");
    }
    const text = parts.join("\n");
    const maxLength = 100_000;
    return text.length > maxLength
      ? `${text.slice(0, maxLength)}\n\n… [tool output truncated at 100,000 characters]`
      : text;
  }

  // ---------- 启动与迁移 ----------

  /** 服务启动：迁移旧架构 → 拉起共享电脑 → 恢复 Bot 会话 */
  async startup() {
    const memories = await this.migrateLegacyBots();
    if (this.listBots().length > 0) {
      await this.ensureComputer();
      // 把迁移出来的记忆文件写进新电脑（在 start_bot 生成模板之前写，桥接会保留已有文件）
      if (memories.size > 0) {
        const cid = await this.requireComputer();
        for (const [botId, content] of memories) {
          try {
            await this.docker.writeFile(cid, memoryPath(botId), content);
            console.log(`[migrate] restored memory for bot ${botId}`);
          } catch (err) {
            console.warn(`[migrate] failed to restore memory for ${botId}: ${(err as Error).message}`);
          }
        }
      }
    }
  }

  /** 旧架构（每 Bot 一容器）→ 新架构：抢救 AGENTS.md，删除旧容器与卷 */
  private async migrateLegacyBots(): Promise<Map<string, Buffer>> {
    const memories = new Map<string, Buffer>();
    const legacy = this.listBots().filter((b) => b.container_id);
    for (const bot of legacy) {
      const cid = bot.container_id!;
      try {
        if (await this.docker.isRunning(cid)) {
          const buf = await this.docker.readFile(cid, "/config/workspace/AGENTS.md");
          if (buf && buf.length > 0) memories.set(bot.id, buf);
        }
      } catch (err) {
        console.warn(`[migrate] could not read memory of ${bot.name}: ${(err as Error).message}`);
      }
      await this.docker.removeLegacyContainer(cid, bot.id);
      db.prepare(
        "UPDATE bots SET container_id = NULL, vnc_port = NULL, bridge_port = NULL WHERE id = ?",
      ).run(bot.id);
      console.log(`[migrate] removed legacy container for ${bot.name} (${bot.id})`);
    }
    return memories;
  }

  liveBotIds(): string[] {
    return [...this.live.keys()];
  }
}
