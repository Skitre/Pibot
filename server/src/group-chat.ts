// 群聊纯核心：无 IO。房间是共享 transcript；谁开口由编排器按轮次驱动。
import { AUTONOMY } from "./prompts/sections.js";

export const GROUP_MIN_MEMBERS = 2;
export const GROUP_MAX_MEMBERS = 6;
/** 一轮用户发言后的成员发言硬顶（只数 text/handoff，不含工具卡）。 */
export const GROUP_MAX_MEMBER_TURNS = 40;
/** Per-member room-post cap, enforced in interceptTool (not takeGroupPosts). */
export const GROUP_MAX_MESSAGES_PER_TURN = 8;
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
  pass: boolean;
  askUser: boolean;
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

/** Visible posts only. @Name / @everyone pull teammates the same way next does. */
export function mentionNamesFromPosts(
  members: GroupMember[],
  posts: GroupPost[],
  exceptId?: string,
): string[] {
  const names: string[] = [];
  for (const post of posts) {
    if (isSilentPost(post)) continue;
    const hits = hasEveryoneMention(post.text)
      ? members
      : mentionedMembers(members, post.text);
    for (const member of hits) {
      if (exceptId && member.id === exceptId) continue;
      names.push(member.name);
    }
  }
  return names;
}

export function isPassContent(text: string): boolean {
  const value = text.trim().toLowerCase();
  return value === "" || value === "(pass)" || value === "(pass.)" || value === "pass";
}

/** Structured pass wins; literal (pass) remains a fallback for older models. */
export function isSilentPost(post: Pick<GroupPost, "text" | "pass">): boolean {
  return post.pass === true || isPassContent(post.text);
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
    pass: record.pass === true || record.pass === "true",
    askUser: record.ask_user === true || record.ask_user === "true" || record.askUser === true,
  };
}

