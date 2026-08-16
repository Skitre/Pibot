import { randomUUID } from "node:crypto";
import db, { BotRow } from "./db.js";
import { BotManager, type Attachment } from "./bot-manager.js";
import { ModelProfileStore } from "./model-profiles.js";
import { moderate } from "./moderator.js";
import {
  GROUP_HISTORY_WINDOW,
  GROUP_MAX_MEMBERS,
  GROUP_MAX_MEMBER_TURNS,
  GROUP_MAX_MODERATOR_CALLS,
  GROUP_MAX_WALL_MS,
  GROUP_MIN_MEMBERS,
  buildGroupSeedPrompt,
  buildGroupTurnPrompt,
  countMemberPosts,
  fileNamesFromLines,
  formatChatLines,
  guardNextMembers,
  isSilentPost,
  lastMessages,
  lastPostSignal,
  latestUserTask,
  mentionNamesFromPosts,
  mergeNextNames,
  messagesSinceLastSpoke,
  resolveMembersByNames,
  resolveResponders,
  sliceFromLatestHandoff,
  sliceFromLatestUser,
  type ChatLine,
  type GroupPost,
} from "./group-chat.js";

type Broadcast = (msg: Record<string, unknown>) => void;

interface GroupRow {
  id: string;
  name: string;
  created_at: number;
  last_message?: string;
  last_activity?: number;
  moderator_name?: string;
  moderator_profile_id?: string | null;
  moderator_instructions?: string;
  moderator_max_tokens?: number;
  moderator_history?: number;
  moderator_thinking?: string;
}

export interface GroupModeratorInput {
  name?: string;
  profileId?: string | null;
  instructions?: string;
  /** 0 表示继承所选档案 */
  maxTokens?: number;
  /** 0 表示继承 GROUP_HISTORY_WINDOW */
  history?: number;
  /** 空表示不发送思考参数 */
  thinking?: string;
}

interface TurnState {
  epoch: number;
  startedAt: number;
  moderatorCalls: number;
  speakCount: Map<string, number>;
  lastSpeakerId: string | null;
  userTask: string;
  rescued: Set<string>;
  triedSilent: Set<string>;
  silentRounds: number;
}

