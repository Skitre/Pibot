import { randomUUID } from "node:crypto";
import db, { ModelProfileRow } from "./db.js";
import { AppConfig } from "./config.js";

export interface ProfileInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  api: string;
  modelId: string;
  modelName?: string;
  reasoning?: boolean;
  vision?: boolean;
  visionProfileId?: string | null;
  thinking?: string;
  contextWindow?: number;
  maxTokens?: number;
}

/** 无视觉主模型的"眼睛"：截图交给它转文字描述 */
export interface VisionHelperConfig {
  baseUrl: string;
  apiKey: string;
  api: string;
  modelId: string;
}

// 容器内 pi 需要的模型配置（写入 bot 目录 pibot-model.json）
export interface ContainerModelConfig {
  baseUrl: string;
  apiKey: string;
  api: string;
  modelId: string;
  modelName: string;
  reasoning: boolean;
  vision: boolean;
  thinking: string;
  contextWindow: number;
  maxTokens: number;
  visionHelper?: VisionHelperConfig;
}

/** 思考强度档位映射成各家接口认的值。off / 空 / 认不出的一律返回 null，表示不发送。 */
function reasoningEffort(level?: string): "low" | "medium" | "high" | null {
  switch ((level ?? "").trim().toLowerCase()) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
      return "high";
    default:
      return null;
  }
}

/** Anthropic 要的是思考预算而不是档位，且必须小于 max_tokens。 */
function thinkingBudget(effort: "low" | "medium" | "high", maxTokens: number): number {
  const wanted = effort === "low" ? 2048 : effort === "medium" ? 8192 : 16384;
  return Math.max(1024, Math.min(wanted, maxTokens - 1024));
}

export class ModelProfileStore {
  constructor(cfg: AppConfig) {
    // 首次启动时，把 config.json 里的中转配置导入成第一个档案，避免用户重复配置
    const count = (db.prepare("SELECT COUNT(*) AS n FROM model_profiles").get() as { n: number }).n;
    if (count === 0 && cfg.relay.baseUrl) {
      this.create({
        name: cfg.relay.modelName || "Default relay",
        baseUrl: cfg.relay.baseUrl,
        apiKey: cfg.relay.apiKey,
        api: cfg.relay.api,
        modelId: cfg.relay.modelId,
        modelName: cfg.relay.modelName,
        reasoning: cfg.relay.reasoning,
        thinking: cfg.relay.thinking,
        contextWindow: cfg.relay.contextWindow,
        maxTokens: cfg.relay.maxTokens,
      });
    }
  }

  list(): ModelProfileRow[] {
    return db
      .prepare("SELECT * FROM model_profiles ORDER BY is_default DESC, created_at ASC")
      .all() as ModelProfileRow[];
  }

  get(id: string): ModelProfileRow | undefined {
    return db.prepare("SELECT * FROM model_profiles WHERE id = ?").get(id) as
      | ModelProfileRow
      | undefined;
  }

  getDefault(): ModelProfileRow | undefined {
    return (db.prepare("SELECT * FROM model_profiles WHERE is_default = 1").get() ??
      db.prepare("SELECT * FROM model_profiles ORDER BY created_at ASC LIMIT 1").get()) as
      | ModelProfileRow
      | undefined;
  }

