import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Docker from "dockerode";
import type { WebSocket } from "ws";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { BotLookError, BotManager, BotSettingsError, parseBotLook } from "./bot-manager.js";
import { RoutineScheduler } from "./routines.js";
import { GroupManager, GroupError, type GroupModeratorInput } from "./groups.js";
import { ModelProfileStore, type ProfileInput } from "./model-profiles.js";
import { ThinkingLevelMapError } from "./thinking.js";
import { SkillStore, type SkillInput } from "./skills.js";
import { McpServerStore, type McpServerInput } from "./mcp-servers.js";
import { ApprovalRuleStore, type ApprovalRuleInput } from "./approval-rules.js";
import db from "./db.js";
import { fileBasename, guessMime, workspaceRelPath } from "./workspace-files.js";

const cfg = loadConfig();
// bodyLimit 提高到 64MB：聊天附件走 base64 JSON 上传
const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 });
await app.register(fastifyCors, { origin: true });
await app.register(fastifyWebsocket);

// 动作类接口（start/stop/test/set-default）不带请求体，客户端也就不会带 content-type，
// 默认会被 Fastify 以 415 拒绝。这里放宽：空体视为无参数，非空体尽力按 JSON 解析。
app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return done(null, undefined);
  try {
    done(null, JSON.parse(text));
  } catch {
    done(null, undefined);
  }
});

// ---------- WebSocket 广播 ----------
const clients = new Set<WebSocket>();
function broadcast(msg: Record<string, unknown>) {
  const line = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(line);
  }
}

const profiles = new ModelProfileStore(cfg);
const skills = new SkillStore();
const mcpServers = new McpServerStore();
const approvalRules = new ApprovalRuleStore();
const bots = new BotManager(cfg, broadcast, profiles, skills, mcpServers, approvalRules);
const routines = new RoutineScheduler(bots);
const groups = new GroupManager(bots, broadcast, profiles);

// ---------- REST：Bot ----------
app.get("/api/bots", async () => ({ bots: bots.listBots() }));

app.post("/api/bots", async (req) => {
  const { name, role, modelProfileId } = req.body as {
    name: string;
    role?: string;
    modelProfileId?: string;
  };
  const bot = await bots.createBot(name, role ?? "", modelProfileId);
  return { bot };
});

app.post("/api/bots/:id/model", async (req) => {
  const { id } = req.params as { id: string };
  const { profileId } = req.body as { profileId: string | null };
  bots.setBotModelProfile(id, profileId);
  return { ok: true };
});

app.get("/api/bots/:id/messages", async (req) => {
  const { id } = req.params as { id: string };
  return { messages: bots.getMessages(id) };
});

app.post("/api/bots/:id/start", async (req) => {
  await bots.startBot((req.params as { id: string }).id);
  return { ok: true };
});

app.post("/api/bots/:id/stop", async (req) => {
  await bots.stopBot((req.params as { id: string }).id);
  return { ok: true };
});

app.delete("/api/bots/:id", async (req) => {
  await bots.deleteBot((req.params as { id: string }).id);
  return { ok: true };
});

app.post("/api/bots/:id/pin", async (req) => {
  const { pinned } = req.body as { pinned: boolean };
  bots.setPinned((req.params as { id: string }).id, pinned);
  return { ok: true };
});

app.post("/api/bots/:id/hide", async (req) => {
  const { hidden } = req.body as { hidden: boolean };
  bots.setHidden((req.params as { id: string }).id, hidden);
  return { ok: true };
});

app.put("/api/bots/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as {
    name?: string;
    role?: string;
    avatar_color?: unknown;
    avatar_shape?: unknown;
  };
  try {
    const bot = await bots.updateBot(id, body.name ?? "", body.role ?? "", parseBotLook(body));
    return { bot };
  } catch (err) {
    if (err instanceof BotLookError) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
});

