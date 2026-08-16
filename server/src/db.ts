import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";

mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(join(DATA_DIR, "pibot.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#F59E0B',
  avatar_shape TEXT,
  container_id TEXT,
  vnc_port INTEGER,
  bridge_port INTEGER,
  status TEXT NOT NULL DEFAULT 'stopped',
  created_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  last_message TEXT NOT NULL DEFAULT '',
  last_activity INTEGER NOT NULL DEFAULT 0,
  needs_attention INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  thread_id TEXT NOT NULL DEFAULT 'main',
  role TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_bot ON messages(bot_id, thread_id, id);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_run INTEGER
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  moderator_name TEXT NOT NULL DEFAULT '主持人',
  moderator_profile_id TEXT,
  moderator_instructions TEXT NOT NULL DEFAULT '',
  -- 0 / '' 表示继承所选模型档案或系统默认
  moderator_max_tokens INTEGER NOT NULL DEFAULT 0,
  moderator_history INTEGER NOT NULL DEFAULT 0,
  moderator_thinking TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  PRIMARY KEY (group_id, bot_id)
);
CREATE TABLE IF NOT EXISTS group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  bot_id TEXT,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_messages ON group_messages(group_id, id);

-- LLM 配置档案：可保存多套中转/模型，供不同 Bot 分别使用
CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  reasoning INTEGER NOT NULL DEFAULT 0,
  thinking TEXT NOT NULL DEFAULT 'off',
  context_window INTEGER NOT NULL DEFAULT 200000,
  max_tokens INTEGER NOT NULL DEFAULT 65536,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Skill：可复用的"做事方法"，跨 Bot 共享；composer 里 /slug 引用，发送时注入 prompt
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Bot 级 Skill 开关。没有映射时默认启用，以兼容已有 Bot。
CREATE TABLE IF NOT EXISTS bot_skills (
  bot_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (bot_id, skill_id)
);

-- MCP servers：账户级配置，所有 Bot 共用；stdio 进程运行在共享电脑容器内。
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  command TEXT NOT NULL DEFAULT '',
  args TEXT NOT NULL DEFAULT '[]',
  env TEXT NOT NULL DEFAULT '{}',
  url TEXT NOT NULL DEFAULT '',
  headers TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  default_policy TEXT NOT NULL DEFAULT 'auto',
  tool_config TEXT NOT NULL DEFAULT '{}',
  discovered_tools TEXT NOT NULL DEFAULT '[]',
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT NOT NULL DEFAULT '',
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_rules (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  server_id TEXT NOT NULL,
  tool_name TEXT NOT NULL DEFAULT '*',
  created_at INTEGER NOT NULL,
  UNIQUE(server_id, tool_name)
);

-- Bot workspace 下的 pi session：main=私聊，group:<id>=该 Bot 在某个群的会话
CREATE TABLE IF NOT EXISTS bot_sessions (
  bot_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  session_path TEXT NOT NULL,
  PRIMARY KEY (bot_id, channel)
);
`);

// 迁移：给已有的 bots 表补 model_profile_id 列
const botCols = db.prepare("PRAGMA table_info(bots)").all() as { name: string }[];
if (!botCols.some((c) => c.name === "model_profile_id")) {
  db.exec("ALTER TABLE bots ADD COLUMN model_profile_id TEXT");
}
if (!botCols.some((c) => c.name === "thinking_override")) {
  db.exec("ALTER TABLE bots ADD COLUMN thinking_override TEXT");
}
if (!botCols.some((c) => c.name === "avatar_shape")) {
  db.exec("ALTER TABLE bots ADD COLUMN avatar_shape TEXT");
}

// 迁移：模型档案补 vision 列（模型是否支持图片输入；无视觉时容器工具走文本快照模式）
const profCols = db.prepare("PRAGMA table_info(model_profiles)").all() as { name: string }[];
if (!profCols.some((c) => c.name === "vision")) {
  db.exec("ALTER TABLE model_profiles ADD COLUMN vision INTEGER NOT NULL DEFAULT 1");
}
if (!profCols.some((c) => c.name === "vision_profile_id")) {
  db.exec("ALTER TABLE model_profiles ADD COLUMN vision_profile_id TEXT");
}

// 迁移：早期 MCP 表补状态、工具配置和默认审批策略。
const mcpCols = db.prepare("PRAGMA table_info(mcp_servers)").all() as { name: string }[];
const mcpMigrations: Array<[string, string]> = [
  ["default_policy", "TEXT NOT NULL DEFAULT 'auto'"],
  ["tool_config", "TEXT NOT NULL DEFAULT '{}'"],
  ["discovered_tools", "TEXT NOT NULL DEFAULT '[]'"],
  ["last_status", "TEXT NOT NULL DEFAULT 'unknown'"],
  ["last_error", "TEXT NOT NULL DEFAULT ''"],
  ["last_checked_at", "INTEGER"],
];
for (const [name, definition] of mcpMigrations) {
  if (!mcpCols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN ${name} ${definition}`);
  }
}

const groupMessageCols = db.prepare("PRAGMA table_info(group_messages)").all() as { name: string }[];
if (!groupMessageCols.some((c) => c.name === "meta")) {
  db.exec("ALTER TABLE group_messages ADD COLUMN meta TEXT");
}

const groupCols = db.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
const groupMigrations: Array<[string, string]> = [
  ["description", "TEXT NOT NULL DEFAULT ''"],
  ["moderator_name", "TEXT NOT NULL DEFAULT '主持人'"],
  ["moderator_profile_id", "TEXT"],
  ["moderator_instructions", "TEXT NOT NULL DEFAULT ''"],
  ["moderator_max_tokens", "INTEGER NOT NULL DEFAULT 0"],
  ["moderator_history", "INTEGER NOT NULL DEFAULT 0"],
  ["moderator_thinking", "TEXT NOT NULL DEFAULT ''"],
];
for (const [name, definition] of groupMigrations) {
  if (!groupCols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE groups ADD COLUMN ${name} ${definition}`);
  }
}

export default db;

export function getAppSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export interface BotRow {
  id: string;
  name: string;
  role: string;
  avatar_color: string;
  avatar_shape: string | null;
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
  thinking_override: string | null;
}

export interface ModelProfileRow {
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
  context_window: number;
  max_tokens: number;
  is_default: number;
  created_at: number;
}

export interface MessageRow {
  id: number;
  bot_id: string;
  thread_id: string;
  role: string;
  author: string;
  content: string;
  kind: string;
  meta: string | null;
  created_at: number;
}

export interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  content: string;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface McpServerRow {
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

export interface ApprovalRuleRow {
  id: string;
  action: "require" | "allow";
  server_id: string;
  tool_name: string;
  created_at: number;
}

export interface RoutineRow {
  id: string;
  bot_id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: number;
  created_at: number;
  last_run: number | null;
}
