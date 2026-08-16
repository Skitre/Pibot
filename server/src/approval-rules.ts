import { randomUUID } from "node:crypto";
import db, { type ApprovalRuleRow } from "./db.js";

export interface ApprovalRuleInput {
  action: "require" | "allow";
  serverId: string;
  toolName?: string;
}

export class ApprovalRuleStore {
  list(): ApprovalRuleRow[] {
    return db
      .prepare("SELECT * FROM approval_rules ORDER BY created_at ASC")
      .all() as ApprovalRuleRow[];
  }

  upsert(input: ApprovalRuleInput): ApprovalRuleRow {
    if (input.action !== "require" && input.action !== "allow") {
      throw new Error("Rule action must be require or allow");
    }
    if (!input.serverId?.trim()) throw new Error("MCP server is required");
    const serverId = input.serverId.trim();
    const toolName = input.toolName?.trim() || "*";
    const existing = db
      .prepare("SELECT * FROM approval_rules WHERE server_id = ? AND tool_name = ?")
      .get(serverId, toolName) as ApprovalRuleRow | undefined;
    if (existing) {
      db.prepare("UPDATE approval_rules SET action = ? WHERE id = ?").run(
        input.action,
        existing.id,
      );
      return { ...existing, action: input.action };
    }

    const row: ApprovalRuleRow = {
      id: randomUUID().slice(0, 8),
      action: input.action,
      server_id: serverId,
      tool_name: toolName,
      created_at: Date.now(),
    };
    db.prepare(
      "INSERT INTO approval_rules (id, action, server_id, tool_name, created_at) VALUES (?,?,?,?,?)",
    ).run(row.id, row.action, row.server_id, row.tool_name, row.created_at);
    return row;
  }

  remove(id: string) {
    db.prepare("DELETE FROM approval_rules WHERE id = ?").run(id);
  }

  removeForServer(serverId: string) {
    db.prepare("DELETE FROM approval_rules WHERE server_id = ?").run(serverId);
  }

  forServer(serverId: string) {
    return this.list().filter((rule) => rule.server_id === serverId);
  }
}
