import { randomUUID } from "node:crypto";
import db, { type ApprovalRuleRow, type McpServerRow } from "./db.js";

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

export interface ContainerMcpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  defaultPolicy: "auto" | "ask" | "allow";
  toolConfig: McpToolConfig;
  rules: Array<{ action: "require" | "allow"; toolName: string }>;
}

function parseObject(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mergeSecrets(currentJson: string, incoming?: Record<string, string>) {
  const current = parseObject(currentJson);
  if (incoming === undefined) return current;
  return Object.fromEntries(
    Object.entries(incoming).map(([key, value]) => [
      key,
      value === "" && current[key] !== undefined ? current[key] : value,
    ]),
  );
}

function maskSecrets(value: string) {
  return JSON.stringify(Object.fromEntries(Object.keys(parseObject(value)).map((key) => [key, ""])));
}

export class McpServerStore {
  list(): McpServerRow[] {
    return db.prepare("SELECT * FROM mcp_servers ORDER BY created_at ASC").all() as McpServerRow[];
  }

  get(id: string): McpServerRow | undefined {
    return db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as
      | McpServerRow
      | undefined;
  }

  publicList(): McpServerRow[] {
    return this.list().map((row) => this.toPublic(row));
  }

  publicGet(id: string): McpServerRow | undefined {
    const row = this.get(id);
    return row ? this.toPublic(row) : undefined;
  }

  create(input: McpServerInput): McpServerRow {
    this.validate(input);
    const id = randomUUID().slice(0, 8);
    db.prepare(
      `INSERT INTO mcp_servers
       (id, name, transport, command, args, env, url, headers, enabled, default_policy, tool_config, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.name.trim(),
      input.transport,
      input.command?.trim() ?? "",
      JSON.stringify(input.args ?? []),
      JSON.stringify(input.env ?? {}),
      input.url?.trim() ?? "",
      JSON.stringify(input.headers ?? {}),
      input.enabled === false ? 0 : 1,
      input.defaultPolicy ?? "auto",
      JSON.stringify(input.toolConfig ?? {}),
      Date.now(),
    );
    return this.publicGet(id)!;
  }

  update(id: string, input: McpServerInput): McpServerRow | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    this.validate(input);
    db.prepare(
      `UPDATE mcp_servers
       SET name=?, transport=?, command=?, args=?, env=?, url=?, headers=?, enabled=?,
           default_policy=?, tool_config=?
       WHERE id=?`,
    ).run(
      input.name.trim(),
      input.transport,
      input.command?.trim() ?? "",
      JSON.stringify(input.args ?? []),
      JSON.stringify(mergeSecrets(current.env, input.env)),
      input.url?.trim() ?? "",
      JSON.stringify(mergeSecrets(current.headers, input.headers)),
      input.enabled === false ? 0 : 1,
      input.defaultPolicy ?? current.default_policy,
      JSON.stringify(input.toolConfig ?? parseObject(current.tool_config)),
      id,
    );
    return this.publicGet(id);
  }

  remove(id: string) {
    db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  }

  setEnabled(id: string, enabled: boolean) {
    db.prepare("UPDATE mcp_servers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }

  updateProbe(
    id: string,
    result: { ok: boolean; tools?: DiscoveredMcpTool[]; error?: string },
  ) {
    db.prepare(
      `UPDATE mcp_servers
       SET discovered_tools=?, last_status=?, last_error=?, last_checked_at=?
       WHERE id=?`,
    ).run(
      JSON.stringify(result.tools ?? []),
      result.ok ? "connected" : "error",
      result.ok ? "" : result.error ?? "Connection failed",
      Date.now(),
      id,
    );
  }

  markTesting(id: string) {
    db.prepare("UPDATE mcp_servers SET last_status = 'testing', last_error = '' WHERE id = ?").run(
      id,
    );
  }

  getContainerConfig(
    id: string,
    rules: ApprovalRuleRow[] = [],
  ): ContainerMcpServer | undefined {
    const row = this.get(id);
    return row ? this.toContainer(row, rules) : undefined;
  }

  enabledForContainer(rules: ApprovalRuleRow[] = []): ContainerMcpServer[] {
    return this.list()
      .filter((row) => row.enabled === 1)
      .map((row) => this.toContainer(row, rules));
  }

  private validate(input: McpServerInput) {
    if (!input.name?.trim()) throw new Error("MCP server name is required");
    if (input.transport !== "stdio" && input.transport !== "http") {
      throw new Error("transport must be stdio or http");
    }
    if (input.transport === "stdio" && !input.command?.trim()) {
      throw new Error("stdio command is required");
    }
    if (input.transport === "http") {
      if (!input.url?.trim()) throw new Error("HTTP URL is required");
      const url = new URL(input.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("MCP URL must use http or https");
      }
    }
    if (
      input.defaultPolicy !== undefined &&
      !["auto", "ask", "allow"].includes(input.defaultPolicy)
    ) {
      throw new Error("Default policy must be auto, ask, or allow");
    }
  }

  private toPublic(row: McpServerRow): McpServerRow {
    return { ...row, env: maskSecrets(row.env), headers: maskSecrets(row.headers) };
  }

  private toContainer(row: McpServerRow, rules: ApprovalRuleRow[]): ContainerMcpServer {
    const common = {
      id: row.id,
      name: row.name,
      defaultPolicy: row.default_policy,
      toolConfig: parseObject(row.tool_config) as unknown as McpToolConfig,
      rules: rules
        .filter((rule) => rule.server_id === row.id)
        .map((rule) => ({ action: rule.action, toolName: rule.tool_name })),
    };
    return row.transport === "stdio"
      ? {
          ...common,
          transport: "stdio",
          command: row.command,
          args: parseArray(row.args),
          env: parseObject(row.env),
        }
      : {
          ...common,
          transport: "http",
          url: row.url,
          headers: parseObject(row.headers),
        };
  }
}
