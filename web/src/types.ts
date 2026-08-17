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
export const DEFAULT_THINKING_LEVEL_MAP_JSON = JSON.stringify(
  DEFAULT_THINKING_LEVEL_MAP,
  null,
  2,
);

export function parseThinkingLevelMap(value: string): ThinkingLevelMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim() || "{}");
  } catch {
    throw new Error("JSON 格式无效");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("必须是 JSON 对象");
  }
  const result: ThinkingLevelMap = {};
  for (const [key, mapped] of Object.entries(parsed)) {
    if (!(THINKING_LEVELS as readonly string[]).includes(key)) {
      throw new Error(`未知档位：${key}`);
    }
    if (mapped !== null && (typeof mapped !== "string" || !mapped.trim())) {
      throw new Error(`${key} 必须是非空字符串或 null`);
    }
    result[key as ThinkingLevel] = typeof mapped === "string" ? mapped.trim() : null;
  }
  return result;
}

export function supportedThinkingLevels(reasoning: boolean, mapJson: string): ThinkingLevel[] {
  if (!reasoning) return ["off"];
  let map: ThinkingLevelMap = {};
  try {
    map = parseThinkingLevelMap(mapJson);
  } catch {
    // 表单输入尚未完成时仍保留基础档位，保存时会给出明确错误。
  }
  return THINKING_LEVELS.filter((level) => {
    const mapped = map[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export function clampThinkingLevel(
  reasoning: boolean,
  mapJson: string,
  requested: string,
): ThinkingLevel {
  const available = supportedThinkingLevels(reasoning, mapJson);
  const level = (THINKING_LEVELS as readonly string[]).includes(requested)
    ? (requested as ThinkingLevel)
    : "off";
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

export interface Bot {
  id: string;
  name: string;
  role: string;
  avatar_color: string;
  avatar_shape?: string | null;
  container_id: string | null;
  vnc_port: number | null;
  bridge_port: number | null;
  status: string;
  created_at: number;
  pinned: number;
  hidden: number;
  last_message: string;
  last_activity: number;
  needs_attention: number;
  model_profile_id: string | null;
  thinking_override: ThinkingLevel | null;
}

export interface Message {
  id: number;
  bot_id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  author: string;
  content: string;
  kind: "text" | "tool" | "approval" | "system" | "file";
  meta: string | null;
  created_at: number;
}

export interface Routine {
  id: string;
  bot_id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: number;
  created_at: number;
  last_run: number | null;
}

export interface ModelProfile {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  api: string;
  model_id: string;
  model_name: string;
  reasoning: number;
  vision: number;
  vision_profile_id: string | null;
  thinking: string;
  thinking_level_map: string;
  context_window: number;
  max_tokens: number;
  is_default: number;
  created_at: number;
}

export interface ProfileInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  api: string;
  modelId: string;
  modelName: string;
  reasoning: boolean;
  vision: boolean;
  visionProfileId: string | null;
  thinking: string;
  thinkingLevelMap: string;
  contextWindow: number;
  maxTokens: number;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  bot_ids?: string[];
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

/** 主持人覆盖项：数字 0 与空字符串都表示继承。 */
export interface GroupModeratorInput {
  name?: string;
  profileId?: string | null;
  instructions?: string;
  maxTokens?: number;
  history?: number;
  thinking?: string;
}

export interface GroupMessage {
  id: number;
  group_id: string;
  bot_id: string | null;
  author: string;
  content: string;
  kind: string;
  meta?: string | null;
  created_at: number;
}

export interface Attachment {
  name: string;
  path: string;
  size: number;
  mime: string;
}

// 共享电脑：整个账户一台，所有 Bot 的会话都跑在里面
export interface Computer {
  containerId: string | null;
  status: "offline" | "starting" | "online";
  vncPort: number;
}

// Skill：跨 Bot 共享的"做事方法"，composer 里 /slug 引用
export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  content: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface BotSkill extends Skill {
  enabled: number;
}

export interface BotSettings {
  bot: Bot;
  modelProfileId: string | null;
  thinkingOverride: ThinkingLevel | null;
  skills: BotSkill[];
}

export interface BotSettingsInput {
  modelProfileId: string | null;
  thinkingOverride: ThinkingLevel | null;
  skillIds: string[];
}

export interface SearchHit {
  id: number;
  bot_id: string;
  bot_name: string;
  content: string;
  created_at: number;
}

export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  enabled: number;
  default_policy: "auto" | "ask" | "allow";
  tool_config: string;
  discovered_tools: string;
  last_status: "unknown" | "testing" | "connected" | "error";
  last_error: string;
  last_checked_at: number | null;
  created_at: number;
}

export interface DiscoveredMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
}

export type McpToolConfig = Record<string, { enabled: boolean }>;

export interface McpServerInput {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  defaultPolicy?: "auto" | "ask" | "allow";
  toolConfig?: McpToolConfig;
}

export interface ApprovalRule {
  id: string;
  action: "require" | "allow";
  server_id: string;
  tool_name: string;
  created_at: number;
}

export interface ApprovalRuleInput {
  action: "require" | "allow";
  serverId: string;
  toolName?: string;
}

export interface ApprovalMeta {
  requestId: string;
  method: "select" | "confirm" | "input";
  message: string;
  options: string[];
  placeholder?: string;
  resolved?: boolean;
  decision?: string | boolean;
}

export interface ToolMeta {
  toolName: string;
  isError: boolean;
  toolCallId: string;
}

export interface FileMeta {
  name: string;
  path: string;
  size: number;
  mime: string;
}
