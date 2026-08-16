import { randomUUID } from "node:crypto";
import db, { SkillRow } from "./db.js";

export interface SkillInput {
  name: string;
  description?: string;
  content: string;
}

export interface BotSkillRow extends SkillRow {
  enabled: number;
}

// slug 用于 composer 里的 /引用 与 prompt 内匹配
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "skill"
  );
}

export class SkillStore {
  list(): SkillRow[] {
    return db.prepare("SELECT * FROM skills ORDER BY updated_at DESC").all() as SkillRow[];
  }

  /** 返回某个 Bot 可用的 Skill。无覆盖记录时按启用处理。 */
  listForBot(botId: string): BotSkillRow[] {
    return db
      .prepare(
        `SELECT s.*, COALESCE(bs.enabled, 1) AS enabled
         FROM skills s
         LEFT JOIN bot_skills bs ON bs.skill_id = s.id AND bs.bot_id = ?
         ORDER BY s.updated_at DESC`,
      )
      .all(botId) as BotSkillRow[];
  }

  /** 将当前 Bot 的 Skill 开关保存为显式覆盖。新建 Skill 没有映射时仍默认启用。 */
  setEnabledForBot(botId: string, enabledSkillIds: string[]): BotSkillRow[] {
    const ids = new Set(enabledSkillIds);
    const skills = this.list();
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM bot_skills WHERE bot_id = ?").run(botId);
      const insert = db.prepare(
        "INSERT INTO bot_skills (bot_id, skill_id, enabled) VALUES (?,?,?)",
      );
      for (const skill of skills) insert.run(botId, skill.id, ids.has(skill.id) ? 1 : 0);
    });
    tx();
    return this.listForBot(botId);
  }

  isEnabledForBot(botId: string, skillId: string): boolean {
    const row = db
      .prepare("SELECT enabled FROM bot_skills WHERE bot_id = ? AND skill_id = ?")
      .get(botId, skillId) as { enabled: number } | undefined;
    return row ? row.enabled === 1 : true;
  }

  get(id: string): SkillRow | undefined {
    return db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as SkillRow | undefined;
  }

  bySlug(slug: string): SkillRow | undefined {
    return db.prepare("SELECT * FROM skills WHERE slug = ?").get(slug) as SkillRow | undefined;
  }

  create(input: SkillInput, createdBy = "user"): SkillRow {
    const id = randomUUID().slice(0, 8);
    let slug = slugify(input.name);
    // slug 冲突时追加短 id，保证 /引用 唯一
    if (this.bySlug(slug)) slug = `${slug}-${id.slice(0, 4)}`;
    const now = Date.now();
    db.prepare(
      "INSERT INTO skills (id, slug, name, description, content, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(id, slug, input.name, input.description ?? "", input.content, createdBy, now, now);
    return this.get(id)!;
  }

  update(id: string, input: SkillInput): SkillRow | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    db.prepare(
      "UPDATE skills SET name=?, description=?, content=?, updated_at=? WHERE id=?",
    ).run(input.name, input.description ?? "", input.content, Date.now(), id);
    return this.get(id);
  }

  /** Bot 用 save_skill 工具存的：同名（slug 相同）则覆盖内容 */
  upsertByName(input: SkillInput, createdBy: string): SkillRow {
    const existing = this.bySlug(slugify(input.name));
    if (existing) return this.update(existing.id, input)!;
    return this.create(input, createdBy);
  }

  remove(id: string) {
    db.prepare("DELETE FROM bot_skills WHERE skill_id = ?").run(id);
    db.prepare("DELETE FROM skills WHERE id = ?").run(id);
  }

  removeForBot(botId: string) {
    db.prepare("DELETE FROM bot_skills WHERE bot_id = ?").run(botId);
  }

  copyForBot(fromBotId: string, toBotId: string) {
    const rows = db
      .prepare("SELECT skill_id, enabled FROM bot_skills WHERE bot_id = ?")
      .all(fromBotId) as { skill_id: string; enabled: number }[];
    const insert = db.prepare(
      "INSERT INTO bot_skills (bot_id, skill_id, enabled) VALUES (?,?,?)",
    );
    const tx = db.transaction(() => {
      for (const row of rows) insert.run(toBotId, row.skill_id, row.enabled);
    });
    tx();
  }

  /**
   * 展开文本中的 /slug 引用：返回需要注入 prompt 的 skill 列表。
   * 只匹配独立 token（前面是行首或空白），避免误伤路径。
   */
  resolveReferences(text: string, botId?: string): SkillRow[] {
    const found = new Map<string, SkillRow>();
    for (const m of text.matchAll(/(?:^|\s)\/([a-z0-9\u4e00-\u9fa5][a-z0-9\u4e00-\u9fa5-]*)/g)) {
      const skill = this.bySlug(m[1]);
      if (skill && (!botId || this.isEnabledForBot(botId, skill.id)) && !found.has(skill.id)) {
        found.set(skill.id, skill);
      }
    }
    return [...found.values()];
  }
}