app.get("/api/bots/:id/settings", async (req, reply) => {
  try {
    return { settings: bots.getBotSettings((req.params as { id: string }).id) };
  } catch (err) {
    if (err instanceof BotSettingsError) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
});

app.put("/api/bots/:id/settings", async (req, reply) => {
  try {
    return { settings: bots.updateBotSettings((req.params as { id: string }).id, req.body) };
  } catch (err) {
    if (err instanceof BotSettingsError) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
});

app.delete("/api/bots/:id/messages", async (req) => {
  bots.clearMessages((req.params as { id: string }).id);
  return { ok: true };
});

// ---------- REST：附件与容器文件 ----------
app.post("/api/bots/:id/upload", async (req, reply) => {
  const { id } = req.params as { id: string };
  const { name, data, mime } = req.body as { name: string; data: string; mime?: string };
  if (!name || !data) return reply.code(400).send({ error: "name and data are required" });
  try {
    const attachment = await bots.uploadAttachment(id, name, Buffer.from(data, "base64"), mime ?? "");
    return { attachment };
  } catch (err) {
    return reply.code(500).send({ error: (err as Error).message });
  }
});

app.get("/api/bots/:id/files", async (req, reply) => {
  const { id } = req.params as { id: string };
  const { path, download } = req.query as { path?: string; download?: string };
  if (!path) return reply.code(400).send({ error: "path query is required" });
  const rel = workspaceRelPath(path);
  const buf = await bots.readWorkspaceFile(id, rel);
  if (!buf) return reply.code(404).send({ error: "file not found" });
  const name = fileBasename(rel);
  reply.type(guessMime(name));
  reply.header(
    "Content-Disposition",
    `${download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  );
  return reply.send(buf);
});

app.get("/api/files", async (req, reply) => {
  const { path, download } = req.query as { path?: string; download?: string };
  if (!path) return reply.code(400).send({ error: "path query is required" });
  const rel = workspaceRelPath(path);
  const buf = await bots.readWorkspaceFile("shared", rel);
  if (!buf) return reply.code(404).send({ error: "file not found" });
  const name = fileBasename(rel);
  reply.type(guessMime(name));
  reply.header(
    "Content-Disposition",
    `${download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  );
  return reply.send(buf);
});

// ---------- REST：记忆（容器内 AGENTS.md） ----------
app.get("/api/bots/:id/memory", async (req, reply) => {
  try {
    return { content: await bots.getMemory((req.params as { id: string }).id) };
  } catch (err) {
    return reply.code(409).send({ error: (err as Error).message });
  }
});

app.put("/api/bots/:id/memory", async (req, reply) => {
  const { content } = req.body as { content: string };
  try {
    await bots.setMemory((req.params as { id: string }).id, content ?? "");
    return { ok: true };
  } catch (err) {
    return reply.code(409).send({ error: (err as Error).message });
  }
});

// ---------- REST：Routines ----------
app.get("/api/bots/:id/routines", async (req) => ({
  routines: routines.list((req.params as { id: string }).id),
}));

app.post("/api/bots/:id/routines", async (req) => {
  const { id } = req.params as { id: string };
  const { name, cron, prompt } = req.body as { name: string; cron: string; prompt: string };
  return { routine: routines.create(id, name, cron, prompt) };
});

app.post("/api/routines/:rid/toggle", async (req) => {
  const { enabled } = req.body as { enabled: boolean };
  routines.setEnabled((req.params as { rid: string }).rid, enabled);
  return { ok: true };
});

app.delete("/api/routines/:rid", async (req) => {
  routines.delete((req.params as { rid: string }).rid);
  return { ok: true };
});

app.post("/api/routines/:rid/run", async (req, reply) => {
  const ok = routines.run((req.params as { rid: string }).rid);
  if (!ok) return reply.code(404).send({ error: "routine not found" });
  return { ok: true };
});

// ---------- REST：Groups ----------
app.get("/api/groups", async () => ({ groups: groups.listGroups() }));
app.post("/api/groups", async (req, reply) => {
  try {
    const { name, botIds, description } = req.body as {
      name: string;
      botIds: string[];
      description?: string;
    };
    return { group: groups.createGroup(name, botIds, description) };
  } catch (err) {
    if (err instanceof GroupError) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
});
app.put("/api/groups/:gid", async (req, reply) => {
  try {
    const { gid } = req.params as { gid: string };
    const body = (req.body ?? {}) as { name?: string; description?: string; botIds?: string[] };
    const group = groups.updateGroup(gid, body);
    return { group, members: groups.members(gid) };
  } catch (err) {
    if (err instanceof GroupError) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
});
app.get("/api/groups/:gid/messages", async (req) => ({
  messages: groups.messages((req.params as { gid: string }).gid),
  members: groups.members((req.params as { gid: string }).gid),
}));
app.post("/api/groups/:gid/upload", async (req, reply) => {
  const { gid } = req.params as { gid: string };
  const { name, data, mime } = req.body as { name: string; data: string; mime?: string };
  if (!name || !data) return reply.code(400).send({ error: "name and data are required" });
  try {
    const attachment = await groups.uploadAttachment(gid, name, Buffer.from(data, "base64"), mime ?? "");
    return { attachment };
  } catch (err) {
    if (err instanceof GroupError) return reply.code(err.statusCode).send({ error: err.message });
    return reply.code(500).send({ error: (err as Error).message });
  }
});
app.delete("/api/groups/:gid", async (req) => {
  groups.deleteGroup((req.params as { gid: string }).gid);
  return { ok: true };
});
app.put("/api/groups/:gid/moderator", async (req, reply) => {
  const { gid } = req.params as { gid: string };
  const body = (req.body ?? {}) as GroupModeratorInput;
  if (body.profileId && !profiles.get(body.profileId)) {
    return reply.code(404).send({ error: "profile not found" });
  }
  try {
    return { group: groups.updateModerator(gid, body) };
  } catch (err) {
    if (err instanceof GroupError) return reply.code(err.statusCode).send({ error: err.message });
    throw err;
  }
});

app.get("/api/models", async () => ({ profiles: profiles.list() }));

app.post("/api/models", async (req, reply) => {
  try {
    const profile = profiles.create(req.body as ProfileInput);
    bots.pushModelConfigToAll();
    return { profile };
  } catch (err) {
    if (err instanceof ThinkingLevelMapError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    throw err;
  }
});

app.put("/api/models/:pid", async (req, reply) => {
  const { pid } = req.params as { pid: string };
  try {
    const profile = profiles.update(pid, req.body as ProfileInput);
    if (!profile) return reply.code(404).send({ error: "profile not found" });
    bots.pushModelConfigToAll();
    return { profile };
  } catch (err) {
    if (err instanceof ThinkingLevelMapError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    throw err;
  }
});

app.post("/api/models/:pid/default", async (req) => {
  const { pid } = req.params as { pid: string };
  profiles.setDefault(pid);
  bots.pushModelConfigToAll();
  return { ok: true };
});

// 从中转拉取可用模型列表（表单里还没保存的配置也能用，直接传参）
app.post("/api/models/fetch", async (req, reply) => {
  const { baseUrl, apiKey, api } = req.body as { baseUrl: string; apiKey: string; api: string };
  if (!baseUrl) return reply.code(400).send({ error: "baseUrl is required" });
  return profiles.fetchModels(baseUrl, apiKey ?? "", api ?? "openai-completions");
});

app.post("/api/models/:pid/test", async (req, reply) => {
  const { pid } = req.params as { pid: string };
  const profile = profiles.get(pid);
  if (!profile) return reply.code(404).send({ error: "profile not found" });
  return profiles.test(profile);
});

app.delete("/api/models/:pid", async (req) => {
  const { pid } = req.params as { pid: string };
  profiles.remove(pid);
  bots.pushModelConfigToAll();
  return { ok: true };
});

// ---------- REST：Skills ----------
app.get("/api/skills", async () => ({ skills: skills.list() }));

app.post("/api/skills", async (req, reply) => {
  const input = req.body as SkillInput;
  if (!input?.name?.trim() || !input?.content?.trim())
    return reply.code(400).send({ error: "name and content are required" });
  const skill = skills.create(input);
  broadcast({ type: "skills_changed" });
  return { skill };
});

app.put("/api/skills/:sid", async (req, reply) => {
  const skill = skills.update((req.params as { sid: string }).sid, req.body as SkillInput);
  if (!skill) return reply.code(404).send({ error: "skill not found" });
  broadcast({ type: "skills_changed" });
  return { skill };
});

app.delete("/api/skills/:sid", async (req) => {
  skills.remove((req.params as { sid: string }).sid);
  broadcast({ type: "skills_changed" });
  return { ok: true };
});

// ---------- REST：MCP servers（账户级，运行于共享电脑） ----------
app.get("/api/mcp", async () => ({ servers: mcpServers.publicList() }));

app.post("/api/mcp", async (req, reply) => {
  try {
    const server = mcpServers.create(req.body as McpServerInput);
    bots.pushMcpConfig();
    broadcast({ type: "mcp_changed" });
    return { server };
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

app.put("/api/mcp/:mid", async (req, reply) => {
  try {
    const server = mcpServers.update(
      (req.params as { mid: string }).mid,
      req.body as McpServerInput,
    );
    if (!server) return reply.code(404).send({ error: "MCP server not found" });
    bots.pushMcpConfig();
    broadcast({ type: "mcp_changed" });
    return { server };
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

app.post("/api/mcp/:mid/toggle", async (req) => {
  const { enabled } = req.body as { enabled: boolean };
  mcpServers.setEnabled((req.params as { mid: string }).mid, enabled);
  bots.pushMcpConfig();
  broadcast({ type: "mcp_changed" });
  return { ok: true };
});

app.delete("/api/mcp/:mid", async (req) => {
  const id = (req.params as { mid: string }).mid;
  mcpServers.remove(id);
  approvalRules.removeForServer(id);
  bots.pushMcpConfig();
  broadcast({ type: "mcp_changed" });
  broadcast({ type: "approval_rules_changed" });
  return { ok: true };
});

app.post("/api/mcp/:mid/test", async (req, reply) => {
  try {
    const server = await bots.testMcp((req.params as { mid: string }).mid);
    return { server };
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

// ---------- REST：审批规则 ----------
app.get("/api/approval-rules", async () => ({ rules: approvalRules.list() }));

app.post("/api/approval-rules", async (req, reply) => {
  try {
    const rule = approvalRules.upsert(req.body as ApprovalRuleInput);
    bots.pushMcpConfig();
    broadcast({ type: "approval_rules_changed" });
    return { rule };
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

app.delete("/api/approval-rules/:rid", async (req) => {
  approvalRules.remove((req.params as { rid: string }).rid);
  bots.pushMcpConfig();
  broadcast({ type: "approval_rules_changed" });
  return { ok: true };
});

// ---------- REST：全局搜索（命令面板用） ----------
app.get("/api/search", async (req) => {
  const { q } = req.query as { q?: string };
  const query = (q ?? "").trim();
  if (!query) return { messages: [] };
  const rows = db
    .prepare(
      `SELECT m.id, m.bot_id, m.content, m.created_at, b.name AS bot_name
       FROM messages m JOIN bots b ON b.id = m.bot_id
       WHERE m.kind IN ('text', 'file') AND m.content LIKE ?
       ORDER BY m.id DESC LIMIT 20`,
    )
    .all(`%${query}%`) as {
    id: number;
    bot_id: string;
    content: string;
    created_at: number;
    bot_name: string;
  }[];
  return {
    messages: rows.map((r) => ({
      ...r,
      content: r.content.length > 120 ? r.content.slice(0, 120) + "…" : r.content,
    })),
  };
});

app.post("/api/bots/:id/duplicate", async (req) => {
  const bot = await bots.duplicateBot((req.params as { id: string }).id);
  return { bot };
});

// ---------- REST：运行时信息（供前端拼 noVNC URL） ----------
app.get("/api/config", async () => ({
  image: cfg.docker.image,
  serverPort: cfg.port,
  vncHost: "127.0.0.1",
}));

// ---------- REST：共享电脑 ----------
app.get("/api/computer", async () => ({ computer: bots.getComputer() }));

app.post("/api/computer/start", async () => {
  await bots.ensureComputer();
  return { computer: bots.getComputer() };
});

app.post("/api/computer/restart", async () => {
  await bots.restartComputer();
  return { computer: bots.getComputer() };
});

app.post("/api/computer/stop", async () => {
  await bots.stopComputer();
  return { computer: bots.getComputer() };
});

// ---------- WebSocket ----------
app.get("/ws", { websocket: true }, (socket) => {
  const ws = socket as unknown as WebSocket;
  clients.add(ws);
  ws.send(JSON.stringify({ type: "bots", bots: bots.listBots() }));
  ws.send(JSON.stringify({ type: "working_state", bots: bots.workingSnapshot() }));
  ws.send(JSON.stringify({ type: "group_run_state", groups: groups.runningGroups() }));
  ws.send(JSON.stringify({ type: "group_moderator_state", groupIds: groups.assigningGroups() }));
  ws.send(JSON.stringify({ type: "group_wait_state", groupIds: groups.waitingGroups() }));
  ws.send(JSON.stringify({ type: "computer", computer: bots.getComputer() }));

  ws.on("message", (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    switch (msg.type) {
      case "prompt":
        bots.sendPrompt(msg.botId, msg.text, "user", msg.attachments);
        break;
      case "approval_response":
        bots.respondApproval(msg.botId, msg.requestId, msg.value);
        break;
      case "abort":
        bots.abort(msg.botId, typeof msg.channel === "string" ? msg.channel : undefined);
        break;
      case "abort_group":
        groups.abortGroup(msg.groupId);
        break;
      case "group_prompt":
        groups.postUserMessage(msg.groupId, msg.text, msg.attachments);
        break;
    }
  });

  ws.on("close", () => clients.delete(ws));
});

// ---------- 启动 ----------
async function imageExists(): Promise<boolean> {
  try {
    await new Docker().getImage(cfg.docker.image).inspect();
    return true;
  } catch {
    return false;
  }
}

if (!(await imageExists())) {
  console.warn(`[startup] Docker image "${cfg.docker.image}" not found. Run: npm run image`);
}

try {
  await bots.startup();
} catch (err) {
  console.warn(`[startup] computer startup skipped (docker unavailable?): ${(err as Error).message}`);
}
routines.loadAll();

// ---------- 前端静态托管（npm start 单端口模式） ----------
// web/dist 存在时由本服务直接托管，UI / API / WS 同在 :8790；
// 开发模式跑 vite(5190) 时通常没有 dist，这段不生效。
const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
      reply.status(404).send({ error: "not found" });
      return;
    }
    reply.sendFile("index.html"); // SPA：其余路径一律回 index.html
  });
}

await app.listen({ port: cfg.port, host: "0.0.0.0" });
console.log(`[pibot] server on http://localhost:${cfg.port}`);
