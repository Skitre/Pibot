// 群聊纯核心：无 IO。房间是共享 transcript；谁开口由编排器按轮次驱动。

export const GROUP_MIN_MEMBERS = 2;
export const GROUP_MAX_MEMBERS = 6;
/** 一轮用户发言后的成员发言硬顶（只数 text/handoff，不含工具卡）。 */
export const GROUP_MAX_MEMBER_TURNS = 40;
/** Soft preference only (prompt). Not a hard truncate — see takeGroupPosts. */
export const GROUP_MAX_MESSAGES_PER_TURN = 2;
export const GROUP_MAX_MODERATOR_CALLS = 12;
export const GROUP_MAX_WALL_MS = 20 * 60 * 1000;
export const GROUP_HISTORY_WINDOW = 24;
export const GROUP_MEMBER_TIMEOUT_MS = 360_000;

export interface ChatLine {
  author: string;
  content: string;
  kind?: string;
  botId?: string | null;
}

export interface GroupMember {
  id: string;
  name: string;
  role?: string;
}

export interface GroupPost {
  text: string;
  next: string[];
  done: boolean;
  persisted?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionRe(name: string): RegExp {
  return new RegExp(`@${escapeRegExp(name)}(?![\\p{L}\\p{N}_-])`, "iu");
}

export function hasEveryoneMention(text: string): boolean {
  return /@(?:everyone|all)(?![\p{L}\p{N}_-])/iu.test(text);
}

export function mentionKeysFor(memberName: string, allNames: string[]): string[] {
  const keys = [memberName, memberName.replace(/\s+/g, "")];
  const first = memberName.trim().split(/\s+/)[0] ?? "";
  if (first.length >= 2) {
    const unique =
      allNames.filter((name) => name.trim().split(/\s+/)[0].toLowerCase() === first.toLowerCase())
        .length === 1;
    if (unique) keys.push(first);
  }
  return [...new Set(keys.filter(Boolean))];
}

export function mentionedMembers<T extends GroupMember>(members: T[], text: string): T[] {
  const names = members.map((member) => member.name);
  return members.filter((member) =>
    mentionKeysFor(member.name, names).some((key) => mentionRe(key).test(text)),
  );
}

export function isPassContent(text: string): boolean {
  const value = text.trim().toLowerCase();
  return value === "" || value === "(pass)" || value === "(pass.)" || value === "pass";
}

export function isSendMessageTool(name: string): boolean {
  const normalized = name.replace(/[^a-zA-Z]/g, "").toLowerCase();
  return normalized === "sendmessage" || normalized === "sendgroupmessage";
}

export function isSpeechKind(kind?: string): boolean {
  const value = kind ?? "text";
  return value === "text" || value === "handoff";
}

export function normalizeNameList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,，、\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function parseGroupPost(args: unknown): GroupPost {
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  return {
    text: String(record.text ?? record.message ?? ""),
    next: normalizeNameList(record.next),
    done: record.done === true || record.done === "true",
  };
}

export function takeGroupPosts(sends: GroupPost[], fallback?: string): GroupPost[] {
  // 不在这里截断。send_message 在 interceptTool 里即时落库，截断会让
  // 房间里已出现的第 3 条上的 next/done 从编排器消失。落库条数、编排器
  // 看到的 posts、信号提取范围必须一致。单回合软限制只写在提示词里。
  if (sends.length > 0) return sends;
  const draft = (fallback ?? "").trim();
  if (!draft || isPassContent(draft)) return [];
  return [{ text: draft, next: [], done: false }];
}

export function mergeNextNames(into: string[], extra: string[]): string[] {
  const seen = new Set(into.map((name) => name.toLowerCase()));
  const out = [...into];
  for (const raw of extra) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export function lastPostSignal(posts: GroupPost[]): { next: string[]; done: boolean } {
  let next: string[] = [];
  let done = false;
  for (const post of posts) {
    if (post.done) done = true;
    if (post.next.length) next = mergeNextNames(next, post.next);
  }
  return { next, done };
}

export function resolveMembersByNames<T extends GroupMember>(members: T[], names: string[]): T[] {
  if (names.length === 0 || members.length === 0) return [];
  const needles = new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (needles.size === 0) return [];
  const rosterNames = members.map((member) => member.name);
  return members.filter((member) =>
    mentionKeysFor(member.name, rosterNames).some((key) => needles.has(key.toLowerCase())),
  );
}

/** 防连选：主持人/Bot next 不应再点上一位，除非花名册只剩此人。 */
export function guardNextMembers<T extends GroupMember>(
  picked: T[],
  lastSpeakerId: string | null,
): T[] {
  if (!lastSpeakerId || picked.length === 0) return picked;
  if (picked.length === 1 && picked[0].id === lastSpeakerId) return [];
  return picked.filter((member) => member.id !== lastSpeakerId);
}

export function sliceFromLatestUser(lines: ChatLine[]): ChatLine[] {
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].author === "You" && (lines[i].kind ?? "text") === "text") {
      start = i;
      break;
    }
  }
  return start < 0 ? lines : lines.slice(start);
}

/** 轮外 handoff 开的新轮：从最近一条转交起算，避免把上一轮用户的 @ 再喊一遍。 */
export function sliceFromLatestHandoff(lines: ChatLine[]): ChatLine[] {
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].kind === "handoff") {
      start = i;
      break;
    }
    if (lines[i].author === "You" && (lines[i].kind ?? "text") === "text") break;
  }
  return start < 0 ? sliceFromLatestUser(lines) : lines.slice(start);
}

