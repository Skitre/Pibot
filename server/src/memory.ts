export const MEMORY_KINDS = ["preference", "fact", "work"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const WORK_CAP = 15;

export const WORK_TOOLS = new Set([
  "write",
  "edit",
  "bash",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_screenshot",
  "browser_read",
  "computer_screenshot",
  "message_teammate",
  "save_skill",
  "mcp_call",
]);

const SECTION_ORDER = ["Preferences", "Facts", "Work"] as const;

interface Section {
  title: string;
  body: string;
}

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === "string" && (MEMORY_KINDS as readonly string[]).includes(value);
}

export function oneLine(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

export function workStamp(now = new Date()): string {
  return `${now.getMonth() + 1}/${now.getDate()}`;
}

function parseAgentsMd(raw: string): { preamble: string; sections: Section[] } {
  const text = raw.replace(/\r\n/g, "\n");
  const matches = [...text.matchAll(/^## (.+)$/gm)];
  if (matches.length === 0) return { preamble: text.trimEnd(), sections: [] };
  const preamble = text.slice(0, matches[0].index).trimEnd();
  const sections = matches.map((match, i) => {
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    return {
      title: match[1].trim(),
      body: text.slice(start, end).replace(/^\n/, "").trimEnd(),
    };
  });
  return { preamble, sections };
}

function rebuildAgentsMd(preamble: string, sections: Section[]): string {
  let out = preamble.trimEnd() ? `${preamble.trimEnd()}\n\n` : "";
  for (const section of sections) {
    out += `## ${section.title}\n`;
    if (section.body.trim()) out += `${section.body.trimEnd()}\n`;
    out += "\n";
  }
  return `${out.trimEnd()}\n`;
}

function findSection(sections: Section[], title: string): Section | undefined {
  return sections.find((section) => section.title.toLowerCase() === title.toLowerCase());
}

export function normalizeAgentsMd(raw: string): string {
  const { preamble, sections } = parseAgentsMd(raw || "");
  const memory = findSection(sections, "Memory");
  const next: Section[] = [];
  for (const title of SECTION_ORDER) {
    const existing = findSection(sections, title);
    next.push(existing ? { title, body: existing.body } : { title, body: "" });
  }
  if (memory?.body.trim()) {
    const facts = findSection(next, "Facts")!;
    facts.body = [facts.body.trim(), memory.body.trim()].filter(Boolean).join("\n");
  }
  for (const section of sections) {
    const known =
      SECTION_ORDER.some((title) => title.toLowerCase() === section.title.toLowerCase()) ||
      section.title.toLowerCase() === "memory";
    if (!known) next.push(section);
  }
  return rebuildAgentsMd(preamble, next);
}

function insertBullet(raw: string, kind: MemoryKind, note: string, cap?: number): string {
  const md = normalizeAgentsMd(raw);
  const { preamble, sections } = parseAgentsMd(md);
  const title = kind === "preference" ? "Preferences" : kind === "work" ? "Work" : "Facts";
  const section = findSection(sections, title)!;
  const item = `- ${oneLine(note)}`;
  const bullets = section.body.split("\n").filter((line) => line.trim());
  if (bullets[bullets.length - 1] === item) return md;
  bullets.push(item);
  if (cap && bullets.length > cap) bullets.splice(0, bullets.length - cap);
  section.body = bullets.join("\n");
  return rebuildAgentsMd(preamble, sections);
}

export function addMemoryNote(raw: string, kind: MemoryKind, note: string): string {
  return insertBullet(raw, kind, note, kind === "work" ? WORK_CAP : undefined);
}

export function addWorkSummary(raw: string, channelLabel: string, summary: string, now = new Date()): string {
  const text = oneLine(summary).slice(0, 160);
  if (!text) return normalizeAgentsMd(raw);
  return addMemoryNote(raw, "work", `[${workStamp(now)} ${channelLabel}] ${text}`);
}