export function takeGroupPosts(sends: GroupPost[], fallback?: string): GroupPost[] {
  // 不在这里截断。send_message 在 interceptTool 里即时落库，截断会让
  // 房间里已出现的第 3 条上的 next/done 从编排器消失。落库条数、编排器
  // 看到的 posts、信号提取范围必须一致。单回合软限制只写在提示词里。
  if (sends.length > 0) return sends;
  const draft = (fallback ?? "").trim();
  if (!draft || isPassContent(draft)) return [];
  return [{ text: draft, next: [], done: false, pass: false, askUser: false }];
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

export function lastPostSignal(posts: GroupPost[]): { next: string[]; done: boolean; askUser: boolean } {
  let next: string[] = [];
  let done = false;
  let askUser = false;
  for (const post of posts) {
    if (post.done) done = true;
    if (post.next.length) next = mergeNextNames(next, post.next);
    // pass 没有正文，问人无效。
    if (post.askUser && !isSilentPost(post)) askUser = true;
  }
  return { next, done, askUser };
}

/** 模型常把花名册整行抄回来（「名字 — 角色」「名字（角色）」），精确匹配不到就退到分隔符前一段。 */
function nameNeedles(raw: string): string[] {
  const full = raw.trim();
  if (!full) return [];
  const head = full.split(/\s*[—–\-(（:：]/, 1)[0].trim();
  const out = [full.toLowerCase()];
  if (head && head !== full) out.push(head.toLowerCase());
  return out;
}

export function resolveMembersByNames<T extends GroupMember>(members: T[], names: string[]): T[] {
  if (names.length === 0 || members.length === 0) return [];
  const rosterNames = members.map((member) => member.name);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const raw of names) {
    const needles = nameNeedles(raw);
    if (needles.length === 0) continue;
    let hit: T | undefined;
    for (const needle of needles) {
      hit = members.find((member) =>
        mentionKeysFor(member.name, rosterNames).some((key) => key.toLowerCase() === needle),
      );
      if (hit) break;
    }
    if (!hit || seen.has(hit.id)) continue;
    seen.add(hit.id);
    out.push(hit);
  }
  return out;
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

/** 开场只看用户（或 handoff）那一句的 @ / @everyone。无 @ 返回空，交给主持人。成员正文里的 @ 由 mentionNamesFromPosts 并进 next。 */
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

/** 落库仍是 You；提示词里必须写成 User。You are Judy + You: 大家好 会被模型认成自己已经说过。 */
function promptAuthor(author: string): string {
  return author === "You" ? "User" : author;
}

export function formatChatLines(lines: ChatLine[]): string {
  if (lines.length === 0) return "(no new messages)";
  return lines
    .map((line) => {
      const kind = line.kind ?? "text";
      const who = promptAuthor(line.author);
      const body = line.content.length > 800 ? `${line.content.slice(0, 800)}…` : line.content;
      if (kind === "system") return `[system] ${body}`;
      if (kind === "file") return `${who} shared file: ${body}`;
      if (kind === "tool") {
        const preview = body.replace(/\s+/g, " ").trim().slice(0, 120);
        return `${who} used a tool${preview ? `: ${preview}` : ""}`;
      }
      if (kind === "handoff") return `${who} (handoff): ${body}`;
      return `${who}: ${body}`;
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
  description = "",
): string {
  const teammates = roster
    .map((member) => {
      const you = member.id === selfId ? " (you)" : "";
      const role = member.role ? ` — ${member.role}` : "";
      return `- @${member.name}${role}${you}`;
    })
    .join("\n");
  const desc = description.trim();
  return [
    `You are ${botName} in the group thread "${groupName}".`,
    ...(desc ? [`Thread description: ${desc}`] : []),
    "In the transcript, the human user is labeled User. That is not you.",
    "This pi session is only this group. Your private 1:1 with the user is a separate session. Do not mention or leak that 1:1.",
    "Shared computer, files, and memory apply to both.",
    `Teammates:\n${teammates || "(none)"}`,
    "Speak only as yourself. Do not role-play other members or the user.",
    "When there is work to do, use your usual tools first, then report with send_message.",
    "To post in this room, call the send_message tool. Raw assistant text is a private draft and is not shown unless you never call any tool.",
    "If you were asked to speak and you have something to say — even a short reply to the user — send_message with that text. Set pass=true only when you truly have nothing to add; the text is then ignored and never shown.",
    "If the user just wrote to the group and did not @ anyone, answer them. Do not all pass and leave the user hanging.",
    "Reply in the same language the user is using.",
    "How you talk in the room:",
    "- Keep each message short and conversational — usually one to three sentences. Do not monologue or summarize the whole thread.",
    "- React to what was just said: build on it, agree, disagree, or ask a pointed question.",
    "- Write @Name to pull that teammate in, or @everyone for the whole room. The orchestrator follows @ in your post the same way it follows next. You may still set next to their exact name(s).",
    "- Do not repeat points already made, and do not restate other people's messages back to them.",
    "- If you have nothing new worth adding, set pass=true. Staying quiet is good — it lets the conversation settle.",
    AUTONOMY,
    "If they asked for prep, deliver that and set done=true instead of launching extra workstreams.",
    "When nothing useful remains for anyone, set done=true.",
    "Prefer one or two room posts this turn. Put next, done, or pass on your last send_message — later posts still count.",
  ].join("\n");
}

export function buildGroupTurnPrompt(botName: string, groupName: string, newLines: ChatLine[]): string {
  return [
    `[Group thread "${groupName}"] You are ${botName}. New messages since you last spoke:`,
    "",
    formatChatLines(newLines),
    "",
    "If you have something to say, send_message in the user's language — short, a reaction to what was just said, no recap. Write @Name to pull a teammate in. Set pass=true only when you have nothing to add. Set next to a teammate who should continue. Set ask_user=true only for a consequential/undo-hard action, true ambiguity you cannot look up, or something only the user knows — otherwise decide, proceed, and mention the assumption. Set done=true when nothing useful remains.",
  ].join("\n");
}

export function buildGroupSeedPrompt(
  botName: string,
  groupName: string,
  roster: GroupMember[],
  selfId: string,
  history: ChatLine[],
  description = "",
): string {
  return [
    buildGroupMemberSystemPrompt(botName, groupName, roster, selfId, description),
    "",
    "Group transcript so far:",
    formatChatLines(lastMessages(history, GROUP_HISTORY_WINDOW)),
    "",
    "If you have something to say, send_message in the user's language — short, a reaction to what was just said, no recap. Write @Name to pull a teammate in. Set pass=true only when you have nothing to add. Set next to a teammate who should continue. Set ask_user=true only for a consequential/undo-hard action, true ambiguity you cannot look up, or something only the user knows — otherwise decide, proceed, and mention the assumption. Set done=true when nothing useful remains.",
  ].join("\n");
}
