// pi RPC WebSocket 桥（多路复用版）：一台共享电脑容器承载所有 Bot。
// 每个 Bot 一个 pi 子进程：HOME=/config/bots/<botId>（独立设置、会话、记忆），
// cwd 也在 bot 目录（AGENTS.md 注入身份），共享资源在 /config/workspace 与共享 Chromium。
// 协议：
//   服务端 → 桥：{type:"_pibot", cmd:"start_bot"|"stop_bot"|"set_model", botId, ...}
//                {botId, data:{...pi RPC 命令}}
//   桥 → 服务端：{botId, data:{...pi RPC 事件}}
//                {type:"_bridge", event, botId?, ...}
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const PORT = Number(process.env.PIBOT_BRIDGE_PORT || 8791);
const BOTS_DIR = "/config/bots";
const WORKSPACE = "/config/workspace";
const EXTENSION = "/opt/pibot/extensions/pibot.ts";
const MCP_FILE = "/config/mcp-servers.json";

const sessions = new Map(); // botId -> { proc, buf, stopping }
const clients = new Set();

function broadcast(obj) {
  const line = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(line);
  }
}

function botDir(botId) {
  return join(BOTS_DIR, botId.replace(/[^a-zA-Z0-9_-]/g, ""));
}

// 生成/更新 bot 的私有配置目录；AGENTS.md 仅在缺失时写模板（记忆随使用累积）
function ensureBotFiles(botId, name, role, model) {
  const dir = botDir(botId);
  const agentDir = join(dir, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });

  const modelFile = join(dir, "pibot-model.json");
  if (model) writeFileSync(modelFile, JSON.stringify(model, null, 2));
  let effectiveModel = model;
  if (!effectiveModel && existsSync(modelFile)) {
    try {
      effectiveModel = JSON.parse(readFileSync(modelFile, "utf8"));
    } catch {
      // 损坏时回落默认值，pi 会把错误作为会话事件返回。
    }
  }

  const settings = {
    defaultProvider: "pibot",
    defaultModel: effectiveModel?.modelId ?? "gpt-4o",
    defaultThinkingLevel: effectiveModel?.thinking ?? "off",
    quietStartup: true,
    defaultProjectTrust: "never",
    enableInstallTelemetry: false,
    extensions: [EXTENSION],
    retry: { enabled: true, maxRetries: 3 },
  };
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings, null, 2));

  const memFile = join(dir, "AGENTS.md");
  if (!existsSync(memFile)) {
    writeFileSync(
      memFile,
      `# You are ${name || "Bot"}, a persistent AI teammate

- Your role: ${role || "a general-purpose assistant that gets real work done"}.
- You share one computer with your teammate Bots (this container). Files, browser sign-ins, and the desktop are shared: sign in once and everyone can use the session.
- Keep durable project files in the shared workspace: ${WORKSPACE} (use clear folder names). Your private home is ${dir}.
- The user watches the shared screen; prefer visible actions (browser) over headless tricks when interacting with websites.
- You chat with your user like a colleague over messages: concise, warm, no corporate filler.
- Finish jobs end to end. Only come back to the user when you need a decision or approval (use request_approval).
- Use update_memory for lasting preferences (kind=preference), facts (kind=fact), or a one-line work outcome (kind=work).
- Memory is a hint, not the source of truth. Reopen current data for consequential decisions. Put standing safety rules in your role.

## Preferences

## Facts

## Work
`,
    );
  }
  return dir;
}

