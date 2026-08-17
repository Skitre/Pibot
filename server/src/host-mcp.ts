import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DATA_DIR } from "./config.js";
import type { ContainerMcpServer, DiscoveredMcpTool } from "./mcp-servers.js";

export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

const MCP_CWD = join(DATA_DIR, "mcp-cwd");

function toolIsEnabled(server: ContainerMcpServer, toolName: string) {
  return server.toolConfig?.[toolName]?.enabled !== false;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Windows 上 npx/npm 必须走 .cmd，否则 spawn ENOENT。 */
function stdioCommand(command: string): string {
  if (process.platform !== "win32") return command;
  const base = command.replace(/\.(cmd|exe)$/i, "").toLowerCase();
  const mapped: Record<string, string> = {
    npx: "npx.cmd",
    npm: "npm.cmd",
    pnpm: "pnpm.cmd",
    yarn: "yarn.cmd",
    bun: "bun.exe",
  };
  return mapped[base] ?? command;
}

function fingerprintOf(server: ContainerMcpServer): string {
  return JSON.stringify({
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: server.env,
    url: server.url,
    headers: server.headers,
  });
}

/**
 * 本机 MCP 客户端。HTTP/stdio 都在宿主进程里连，不经过共享电脑。
 * stdio cwd 固定在 server/data/mcp-cwd，不碰工程目录和用户桌面。
 */
export class HostMcpHub {
  private clients = new Map<string, { fingerprint: string; client: Promise<Client> }>();

  constructor(private listServers: () => ContainerMcpServer[]) {}

  invalidate() {
    for (const existing of this.clients.values()) {
      void existing.client.then((client) => client.close()).catch(() => undefined);
    }
    this.clients.clear();
  }

  async list(serverName?: string): Promise<{ text: string; isError: boolean }> {
    const all = this.listServers();
    const key = String(serverName ?? "").trim().toLowerCase();
    const selected = serverName
      ? all.filter((item) => item.id === serverName || item.name.toLowerCase() === key)
      : all;
    if (selected.length === 0) {
      return { text: "No matching enabled MCP server is configured.", isError: true };
    }
    const output: string[] = [];
    let errors = 0;
    for (const server of selected) {
      try {
        const client = await this.connect(server);
        const result = await client.listTools(undefined, { timeout: 30000 });
        const visible = result.tools.filter((tool) => toolIsEnabled(server, tool.name));
        output.push(
          `## ${server.name} (${server.id}) · policy=${server.defaultPolicy ?? "auto"}\n${visible
            .map(
              (tool) =>
                `- ${tool.name}: ${tool.description ?? "No description"}\n  inputSchema: ${JSON.stringify(tool.inputSchema)}`,
            )
            .join("\n")}`,
        );
      } catch (err) {
        errors += 1;
        output.push(`## ${server.name}\nConnection failed: ${(err as Error).message}`);
      }
    }
    return { text: output.join("\n\n"), isError: errors === selected.length };
  }

  async call(
    server: ContainerMcpServer,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; isError: boolean; text: string; content: McpContentBlock[] }> {
    if (!toolIsEnabled(server, tool)) {
      return {
        ok: false,
        isError: true,
        text: `MCP tool "${tool}" is disabled in Settings.`,
        content: [{ type: "text", text: `MCP tool "${tool}" is disabled in Settings.` }],
      };
    }
    try {
      const client = await this.connect(server);
      const result = (await client.callTool({ name: tool, arguments: args }, undefined, {
        timeout: 120000,
      })) as {
        content?: Array<Record<string, any>>;
        structuredContent?: unknown;
        isError?: boolean;
      };
      const content: McpContentBlock[] = [];
      for (const block of result.content ?? []) {
        if (block.type === "text") content.push({ type: "text", text: String(block.text ?? "") });
        else if (block.type === "image" && "data" in block && block.data) {
          content.push({
            type: "image",
            data: String(block.data),
            mimeType: String(block.mimeType ?? "image/png"),
          });
        } else if (block.type === "resource" && "resource" in block) {
          const resource = (block.resource ?? {}) as {
            text?: string;
            blob?: string;
            mimeType?: string;
          };
          if (typeof resource.text === "string") content.push({ type: "text", text: resource.text });
          else if (resource.blob && String(resource.mimeType ?? "").startsWith("image/")) {
            content.push({
              type: "image",
              data: resource.blob,
              mimeType: resource.mimeType ?? "image/png",
            });
          } else content.push({ type: "text", text: JSON.stringify(resource) });
        } else content.push({ type: "text", text: JSON.stringify(block) });
      }
      if (content.length === 0 && result.structuredContent !== undefined) {
        content.push({ type: "text", text: JSON.stringify(result.structuredContent, null, 2) });
      }
      if (content.length === 0) content.push({ type: "text", text: "MCP tool completed with no content." });
      return {
        ok: !result.isError,
        isError: !!result.isError,
        text: content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
        content,
      };
    } catch (err) {
      this.drop(server.id);
      const text = `MCP call failed: ${(err as Error).message}`;
      return { ok: false, isError: true, text, content: [{ type: "text", text }] };
    }
  }

  async test(server: ContainerMcpServer): Promise<{
    ok: boolean;
    tools?: DiscoveredMcpTool[];
    error?: string;
  }> {
    let client: Client | undefined;
    try {
      client = await withTimeout(this.connect(server, "pibot-probe"), 45_000, "Connection timed out");
      const result = await withTimeout(client.listTools(), 15_000, "Tool discovery timed out");
      return {
        ok: true,
        tools: result.tools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: (tool.inputSchema ?? { type: "object" }) as Record<string, unknown>,
          readOnlyHint: tool.annotations?.readOnlyHint,
        })),
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      this.drop(server.id);
      await client?.close().catch(() => undefined);
    }
  }

  private drop(id: string) {
    const existing = this.clients.get(id);
    this.clients.delete(id);
    if (existing) void existing.client.then((client) => client.close()).catch(() => undefined);
  }

  private connect(server: ContainerMcpServer, name = "pibot"): Promise<Client> {
    const fingerprint = fingerprintOf(server);
    const existing = this.clients.get(server.id);
    if (existing?.fingerprint === fingerprint) return existing.client;
    if (existing) this.drop(server.id);

    const connecting = this.open(server, name);
    this.clients.set(server.id, { fingerprint, client: connecting });
    connecting.catch(() => this.clients.delete(server.id));
    return connecting;
  }

  private async open(server: ContainerMcpServer, name: string): Promise<Client> {
    if (server.transport === "stdio") {
      mkdirSync(MCP_CWD, { recursive: true });
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
      const client = new Client({ name, version: "0.1.0" });
      const transport = new StdioClientTransport({
        command: stdioCommand(server.command ?? ""),
        args: server.args ?? [],
        env: { ...inherited, ...(server.env ?? {}) },
        cwd: MCP_CWD,
        stderr: "pipe",
      });
      transport.stderr?.on("data", () => undefined);
      await client.connect(transport);
      return client;
    }

    if (!server.url) throw new Error("HTTP MCP URL is required");
    const url = new URL(server.url);
    const requestInit = { headers: server.headers ?? {} };
    const fetchWithHeaders = (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      for (const [h, v] of Object.entries(server.headers ?? {})) headers.set(h, v);
      return fetch(input, { ...init, headers });
    };
    const first = new Client({ name, version: "0.1.0" });
    try {
      await first.connect(new StreamableHTTPClientTransport(url, { requestInit }));
      return first;
    } catch {
      await first.close().catch(() => undefined);
      const fallback = new Client({ name, version: "0.1.0" });
      await fallback.connect(
        new SSEClientTransport(url, {
          requestInit,
          eventSourceInit: { fetch: fetchWithHeaders as typeof fetch },
        }),
      );
      return fallback;
    }
  }
}
