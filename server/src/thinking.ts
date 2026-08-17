export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

export const DEFAULT_THINKING_LEVEL_MAP: ThinkingLevelMap = Object.fromEntries(
  THINKING_LEVELS.map((level) => [level, level]),
) as ThinkingLevelMap;
export const DEFAULT_THINKING_LEVEL_MAP_JSON = JSON.stringify(DEFAULT_THINKING_LEVEL_MAP);

const THINKING_LEVEL_SET = new Set<string>(THINKING_LEVELS);

export class ThinkingLevelMapError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ThinkingLevelMapError";
  }
}

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVEL_SET.has(value);
}

/** Parse the same map shape accepted by pi-sdk's Model.thinkingLevelMap. */
export function parseThinkingLevelMap(value: unknown): ThinkingLevelMap {
  if (value === undefined || value === null || value === "") return {};
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ThinkingLevelMapError("thinkingLevelMap must be valid JSON");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ThinkingLevelMapError("thinkingLevelMap must be a JSON object");
  }

  const result: ThinkingLevelMap = {};
  for (const [key, mapped] of Object.entries(parsed)) {
    if (!isThinkingLevel(key)) {
      throw new ThinkingLevelMapError(`unsupported thinking level in map: ${key}`);
    }
    if (mapped !== null && (typeof mapped !== "string" || !mapped.trim())) {
      throw new ThinkingLevelMapError(
        `thinkingLevelMap.${key} must be a non-empty string or null`,
      );
    }
    result[key] = typeof mapped === "string" ? mapped.trim() : null;
  }
  return result;
}

export function safeThinkingLevelMap(value: unknown): ThinkingLevelMap {
  try {
    return parseThinkingLevelMap(value);
  } catch {
    return {};
  }
}

/** Mirrors pi-sdk getSupportedThinkingLevels for the custom model registered by Pibot. */
export function supportedThinkingLevels(
  reasoning: boolean,
  map: ThinkingLevelMap,
): ThinkingLevel[] {
  if (!reasoning) return ["off"];
  return THINKING_LEVELS.filter((level) => {
    const mapped = map[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

/** Mirrors pi-sdk clampThinkingLevel so stored/UI values agree with the running session. */
export function clampThinkingLevel(
  reasoning: boolean,
  map: ThinkingLevelMap,
  requested: unknown,
): ThinkingLevel {
  const available = supportedThinkingLevels(reasoning, map);
  const level = isThinkingLevel(requested) ? requested : "off";
  if (available.includes(level)) return level;
  const index = THINKING_LEVELS.indexOf(level);
  for (let i = index; i < THINKING_LEVELS.length; i += 1) {
    if (available.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
  }
  for (let i = index - 1; i >= 0; i -= 1) {
    if (available.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
  }
  return available[0] ?? "off";
}