function startBot(botId, name, role, model) {
  const existing = sessions.get(botId);
  if (existing?.proc) return; // 已在运行

  const dir = ensureBotFiles(botId, name, role, model);
  const proc = spawn("pi", ["--mode", "rpc"], {
    cwd: dir,
    env: {
      ...process.env,
      HOME: dir,
      PIBOT_BOT_ID: botId,
      PIBOT_BOT_DIR: dir,
      PIBOT_WORKSPACE: WORKSPACE,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session = { proc, buf: "", stopping: false, name, role };
  sessions.set(botId, session);

  proc.stdout.on("data", (chunk) => {
    session.buf += chunk.toString("utf8");
    // 严格按 \n 切分（RPC 协议要求）
    while (true) {
      const idx = session.buf.indexOf("\n");
      if (idx === -1) break;
      let line = session.buf.slice(0, idx);
      session.buf = session.buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line) continue;
      try {
        broadcast({ botId, data: JSON.parse(line) });
      } catch {
        // 非 JSON 行忽略
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    broadcast({ type: "_bridge", event: "stderr", botId, data: chunk.toString("utf8") });
  });

  proc.on("exit", (code) => {
    const wasStopping = session.stopping;
    session.proc = null;
    session.buf = "";
    broadcast({ type: "_bridge", event: "bot_exited", botId, code, intended: wasStopping });
    if (wasStopping) {
      sessions.delete(botId);
    } else {
      // 意外退出：1 秒后自动拉起
      setTimeout(() => {
        if (sessions.get(botId) === session && !session.proc) {
          sessions.delete(botId);
          startBot(botId, session.name, session.role, null);
          broadcast({ type: "_bridge", event: "bot_restarted", botId });
        }
      }, 1000);
    }
  });

  broadcast({ type: "_bridge", event: "bot_started", botId });
}

function stopBot(botId) {
  const session = sessions.get(botId);
  if (!session?.proc) {
    sessions.delete(botId);
    return;
  }
  session.stopping = true;
  session.proc.kill();
}

// 切换模型：写入 bot 私有配置后重启该 Bot 的 pi（其他 Bot 与桌面不受影响）。
// 内容没变化时不重启，避免打断会话。
function setModel(botId, config) {
  const dir = botDir(botId);
  const modelFile = join(dir, "pibot-model.json");
  const next = JSON.stringify(config, null, 2);
  const current = existsSync(modelFile) ? readFileSync(modelFile, "utf8") : "";
  if (current.trim() === next.trim()) return { changed: false };

  const session = sessions.get(botId);
  ensureBotFiles(botId, session?.name ?? "Bot", session?.role ?? "", config);

  if (session?.proc) {
    // 杀掉让 exit 处理器自动重启，新进程读到新配置
    const s = session;
    s.stopping = false;
    s.proc.kill();
  }
  return { changed: true };
}

// MCP 是账户级配置。扩展在每次调用前刷新文件，因此更新不需要打断正在工作的 Bot。
function setMcp(servers) {
  const next = JSON.stringify(Array.isArray(servers) ? servers : [], null, 2);
  const current = existsSync(MCP_FILE) ? readFileSync(MCP_FILE, "utf8") : "";
  if (current.trim() === next.trim()) return { changed: false };
  writeFileSync(MCP_FILE, next);
  return { changed: true };
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function connectMcpForProbe(server) {
  if (server.transport === "stdio") {
    const client = new Client({ name: "pibot-probe", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: { ...process.env, ...(server.env ?? {}) },
      cwd: WORKSPACE,
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => undefined);
    await withTimeout(client.connect(transport), 45_000, "Connection timed out");
    return client;
  }

  const url = new URL(server.url);
  const requestInit = { headers: server.headers ?? {} };
  const fetchWithHeaders = (input, init = {}) => {
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(server.headers ?? {})) headers.set(name, value);
    return fetch(input, { ...init, headers });
  };
  const first = new Client({ name: "pibot-probe", version: "0.1.0" });
  try {
    await withTimeout(
      first.connect(new StreamableHTTPClientTransport(url, { requestInit })),
      45_000,
      "Connection timed out",
    );
    return first;
  } catch {
    await first.close().catch(() => undefined);
    const fallback = new Client({ name: "pibot-probe", version: "0.1.0" });
    await withTimeout(
      fallback.connect(
        new SSEClientTransport(url, {
          requestInit,
          eventSourceInit: { fetch: fetchWithHeaders },
        }),
      ),
      45_000,
      "Connection timed out",
    );
    return fallback;
  }
}

async function testMcpServer(ws, requestId, server) {
  const startedAt = Date.now();
  let client;
  try {
    client = await connectMcpForProbe(server);
    const result = await withTimeout(client.listTools(), 15_000, "Tool discovery timed out");
    const tools = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema ?? { type: "object" },
      readOnlyHint: tool.annotations?.readOnlyHint,
    }));
    ws.send(
      JSON.stringify({
        type: "_bridge",
        event: "mcp_test_result",
        requestId,
        serverId: server.id,
        ok: true,
        latencyMs: Date.now() - startedAt,
        tools,
      }),
    );
  } catch (error) {
    ws.send(
      JSON.stringify({
        type: "_bridge",
        event: "mcp_test_result",
        requestId,
        serverId: server.id,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    await client?.close().catch(() => undefined);
  }
}

const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(
    JSON.stringify({
      type: "_bridge",
      event: "connected",
      running: [...sessions.keys()].filter((id) => sessions.get(id)?.proc),
    }),
  );

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      return;
    }

    if (msg.type === "_pibot") {
      switch (msg.cmd) {
        case "start_bot":
          startBot(msg.botId, msg.name, msg.role, msg.model);
          return;
        case "stop_bot":
          stopBot(msg.botId);
          return;
        case "set_model": {
          const { changed } = setModel(msg.botId, msg.config);
          ws.send(JSON.stringify({ type: "_bridge", event: "model_applied", botId: msg.botId, changed }));
          return;
        }
        case "set_mcp": {
          const { changed } = setMcp(msg.servers);
          ws.send(JSON.stringify({ type: "_bridge", event: "mcp_applied", changed }));
          return;
        }
        case "test_mcp":
          void testMcpServer(ws, msg.requestId, msg.server);
          return;
        default:
          return;
      }
    }

    // 数据消息：转发给对应 Bot 的 pi 进程
    if (msg.botId && msg.data) {
      const session = sessions.get(msg.botId);
      if (session?.proc?.stdin.writable) {
        session.proc.stdin.write(JSON.stringify(msg.data) + "\n");
      } else {
        ws.send(JSON.stringify({ type: "_bridge", event: "bot_unavailable", botId: msg.botId }));
      }
    }
  });

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

mkdirSync(BOTS_DIR, { recursive: true });
mkdirSync(WORKSPACE, { recursive: true });
console.log(`[pibot-bridge] multiplexer listening on :${PORT}`);