  create(input: ProfileInput): ModelProfileRow {
    const id = randomUUID().slice(0, 8);
    const isFirst =
      (db.prepare("SELECT COUNT(*) AS n FROM model_profiles").get() as { n: number }).n === 0;
    db.prepare(
      `INSERT INTO model_profiles
       (id, name, base_url, api_key, api, model_id, model_name, reasoning, vision,
        vision_profile_id, thinking, context_window, max_tokens, is_default, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.name,
      input.baseUrl,
      input.apiKey,
      input.api,
      input.modelId,
      input.modelName || input.modelId,
      input.reasoning ? 1 : 0,
      input.vision === false ? 0 : 1,
      input.visionProfileId ?? null,
      input.thinking ?? "off",
      input.contextWindow ?? 200000,
      input.maxTokens ?? 8192,
      isFirst ? 1 : 0,
      Date.now(),
    );
    return this.get(id)!;
  }

  update(id: string, input: ProfileInput): ModelProfileRow | undefined {
    if (!this.get(id)) return undefined;
    db.prepare(
      `UPDATE model_profiles SET name=?, base_url=?, api_key=?, api=?, model_id=?, model_name=?,
       reasoning=?, vision=?, vision_profile_id=?, thinking=?, context_window=?, max_tokens=? WHERE id=?`,
    ).run(
      input.name,
      input.baseUrl,
      input.apiKey,
      input.api,
      input.modelId,
      input.modelName || input.modelId,
      input.reasoning ? 1 : 0,
      input.vision === false ? 0 : 1,
      input.visionProfileId ?? null,
      input.thinking ?? "off",
      input.contextWindow ?? 200000,
      input.maxTokens ?? 8192,
      id,
    );
    return this.get(id);
  }

  setDefault(id: string) {
    db.prepare("UPDATE model_profiles SET is_default = 0").run();
    db.prepare("UPDATE model_profiles SET is_default = 1 WHERE id = ?").run(id);
  }

  remove(id: string) {
    const wasDefault = this.get(id)?.is_default === 1;
    db.prepare("DELETE FROM model_profiles WHERE id = ?").run(id);
    // 解绑使用该档案的 Bot，让它们回落到默认档案
    db.prepare("UPDATE bots SET model_profile_id = NULL WHERE model_profile_id = ?").run(id);
    db.prepare("UPDATE model_profiles SET vision_profile_id = NULL WHERE vision_profile_id = ?").run(id);
    if (wasDefault) {
      const next = db.prepare("SELECT id FROM model_profiles ORDER BY created_at ASC LIMIT 1").get() as
        | { id: string }
        | undefined;
      if (next) this.setDefault(next.id);
    }
  }

  toContainerConfig(p: ModelProfileRow): ContainerModelConfig {
    const config: ContainerModelConfig = {
      baseUrl: p.base_url,
      apiKey: p.api_key,
      api: p.api,
      modelId: p.model_id,
      modelName: p.model_name,
      reasoning: p.reasoning === 1,
      vision: p.vision === 1,
      thinking: p.thinking,
      contextWindow: p.context_window,
      maxTokens: p.max_tokens,
    };
    // 主模型没视觉时，自动挑一个有视觉的档案当"眼睛"（默认档案优先）
    if (!config.vision) {
      const selected = p.vision_profile_id ? this.get(p.vision_profile_id) : undefined;
      const helper =
        (selected?.vision === 1 && selected.id !== p.id ? selected : undefined) ??
        [this.getDefault(), ...this.list()].find((c) => c && c.id !== p.id && c.vision === 1) ??
        null;
      if (helper) {
        config.visionHelper = {
          baseUrl: helper.base_url,
          apiKey: helper.api_key,
          api: helper.api,
          modelId: helper.model_id,
        };
      }
    }
    return config;
  }

  /** Bot 的生效档案：显式绑定优先，否则用默认档案 */
  effectiveFor(botProfileId: string | null): ModelProfileRow | undefined {
    if (botProfileId) {
      const p = this.get(botProfileId);
      if (p) return p;
    }
    return this.getDefault();
  }

  /** 从中转拉取可用模型列表（不落库，供设置页选择 Model ID） */
  async fetchModels(
    baseUrl: string,
    apiKey: string,
    api: string,
  ): Promise<{ ok: boolean; models: string[]; detail: string }> {
    const base = baseUrl.replace(/\/+$/, "");
    try {
      let res: Response;
      if (api === "anthropic-messages") {
        res = await fetch(`${base}/v1/models?limit=1000`, {
          headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(20000),
        });
        // 部分中转把 anthropic 也挂在 openai 风格的 /models 下，失败时兜底试一次
        if (!res.ok) {
          const alt = await fetch(`${base}/models`, {
            headers: { authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(20000),
          });
          if (alt.ok) res = alt;
        }
      } else {
        res = await fetch(`${base}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(20000),
        });
      }
      if (!res.ok) {
        const text = (await res.text()).slice(0, 200);
        return { ok: false, models: [], detail: `HTTP ${res.status}: ${text}` };
      }
      const json: any = await res.json();
      const list: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      const models = [...new Set(list.map((m) => String(m?.id ?? m)).filter(Boolean))].sort();
      if (models.length === 0) return { ok: false, models: [], detail: "Endpoint returned no models." };
      return { ok: true, models, detail: `${models.length} models` };
    } catch (err) {
      return { ok: false, models: [], detail: `Connection failed: ${(err as Error).message}` };
    }
  }

  /** 宿主直连补全。复用 test() 的三种 API 分支。 */
  async complete(
    p: ModelProfileRow,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    opts?: { maxTokens?: number; timeoutMs?: number; thinking?: string },
  ): Promise<{ ok: boolean; text: string; detail: string }> {
    const base = p.base_url.replace(/\/+$/, "");
    // 跟随档案里的「最大输出 tokens」：推理模型把思考也算进这个额度，给死值会让
    // 回复在推理阶段就被 finish=length 截断，content 直接为空。
    const maxTokens = opts?.maxTokens ?? p.max_tokens ?? 8192;
    const timeoutMs = opts?.timeoutMs ?? 20_000;
    // 留空就完全不发思考参数：中转不认这些字段时会整条 400，宁可保持端点默认行为。
    const effort = reasoningEffort(opts?.thinking);
    try {
      if (p.api === "anthropic-messages") {
        const system = messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n");
        const rest = messages.filter((message) => message.role !== "system");
        const res = await fetch(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": p.api_key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: p.model_id,
            max_tokens: maxTokens,
            ...(system ? { system } : {}),
            ...(effort
              ? { thinking: { type: "enabled", budget_tokens: thinkingBudget(effort, maxTokens) } }
              : {}),
            messages: rest.map((message) => ({ role: message.role, content: message.content })),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 300);
          return { ok: false, text: "", detail: `HTTP ${res.status}: ${detail}` };
        }
        const json: any = await res.json();
        const text = Array.isArray(json?.content)
          ? json.content.filter((block: any) => block?.type === "text").map((block: any) => block.text).join("")
          : "";
        const stop = String(json?.stop_reason ?? "");
        return { ok: true, text, detail: `HTTP ${res.status}${stop ? ` stop=${stop}` : ""}` };
      }
      if (p.api === "openai-responses") {
        const res = await fetch(`${base}/responses`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` },
          body: JSON.stringify({
            model: p.model_id,
            max_output_tokens: maxTokens,
            ...(effort ? { reasoning: { effort } } : {}),
            input: messages.map((message) => ({ role: message.role, content: message.content })),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 300);
          return { ok: false, text: "", detail: `HTTP ${res.status}: ${detail}` };
        }
        const json: any = await res.json();
        let text = typeof json?.output_text === "string" ? json.output_text : "";
        if (!text && Array.isArray(json?.output)) {
          text = json.output
            .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
            .filter((block: any) => block?.type === "output_text" || block?.type === "text")
            .map((block: any) => block.text ?? "")
            .join("");
        }
        return { ok: true, text, detail: `HTTP ${res.status}` };
      }
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` },
        body: JSON.stringify({
          model: p.model_id,
          max_tokens: maxTokens,
          ...(effort ? { reasoning_effort: effort } : {}),
          messages: messages.map((message) => ({ role: message.role, content: message.content })),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        return { ok: false, text: "", detail: `HTTP ${res.status}: ${detail}` };
      }
      const json: any = await res.json();
      const choice = json?.choices?.[0];
      const text = String(choice?.message?.content ?? "");
      // 推理模型烧完预算时 content 为空、finish_reason=length，不带出去就只能看到「空回复」。
      const finish = String(choice?.finish_reason ?? "");
      return { ok: true, text, detail: `HTTP ${res.status}${finish ? ` finish=${finish}` : ""}` };
    } catch (err) {
      return { ok: false, text: "", detail: `Connection failed: ${(err as Error).message}` };
    }
  }

  /** 用最小请求探活，帮用户快速判断中转地址/密钥是否可用 */
  async test(p: ModelProfileRow): Promise<{ ok: boolean; detail: string }> {
    const base = p.base_url.replace(/\/+$/, "");
    try {
      if (p.api === "anthropic-messages") {
        const res = await fetch(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": p.api_key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: p.model_id,
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
          signal: AbortSignal.timeout(20000),
        });
        return this.describe(res);
      }
      const path = p.api === "openai-responses" ? "/responses" : "/chat/completions";
      const body =
        p.api === "openai-responses"
          ? { model: p.model_id, input: "hi", max_output_tokens: 16 }
          : { model: p.model_id, messages: [{ role: "user", content: "hi" }], max_tokens: 1 };
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      return this.describe(res);
    } catch (err) {
      return { ok: false, detail: `Connection failed: ${(err as Error).message}` };
    }
  }

  private async describe(res: Response): Promise<{ ok: boolean; detail: string }> {
    if (res.ok) return { ok: true, detail: `HTTP ${res.status} — endpoint and key look good.` };
    const text = (await res.text()).slice(0, 300);
    return { ok: false, detail: `HTTP ${res.status}: ${text}` };
  }
}
