import cron, { ScheduledTask } from "node-cron";
import { randomUUID } from "node:crypto";
import db, { RoutineRow } from "./db.js";
import { BotManager } from "./bot-manager.js";

// 例行任务：node-cron 定时向 Bot 发起 prompt。服务常驻即等于 Bot 24/7 可被唤起。
export class RoutineScheduler {
  private tasks = new Map<string, ScheduledTask>();

  constructor(private bots: BotManager) {}

  loadAll() {
    const rows = db.prepare("SELECT * FROM routines WHERE enabled = 1").all() as RoutineRow[];
    for (const r of rows) this.schedule(r);
  }

  private schedule(r: RoutineRow) {
    if (!cron.validate(r.cron)) {
      console.warn(`[routines] invalid cron for ${r.name}: ${r.cron}`);
      return;
    }
    this.tasks.get(r.id)?.stop();
    const task = cron.schedule(r.cron, () => {
      db.prepare("UPDATE routines SET last_run = ? WHERE id = ?").run(Date.now(), r.id);
      this.bots.sendPrompt(r.bot_id, r.prompt, "routine");
    });
    this.tasks.set(r.id, task);
  }

  list(botId: string): RoutineRow[] {
    return db
      .prepare("SELECT * FROM routines WHERE bot_id = ? ORDER BY created_at ASC")
      .all(botId) as RoutineRow[];
  }

  create(botId: string, name: string, cronExpr: string, prompt: string): RoutineRow {
    const id = randomUUID().slice(0, 8);
    db.prepare(
      "INSERT INTO routines (id, bot_id, name, cron, prompt, enabled, created_at) VALUES (?,?,?,?,?,1,?)",
    ).run(id, botId, name, cronExpr, prompt, Date.now());
    const row = db.prepare("SELECT * FROM routines WHERE id = ?").get(id) as RoutineRow;
    this.schedule(row);
    return row;
  }

  setEnabled(id: string, enabled: boolean) {
    db.prepare("UPDATE routines SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    if (enabled) {
      const row = db.prepare("SELECT * FROM routines WHERE id = ?").get(id) as RoutineRow;
      if (row) this.schedule(row);
    } else {
      this.tasks.get(id)?.stop();
      this.tasks.delete(id);
    }
  }

  delete(id: string) {
    this.tasks.get(id)?.stop();
    this.tasks.delete(id);
    db.prepare("DELETE FROM routines WHERE id = ?").run(id);
  }

  /** 手动触发一次，不影响排程 */
  run(id: string) {
    const row = db.prepare("SELECT * FROM routines WHERE id = ?").get(id) as RoutineRow | undefined;
    if (!row) return false;
    db.prepare("UPDATE routines SET last_run = ? WHERE id = ?").run(Date.now(), id);
    this.bots.sendPrompt(row.bot_id, row.prompt, "routine");
    return true;
  }
}
