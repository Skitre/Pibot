import { ModelProfileStore } from "./model-profiles.js";
import { guardNextMembers, normalizeNameList, resolveMembersByNames, type GroupMember } from "./group-chat.js";

export interface ModeratorInput {
  task: string;
  roster: GroupMember[];
  transcript: string;
  speakCounts: Record<string, number>;
  files: string[];
  lastSpeakerId?: string | null;
}

export interface ModeratorDecision {
  next: string[];
  done: boolean;
  reason: string;
  source: "llm" | "fallback";
}

const SYSTEM = [
  "You are the silent moderator of a small Bot work group.",
  "Decide who should act next, or whether the user's task is finished.",
  "Reply with JSON only, no markdown:",
  '{"next":["ExactName"],"done":false,"reason":"one short sentence"}',
  "Rules:",
  "- next names must be exact roster names.",
  "- Prefer one next speaker. Use multiple only when they must work in sequence.",
  "- Do not pick the last speaker if someone else can continue.",
  "- done=true only when the user's task is complete or nobody can usefully continue.",
  "- If done=true, next must be [].",
].join("\n");

function fallback(input: ModeratorInput): ModeratorDecision {
  const unspoken = input.roster.filter((member) => (input.speakCounts[member.id] ?? 0) === 0);
  const guarded = guardNextMembers(unspoken, input.lastSpeakerId ?? null);
  if (guarded.length === 0) {
    return { next: [], done: true, reason: "No one left to speak.", source: "fallback" };
  }
  return {
    next: [guarded[0].name],
    done: false,
    reason: `Ask ${guarded[0].name}, who has not spoken yet.`,
    source: "fallback",
  };
}

function parseDecision(text: string): { next: string[]; done: boolean; reason: string } | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { next?: unknown; done?: unknown; reason?: unknown };
    return {
      next: normalizeNameList(obj.next),
      done: obj.done === true || obj.done === "true",
      reason: String(obj.reason ?? "").trim(),
    };
  } catch {
    return null;
  }
}

function validate(
  parsed: { next: string[]; done: boolean; reason: string },
  input: ModeratorInput,
): ModeratorDecision {
  if (parsed.done) {
    return {
      next: [],
      done: true,
      reason: parsed.reason || "Task complete.",
      source: "llm",
    };
  }
  const resolved = resolveMembersByNames(input.roster, parsed.next);
  const guarded = guardNextMembers(resolved, input.lastSpeakerId ?? null);
  if (guarded.length === 0) return fallback(input);
  return {
    next: guarded.map((member) => member.name),
    done: false,
    reason: parsed.reason || `Next: ${guarded.map((member) => member.name).join(", ")}`,
    source: "llm",
  };
}

function buildUserPrompt(input: ModeratorInput): string {
  const roster = input.roster
    .map((member) => {
      const role = member.role ? ` — ${member.role}` : "";
      const n = input.speakCounts[member.id] ?? 0;
      return `- ${member.name}${role} (spoke ${n} time${n === 1 ? "" : "s"})`;
    })
    .join("\n");
  const last = input.roster.find((member) => member.id === input.lastSpeakerId);
  return [
    `User task:\n${input.task || "(not specified)"}`,
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

export async function moderate(profiles: ModelProfileStore, input: ModeratorInput): Promise<ModeratorDecision> {
  if (input.roster.length === 0) {
    return { next: [], done: true, reason: "No one left to speak.", source: "fallback" };
  }
  const profile = profiles.getDefault();
  if (!profile) return fallback(input);
  try {
    const result = await profiles.complete(
      profile,
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: buildUserPrompt(input) },
      ],
      { maxTokens: 512, timeoutMs: 15_000 },
    );
    if (!result.ok) return fallback(input);
    const parsed = parseDecision(result.text);
    if (!parsed) return fallback(input);
    return validate(parsed, input);
  } catch (err) {
    console.warn(`[moderator] failed: ${(err as Error).message}`);
    return fallback(input);
  }
}