export class GroupError extends Error {
  readonly statusCode: 400 | 404;
  constructor(statusCode: 400 | 404, message: string) {
    super(message);
    this.name = "GroupError";
    this.statusCode = statusCode;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 主持人那几个覆盖项统一用 0 表示继承，负数和非法值一律当没设置。 */
function clampNonNegative(value: number | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function previewLine(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 80)}…` : one;
}

// 群是独立线程：UI 落 group_messages。房间没有自己的 runner；
// 编排器按轮次串行驱动成员。每个成员 Bot 在 workspace 里另开
// 一条 pi session（group:<id>），与私聊 main 用 switch_session 切换。
export class GroupManager {
  constructor(
    private bots: BotManager,
    private broadcast: Broadcast,
    private profiles: ModelProfileStore,
  ) {
    this.bots.onTeammateHandoff((sender, target, message) => this.onTeammateHandoff(sender, target, message));
    this.bots.onGroupPersist((botId, channel, kind, content, meta) => {
      if (!channel.startsWith("group:")) return;
      const groupId = channel.slice("group:".length);
      const bot = this.bots.getBot(botId);
      if (!bot || !this.getGroup(groupId)) return;
      this.saveGroupMessage(groupId, bot.name, content, botId, kind, meta);
    });
  }

  private epoch = new Map<string, number>();
  private activeLoop = new Map<string, number>();
  private speaking = new Map<string, string>();
  private turnOrigin = new Map<string, "user" | "handoff">();
  private assigning = new Set<string>();
  private waiting = new Set<string>();

  listGroups(): GroupRow[] {
    const rows = db
      .prepare(
        `SELECT g.*,
           COALESCE((
             SELECT content FROM group_messages
             WHERE group_id = g.id AND kind IN ('text', 'system', 'file', 'handoff')
             ORDER BY id DESC LIMIT 1
           ), '') AS last_message,
           COALESCE((
             SELECT created_at FROM group_messages WHERE group_id = g.id ORDER BY id DESC LIMIT 1
           ), g.created_at) AS last_activity
         FROM groups g
         ORDER BY last_activity DESC`,
      )
      .all() as GroupRow[];
    return rows.map((row) => ({ ...row, last_message: previewLine(row.last_message ?? "") }));
  }

  getGroup(id: string): GroupRow | undefined {
    return db.prepare("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow | undefined;
  }

  members(groupId: string): BotRow[] {
    return db
      .prepare(
        "SELECT b.* FROM bots b JOIN group_members m ON m.bot_id = b.id WHERE m.group_id = ? ORDER BY m.rowid ASC",
      )
      .all(groupId) as BotRow[];
  }

  createGroup(name: string, botIds: string[]): GroupRow {
    const title = typeof name === "string" ? name.trim() : "";
    if (!title) throw new GroupError(400, "group name is required");
    const ids = [...new Set((botIds ?? []).filter((id) => typeof id === "string" && id))];
    if (ids.length < GROUP_MIN_MEMBERS || ids.length > GROUP_MAX_MEMBERS) {
      throw new GroupError(400, "group needs 2–6 bots");
    }
    for (const id of ids) {
      if (!this.bots.getBot(id)) throw new GroupError(400, `bot ${id} not found`);
    }
    const id = randomUUID().slice(0, 8);
    db.prepare("INSERT INTO groups (id, name, created_at) VALUES (?,?,?)").run(id, title, Date.now());
    const stmt = db.prepare("INSERT OR IGNORE INTO group_members (group_id, bot_id) VALUES (?,?)");
    for (const botId of ids) stmt.run(id, botId);
    return db.prepare("SELECT * FROM groups WHERE id = ?").get(id) as GroupRow;
  }

  updateModerator(groupId: string, input: GroupModeratorInput): GroupRow {
    const group = this.getGroup(groupId);
    if (!group) throw new GroupError(404, "group not found");
    const name = (input.name ?? group.moderator_name ?? "主持人").trim() || "主持人";
    const instructions = (input.instructions ?? group.moderator_instructions ?? "").trim();
    let profileId = input.profileId === undefined ? (group.moderator_profile_id ?? null) : input.profileId;
    if (profileId === "") profileId = null;
    const maxTokens = clampNonNegative(input.maxTokens ?? group.moderator_max_tokens);
    const history = clampNonNegative(input.history ?? group.moderator_history);
    const thinking = (input.thinking ?? group.moderator_thinking ?? "").trim();
    db.prepare(
      `UPDATE groups SET moderator_name = ?, moderator_profile_id = ?, moderator_instructions = ?,
       moderator_max_tokens = ?, moderator_history = ?, moderator_thinking = ? WHERE id = ?`,
    ).run(name, profileId, instructions, maxTokens, history, thinking, groupId);
    const next = this.getGroup(groupId)!;
    this.broadcast({ type: "group_update", group: next });
    return next;
  }

  messages(groupId: string) {
    return db
      .prepare("SELECT * FROM group_messages WHERE group_id = ? ORDER BY id ASC")
      .all(groupId);
  }

  deleteGroup(groupId: string) {
    this.bumpEpoch(groupId);
    this.bots.abortGroup(groupId);
    db.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
    db.prepare("DELETE FROM group_members WHERE group_id = ?").run(groupId);
    db.prepare("DELETE FROM group_messages WHERE group_id = ?").run(groupId);
    this.epoch.delete(groupId);
    this.activeLoop.delete(groupId);
    this.turnOrigin.delete(groupId);
    this.setAssigning(groupId, false);
    this.setWaiting(groupId, false);
    for (const [botId, gid] of this.speaking) {
      if (gid === groupId) this.speaking.delete(botId);
    }
    this.bots.dropSessionsForGroup(groupId);
    this.broadcast({ type: "group_deleted", id: groupId });
  }

  abortGroup(groupId: string) {
    if (!this.getGroup(groupId)) return;
    this.bumpEpoch(groupId);
    this.bots.abortGroup(groupId);
    this.setWaiting(groupId, false);
    this.saveGroupMessage(groupId, "System", "Stopped.", null, "system");
  }

  abortActive() {
    const ids = new Set([...this.activeLoop.keys(), ...this.waiting]);
    for (const id of ids) this.abortGroup(id);
  }

  postUserMessage(groupId: string, text: string, attachments?: Attachment[]) {
    if (!this.getGroup(groupId)) return;
    const content = typeof text === "string" ? text.trim() : "";
    const files = (attachments ?? []).filter((item) => item?.path);
    if (!content && files.length === 0) return;
    this.bumpEpoch(groupId);
    this.bots.abortGroup(groupId);
    this.setWaiting(groupId, false);
    this.turnOrigin.set(groupId, "user");
    if (content) this.saveGroupMessage(groupId, "You", content, null);
    for (const file of files) {
      this.saveGroupMessage(groupId, "You", file.name, null, "file", {
        name: file.name,
        path: file.path,
        size: file.size,
        mime: file.mime,
      });
    }
    void this.runGroupTurn(groupId);
  }

  async uploadAttachment(groupId: string, filename: string, data: Buffer, mime: string): Promise<Attachment> {
    if (!this.getGroup(groupId)) throw new GroupError(404, "group not found");
    return this.bots.uploadAttachment("group", filename, data, mime);
  }

  private saveGroupMessage(
    groupId: string,
    author: string,
    content: string,
    botId: string | null,
    kind = "text",
    meta?: unknown,
  ) {
    const info = db
      .prepare(
        "INSERT INTO group_messages (group_id, bot_id, author, content, kind, meta, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(groupId, botId, author, content, kind, meta ? JSON.stringify(meta) : null, Date.now());
    const row = db.prepare("SELECT * FROM group_messages WHERE id = ?").get(info.lastInsertRowid);
    this.broadcast({ type: "group_message", groupId, message: row });
  }

  private bumpEpoch(groupId: string): number {
    const next = (this.epoch.get(groupId) ?? 0) + 1;
    this.epoch.set(groupId, next);
    return next;
  }

  private currentEpoch(groupId: string): number {
    return this.epoch.get(groupId) ?? 0;
  }

  private isCurrent(groupId: string, epoch: number): boolean {
    return this.currentEpoch(groupId) === epoch && !!this.getGroup(groupId);
  }

  private isTurnActive(groupId: string): boolean {
    return this.activeLoop.get(groupId) === this.currentEpoch(groupId);
  }

  runningGroups(): { id: string; botIds: string[] }[] {
    return [...this.activeLoop.keys()]
      .filter((id) => this.isTurnActive(id))
      .map((id) => ({ id, botIds: this.members(id).map((member) => member.id) }));
  }

  assigningGroups(): string[] {
    return [...this.assigning];
  }

  waitingGroups(): string[] {
    return [...this.waiting];
  }

  private setWaiting(groupId: string, on: boolean) {
    if (on) this.waiting.add(groupId);
    else this.waiting.delete(groupId);
    this.broadcast({ type: "group_wait", groupId, waiting: on });
  }

  private waitForUser(groupId: string, epoch: number) {
    if (!this.isCurrent(groupId, epoch)) return;
    this.setWaiting(groupId, true);
    console.log(`[groups] ${groupId} waiting for user`);
  }

  private setAssigning(groupId: string, on: boolean) {
    if (on) this.assigning.add(groupId);
    else this.assigning.delete(groupId);
    this.broadcast({ type: "group_moderator", groupId, assigning: on });
  }

  private chatLines(groupId: string): ChatLine[] {
    const rows = db
      .prepare("SELECT author, content, kind, bot_id FROM group_messages WHERE group_id = ? ORDER BY id ASC")
      .all(groupId) as { author: string; content: string; kind: string; bot_id: string | null }[];
    return rows.map((row) => ({
      author: row.author,
      content: row.content,
      kind: row.kind,
      botId: row.bot_id,
    }));
  }

  /** 编排器写的系统行只给界面看。回灌进提示词，成员会读到调度内幕，主持人会读到自己上一次的派单理由。 */
  private promptLines(groupId: string): ChatLine[] {
    return this.chatLines(groupId).filter((line) => (line.kind ?? "text") !== "system");
  }

  private budgetHit(groupId: string, state: TurnState): string | null {
    const posts = countMemberPosts(this.turnSlice(groupId, this.chatLines(groupId)));
    if (posts >= GROUP_MAX_MEMBER_TURNS) return "Reached the turn budget (member messages).";
    if (state.moderatorCalls >= GROUP_MAX_MODERATOR_CALLS) return "Reached the turn budget (moderator calls).";
    if (Date.now() - state.startedAt >= GROUP_MAX_WALL_MS) return "Reached the turn budget (time).";
    return null;
  }

  private stopWith(groupId: string, epoch: number, reason: string) {
    if (this.isCurrent(groupId, epoch)) {
      this.saveGroupMessage(groupId, "System", reason, null, "system");
    }
  }

  private async runGroupTurn(groupId: string) {
    const epoch = this.currentEpoch(groupId);
    if (!this.isCurrent(groupId, epoch)) return;
    this.activeLoop.set(groupId, epoch);
    this.setWaiting(groupId, false);
    this.broadcast({
      type: "group_run",
      groupId,
      running: true,
      botIds: this.members(groupId).map((member) => member.id),
    });

    const origin = this.turnOrigin.get(groupId) ?? "user";
    const opening = this.turnSlice(groupId, this.chatLines(groupId));
    const members0 = this.members(groupId);
    const state: TurnState = {
      epoch,
      startedAt: Date.now(),
      moderatorCalls: 0,
      speakCount: new Map(),
      lastSpeakerId: null,
      userTask: latestUserTask(this.chatLines(groupId)),
      rescued: new Set(),
      triedSilent: new Set(),
      silentRounds: 0,
    };

    let queue =
      origin === "handoff"
        ? this.handoffTargets(members0, opening)
        : resolveResponders(members0, opening);
    let pending: { next: string[]; done: boolean; askUser: boolean } | null = null;

    try {
      while (true) {
        if (!this.isCurrent(groupId, epoch)) return;
        const cap = this.budgetHit(groupId, state);
        if (cap) {
          this.stopWith(groupId, epoch, cap);
          return;
        }
        const members = this.members(groupId);
        if (members.length === 0) {
          this.stopWith(groupId, epoch, "No one left to speak.");
          return;
        }

        if (pending?.askUser) {
          this.waitForUser(groupId, epoch);
          return;
        }
        if (pending?.done) {
          this.stopWith(groupId, epoch, "Task complete.");
          return;
        }
        if (pending?.next.length) {
          queue = guardNextMembers(resolveMembersByNames(members, pending.next), state.lastSpeakerId);
          pending = null;
        }

        if (queue.length === 0) {
          if (state.moderatorCalls >= GROUP_MAX_MODERATOR_CALLS) {
            this.stopWith(groupId, epoch, "Reached the turn budget (moderator calls).");
            return;
          }
          state.moderatorCalls += 1;
          const decision = await this.askModerator(groupId, state, members);
          if (!this.isCurrent(groupId, epoch)) return;
          const spoken = [...state.speakCount.values()].reduce((sum, n) => sum + n, 0);
          if ((decision.done || decision.askUser || decision.next.length === 0) && spoken === 0) {
            const pool = members.filter(
              (member) => !state.rescued.has(member.id) && member.id !== state.lastSpeakerId,
            );
            const pick = pool[0];
            if (!pick) {
              this.stopWith(groupId, epoch, "No one left to speak.");
              return;
            }
            state.rescued.add(pick.id);
            console.log(
              `[groups] ${groupId} moderator done ignored (no member posts yet), pick ${pick.name}`,
            );
            this.noteAssignment(groupId, `先请 ${pick.name} 开口。`);
            queue = [pick];
          } else if (decision.askUser) {
            this.waitForUser(groupId, epoch);
            return;
          } else if (decision.done || decision.next.length === 0) {
            this.stopWith(groupId, epoch, decision.reason || "No one left to speak.");
            return;
          } else {
            queue = resolveMembersByNames(members, decision.next);
            if (queue.length) {
              this.noteAssignment(
                groupId,
                decision.reason || `请 ${queue.map((member) => member.name).join("、")} 接着说。`,
              );
            }
          }
        }

        if (queue.length === 0) {
          this.stopWith(groupId, epoch, "No one left to speak.");
          return;
        }

        const batch = queue;
        queue = [];
        pending = null;
        let batchDone = false;
        let lastNext: string[] = [];

        for (const bot of batch) {
          if (!this.isCurrent(groupId, epoch)) return;
          const again = this.budgetHit(groupId, state);
          if (again) {
            this.stopWith(groupId, epoch, again);
            return;
          }
          const posts = await this.runOneTurn(groupId, bot, epoch);
          const spoken = posts.filter((post) => !isSilentPost(post)).length;
          if (spoken > 0) state.lastSpeakerId = bot.id;
          state.speakCount.set(bot.id, (state.speakCount.get(bot.id) ?? 0) + spoken);
          const signal = lastPostSignal(posts);
          if (signal.askUser) {
            this.waitForUser(groupId, epoch);
            return;
          }
          if (signal.done) {
            batchDone = true;
            break;
          }
          if (signal.next.length) lastNext = mergeNextNames(lastNext, signal.next);
          lastNext = mergeNextNames(lastNext, mentionNamesFromPosts(members, posts, bot.id));
        }

        if (batchDone) {
          this.stopWith(groupId, epoch, "Task complete.");
          return;
        }
        const totalSpoken = [...state.speakCount.values()].reduce((sum, n) => sum + n, 0);
        if (!lastNext.length && totalSpoken === 0) {
          for (const bot of batch) state.triedSilent.add(bot.id);
          state.silentRounds += 1;
          if (state.triedSilent.size >= members.length || state.silentRounds >= members.length) {
            this.stopWith(groupId, epoch, "Nobody was able to speak. Send again in a moment.");
            return;
          }
        }
        if (lastNext.length) pending = { next: lastNext, done: false, askUser: false };
      }
    } finally {
      this.setAssigning(groupId, false);
      if (this.activeLoop.get(groupId) === epoch) this.activeLoop.delete(groupId);
      if (!this.isTurnActive(groupId)) {
        this.broadcast({ type: "group_run", groupId, running: false });
      }
    }
  }

  private hostName(groupId: string): string {
    return this.getGroup(groupId)?.moderator_name?.trim() || "主持人";
  }

  private noteAssignment(groupId: string, reason: string) {
    const text = reason.trim();
    if (!text) return;
    const host = this.hostName(groupId);
    const line = text.startsWith(host) ? text : `${host}：${text}`;
    this.saveGroupMessage(groupId, host, line, null, "system");
  }

  private async askModerator(groupId: string, state: TurnState, members: BotRow[]) {
    const turnLines = this.turnSlice(groupId, this.promptLines(groupId));
    const speakCounts: Record<string, number> = {};
    for (const member of members) speakCounts[member.id] = state.speakCount.get(member.id) ?? 0;
    const group = this.getGroup(groupId);
    this.setAssigning(groupId, true);
    try {
      const decision = await moderate(
        this.profiles,
        {
          task: state.userTask,
          roster: members.map((member) => ({ id: member.id, name: member.name, role: member.role })),
          transcript: formatChatLines(
            lastMessages(turnLines, group?.moderator_history || GROUP_HISTORY_WINDOW),
          ),
          speakCounts,
          files: fileNamesFromLines(turnLines),
          lastSpeakerId: state.lastSpeakerId,
          extraInstructions: group?.moderator_instructions ?? "",
        },
        {
          profileId: group?.moderator_profile_id,
          maxTokens: group?.moderator_max_tokens,
          thinking: group?.moderator_thinking,
        },
      );
      console.log(
        `[groups] ${groupId} moderator source=${decision.source} next=[${decision.next.join(",")}] ask_user=${decision.askUser} reason=${decision.reason}`,
      );
      return decision;
    } finally {
      this.setAssigning(groupId, false);
    }
  }

  private handoffTargets(members: BotRow[], lines: ChatLine[]): BotRow[] {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].kind === "handoff") return resolveResponders(members, [{ ...lines[i], author: "You", kind: "text" }]);
    }
    return [];
  }

  private async runOneTurn(groupId: string, bot: BotRow, epoch: number): Promise<GroupPost[]> {
    if (!this.isCurrent(groupId, epoch)) return [];
    const group = this.getGroup(groupId);
    if (!group) return [];
    const channel = `group:${groupId}`;
    const seed = !this.bots.hasSession(bot.id, channel);
    const lines = this.promptLines(groupId);
    const roster = this.members(groupId);
    const prompt = seed
      ? buildGroupSeedPrompt(bot.name, group.name, roster, bot.id, lines)
      : buildGroupTurnPrompt(
          bot.name,
          group.name,
          lastMessages(messagesSinceLastSpoke(lines, bot.name), GROUP_HISTORY_WINDOW),
        );
    this.speaking.set(bot.id, groupId);
    let posts: GroupPost[] = [];
    try {
      posts = await this.bots.runGroupMemberTurn(bot.id, prompt, channel, group.name);
    } catch (err) {
      console.warn(`[groups] ${bot.name} turn failed: ${(err as Error).message}`);
      posts = [];
    } finally {
      if (this.speaking.get(bot.id) === groupId) this.speaking.delete(bot.id);
    }
    if (!this.isCurrent(groupId, epoch)) return posts;
    for (const post of posts) {
      if (post.persisted) continue;
      if (isSilentPost(post) || !post.text) continue;
      this.saveGroupMessage(groupId, bot.name, post.text, bot.id);
    }
    return posts;
  }

  private memberOf(groupId: string, botId: string): boolean {
    return this.members(groupId).some((member) => member.id === botId);
  }

  private sharedGroups(a: string, b: string): GroupRow[] {
    return db
      .prepare(
        `SELECT g.* FROM groups g
         JOIN group_members x ON x.group_id = g.id AND x.bot_id = ?
         JOIN group_members y ON y.group_id = g.id AND y.bot_id = ?
         ORDER BY COALESCE(
           (SELECT MAX(created_at) FROM group_messages WHERE group_id = g.id),
           g.created_at
         ) DESC`,
      )
      .all(a, b) as GroupRow[];
  }

  private mentionsGroup(name: string, message: string): boolean {
    if (!name) return false;
    if (/^[\w-]+$/.test(name)) {
      return new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(message);
    }
    return message.toLowerCase().includes(name.toLowerCase());
  }

  // 同群优先走群转交。1:1 假用户消息只留给完全没有共同群的情况。
  private resolveHandoffGroup(senderId: string, targetId: string, message: string): string | null {
    const speaking = this.speaking.get(senderId);
    if (speaking && this.memberOf(speaking, targetId)) return speaking;

    const channel = this.bots.currentChannel(senderId);
    if (channel.startsWith("group:")) {
      const groupId = channel.slice("group:".length);
      if (this.getGroup(groupId) && this.memberOf(groupId, targetId)) return groupId;
    }

    const shared = this.sharedGroups(senderId, targetId);
    if (shared.length === 0) return null;
    return shared.find((group) => this.mentionsGroup(group.name, message))?.id ?? shared[0].id;
  }

  private onTeammateHandoff(sender: BotRow, target: BotRow, message: string): boolean {
    const groupId = this.resolveHandoffGroup(sender.id, target.id, message);
    if (!groupId) return false;
    this.saveGroupMessage(groupId, sender.name, `→ @${target.name}\n${message}`, sender.id, "handoff");
    if (this.isTurnActive(groupId)) return true;
    this.turnOrigin.set(groupId, "handoff");
    void this.runGroupTurn(groupId);
    return true;
  }

  private turnSlice(groupId: string, lines: ChatLine[]): ChatLine[] {
    return this.turnOrigin.get(groupId) === "handoff"
      ? sliceFromLatestHandoff(lines)
      : sliceFromLatestUser(lines);
  }
}