/** 只处理显式 @ / @everyone。无 @ 返回空，交给主持人。 */
export function resolveResponders<T extends GroupMember>(
  members: T[],
  turnLines: ChatLine[],
  _allLines: ChatLine[] = turnLines,
): T[] {
  if (members.length === 0) return [];
  let user: ChatLine | undefined;
  for (let i = turnLines.length - 1; i >= 0; i--) {
    if (turnLines[i].author === "You" && (turnLines[i].kind ?? "text") === "text") {
      user = turnLines[i];
      break;
    }
  }
  if (!user) return [];
  if (hasEveryoneMention(user.content)) return [...members];
  return mentionedMembers(members, user.content);
}

export function lastMemberSpeaker<T extends GroupMember>(members: T[], lines: ChatLine[]): T | undefined {
  const byName = new Map(members.map((member) => [member.name, member]));
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!isSpeechKind(lines[i].kind)) continue;
    const hit = byName.get(lines[i].author);
    if (hit) return hit;
  }
  return undefined;
}

export function lastSpokeIndex(lines: ChatLine[], memberName: string): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].author === memberName && isSpeechKind(lines[i].kind)) return i;
  }
  return -1;
}

export function orderRoundSpeakers<T>(responders: T[], round: number): T[] {
  if (responders.length === 0) return [];
  const start = ((round % responders.length) + responders.length) % responders.length;
  return [...responders.slice(start), ...responders.slice(0, start)];
}

export function messagesSinceLastSpoke(lines: ChatLine[], memberName: string): ChatLine[] {
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].author === memberName && isSpeechKind(lines[i].kind)) {
      last = i;
      break;
    }
  }
  return last < 0 ? lines : lines.slice(last + 1);
}

export function lastMessages(lines: ChatLine[], n: number): ChatLine[] {
  return lines.length <= n ? lines : lines.slice(-n);
}

export function formatChatLines(lines: ChatLine[]): string {
  if (lines.length === 0) return "(no new messages)";
  return lines
    .map((line) => {
      const kind = line.kind ?? "text";
      const body = line.content.length > 800 ? `${line.content.slice(0, 800)}…` : line.content;
      if (kind === "system") return `[system] ${body}`;
      if (kind === "file") return `${line.author} shared file: ${body}`;
      if (kind === "tool") {
        const preview = body.replace(/\s+/g, " ").trim().slice(0, 120);
        return `${line.author} used a tool${preview ? `: ${preview}` : ""}`;
      }
      if (kind === "handoff") return `${line.author} (handoff): ${body}`;
      return `${line.author}: ${body}`;
    })
    .join("\n");
}

export function countMemberPosts(lines: ChatLine[]): number {
  return lines.filter((line) => line.author !== "You" && isSpeechKind(line.kind)).length;
}

export function latestUserTask(lines: ChatLine[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].author === "You" && (lines[i].kind ?? "text") === "text") return lines[i].content;
  }
  return "";
}

export function fileNamesFromLines(lines: ChatLine[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.kind !== "file") continue;
    const name = line.content.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function buildGroupMemberSystemPrompt(
  botName: string,
  groupName: string,
  roster: GroupMember[],
  selfId: string,
): string {
  const teammates = roster
    .map((member) => {
      const you = member.id === selfId ? " (you)" : "";
      const role = member.role ? ` — ${member.role}` : "";
      return `- @${member.name}${role}${you}`;
    })
    .join("\n");
  return [
    `You are ${botName} in the group thread "${groupName}".`,
    "This pi session is only this group. Your private 1:1 with the user is a separate session. Do not mention or leak that 1:1.",
    "Shared computer, files, and memory apply to both.",
    `Teammates:\n${teammates || "(none)"}`,
    "Speak only as yourself. Do not role-play other members or the user.",
    "Do the work with your usual tools first, then report progress with send_message.",
    "To post in this room, call the send_message tool. Raw assistant text is a private draft and is not shown unless you never call any tool.",
    "When your part is ready for a teammate, set next to their exact name(s). When the user's task is finished and nobody else needs to act, set done=true.",
    "Address a teammate with @Name only as extra context; the orchestrator follows send_message next/done, not @ guesses.",
    'If you have nothing to do, send_message with "(pass)" or stay silent.',
    "Prefer one or two room posts this turn. Put next or done on your last send_message — later posts still count.",
  ].join("\n");
}

export function buildGroupTurnPrompt(botName: string, groupName: string, newLines: ChatLine[]): string {
  return [
    `[Group thread "${groupName}"] You are ${botName}. New messages since you last spoke:`,
    "",
    formatChatLines(newLines),
    "",
    "Do the work, then report with send_message. Set next to the teammate who should take over, or done=true if the task is finished. (pass) if you have nothing to do.",
  ].join("\n");
}

export function buildGroupSeedPrompt(
  botName: string,
  groupName: string,
  roster: GroupMember[],
  selfId: string,
  history: ChatLine[],
): string {
  return [
    buildGroupMemberSystemPrompt(botName, groupName, roster, selfId),
    "",
    "Group transcript so far:",
    formatChatLines(lastMessages(history, GROUP_HISTORY_WINDOW)),
    "",
    "Do the work, then report with send_message. Set next to the teammate who should take over, or done=true if the task is finished. (pass) if you have nothing to do.",
  ].join("\n");
}
