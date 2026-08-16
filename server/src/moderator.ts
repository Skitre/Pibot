import { ModelProfileStore } from "./model-profiles.js";
import { guardNextMembers, normalizeNameList, resolveMembersByNames, type GroupMember } from "./group-chat.js";

export interface ModeratorInput {
  task: string;
  roster: GroupMember[];
  transcript: string;
  speakCounts: Record<string, number>;
  files: string[];
  lastSpeakerId?: string | null;
  extraInstructions?: string;
}

export interface ModeratorDecision {
  next: string[];
  done: boolean;
  askUser: boolean;
  reason: string;
  source: "llm" | "fallback";
}

const SYSTEM = [
  "You are the silent moderator of a small Bot group room.",
  "Decide who should speak or act next, whether to wait for the human, or whether the conversation can stop.",
  "Reply with JSON only, no markdown:",
  '{"next":["ExactName"],"done":false,"ask_user":false,"reason":"one short sentence"}',
  "Rules:",
  "- next names must be copied exactly from the quoted roster names, without the role. Multiple names run in that order.",
  "- Invite as many people as the latest user message calls for: one, several, or the whole roster.",
  "- Prefer inviting one extra person over leaving the user unanswered. Members can pass; a missed invite leaves the user hanging.",
  "- Do not pick the last speaker if someone else can continue.",
  "- Default is to keep the room moving or stop. ask_user is rare, earned by only three things: a consequential or hard-to-undo action; true ambiguity that cannot be looked up; or something only the user knows.",
  "- ask_user=true when a member just asked the human one of those three, or the bots are about to take such an action without asking. Then next must be [] and done=false.",
  "- Do not set ask_user because they picked a name, a theme, or an equivalent approach the user did not specify — that is theirs to assume. Do not set ask_user on greetings, a brief \"want me to also…?\" offer, while the user's request is still being executed, or for bot-to-bot handoffs and reviews.",
  "- If they have finished what the user asked and are inventing extra work, set done=true rather than ask_user.",
  "- done=true only when nothing useful remains to say or do.",
  "- If done=true, next must be [] and ask_user must be false.",
  "- Write reason in the same language as the latest user message; it is shown in the room.",
].join("\n");

function systemPrompt(extra?: string): string {
  const note = extra?.trim();
  if (!note) return SYSTEM;
  return `${SYSTEM}\n- Extra instructions for this room:\n${note}`;
}

/** why 只进日志：三条降级路径的对外表现完全一样，不记原因就分不清是接口错、解析失败还是点名无效。 */
function fallback(input: ModeratorInput, why: string): ModeratorDecision {
  console.warn(`[moderator] fallback: ${why}`);
  const unspoken = input.roster.filter((member) => (input.speakCounts[member.id] ?? 0) === 0);
  const guarded = guardNextMembers(unspoken, input.lastSpeakerId ?? null);
  if (guarded.length === 0) {
    return { next: [], done: true, askUser: false, reason: "No one left to speak.", source: "fallback" };
  }
  return {
    next: [guarded[0].name],
    done: false,
    askUser: false,
    reason: `Ask ${guarded[0].name}, who has not spoken yet.`,
    source: "fallback",
  };
}

function parseDecision(text: string): { next: string[]; done: boolean; askUser: boolean; reason: string } | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      next?: unknown;
      done?: unknown;
      ask_user?: unknown;
      askUser?: unknown;
      reason?: unknown;
    };
    return {
      next: normalizeNameList(obj.next),
      done: obj.done === true || obj.done === "true",
      askUser: obj.ask_user === true || obj.ask_user === "true" || obj.askUser === true,
      reason: String(obj.reason ?? "").trim(),
    };
  } catch {
    return null;
  }
}

function validate(
  parsed: { next: string[]; done: boolean; askUser: boolean; reason: string },
  input: ModeratorInput,
): ModeratorDecision {
  if (parsed.askUser) {
    return {
      next: [],
      done: false,
      askUser: true,
      reason: parsed.reason || "Waiting for the user.",
      source: "llm",
    };
  }
  if (parsed.done) {
    return {
      next: [],
      done: true,
      askUser: false,
      reason: parsed.reason || "Task complete.",
      source: "llm",
    };
  }
  const resolved = resolveMembersByNames(input.roster, parsed.next);
  const guarded = guardNextMembers(resolved, input.lastSpeakerId ?? null);
  if (guarded.length === 0) {
    return fallback(input, `next=[${parsed.next.join(",")}] resolved to nobody usable`);
  }
  return {
    next: guarded.map((member) => member.name),
    done: false,
    askUser: false,
    reason: parsed.reason || `Next: ${guarded.map((member) => member.name).join(", ")}`,
    source: "llm",
  };
}

function buildUserPrompt(input: ModeratorInput): string {
  const roster = input.roster
    .map((member) => {
      const role = member.role ? `, role: ${member.role}` : "";
      const n = input.speakCounts[member.id] ?? 0;
      return `- "${member.name}" (spoke ${n} time${n === 1 ? "" : "s"}${role})`;
    })
    .join("\n");
  const last = input.roster.find((member) => member.id === input.lastSpeakerId);
  return [
    `Latest user message:\n${input.task || "(not specified)"}`,
    "",
    `Roster:\n${roster || "(none)"}`,
    "",
    `Last speaker: ${last?.name ?? "(none)"}`,
    `Files produced: ${input.files.length ? input.files.join(", ") : "(none)"}`,
    "",
    "Recent transcript:",
    input.transcript || "(empty)",
  ].join("\n");
}

export interface ModeratorOptions {
  profileId?: string | null;
  /** 0 或省略表示跟随所选档案的「最大输出 tokens」 */
  maxTokens?: number;
  /** 空表示不发送思考参数，保持端点默认 */
  thinking?: string;
}

export async function moderate(
  profiles: ModelProfileStore,
  input: ModeratorInput,
  opts?: ModeratorOptions,
): Promise<ModeratorDecision> {
  if (input.roster.length === 0) {
    return { next: [], done: true, askUser: false, reason: "No one left to speak.", source: "fallback" };
  }
  const profile = (opts?.profileId ? profiles.get(opts.profileId) : undefined) ?? profiles.getDefault();
  if (!profile) return fallback(input, "no model profile configured");
  try {
    const result = await profiles.complete(
      profile,
      [
        { role: "system", content: systemPrompt(input.extraInstructions) },
        { role: "user", content: buildUserPrompt(input) },
      ],
      {
        timeoutMs: 25_000,
        ...(opts?.maxTokens ? { maxTokens: opts.maxTokens } : {}),
        ...(opts?.thinking ? { thinking: opts.thinking } : {}),
      },
    );
    if (!result.ok) return fallback(input, `api error: ${result.detail.slice(0, 200)}`);
    const parsed = parseDecision(result.text);
    if (!parsed) {
      return fallback(input, `unparseable reply (${result.detail}): ${result.text.slice(0, 200)}`);
    }
    return validate(parsed, input);
  } catch (err) {
    return fallback(input, `threw: ${(err as Error).message}`);
  }
}
