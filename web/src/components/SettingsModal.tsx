import { useEffect, useState } from "react";
import type {
  DiscoveredMcpTool,
  McpServer,
  McpServerInput,
  McpToolConfig,
  ModelProfile,
  ProfileInput,
  Skill,
} from "../types";
import { api } from "../api";
import { store, useStore } from "../store";
import { CloseIcon, PlusIcon } from "./icons";
import { prefs, usePrefs } from "../prefs";

type Tab = "models" | "mcp" | "approvals" | "skills" | "general" | "about";

interface Props {
  onClose: () => void;
  initialTab?: Tab;
}

const API_FORMATS = [
  { id: "openai-completions", label: "OpenAI 兼容 (chat/completions)" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "anthropic-messages", label: "Anthropic Messages" },
];

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

const emptyForm: ProfileInput = {
  name: "",
  baseUrl: "",
  apiKey: "",
  api: "openai-completions",
  modelId: "",
  modelName: "",
  reasoning: false,
  vision: true,
  visionProfileId: null,
  thinking: "off",
  contextWindow: 200000,
  maxTokens: 8192,
};

export function SettingsModal({ onClose, initialTab = "models" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 设置页里常有填了一半的表单，点到遮罩上不关闭，只能用右上角 × 或 Esc 关
  return (
    <div style={backdrop}>
      <div style={modal}>
        <aside style={nav}>
          <div style={navTitle}>Settings</div>
          <NavItem active={tab === "models"} onClick={() => setTab("models")}>
            Models
          </NavItem>
          <NavItem active={tab === "mcp"} onClick={() => setTab("mcp")}>
            MCP
          </NavItem>
          <NavItem active={tab === "approvals"} onClick={() => setTab("approvals")}>
            Approvals
          </NavItem>
          <NavItem active={tab === "skills"} onClick={() => setTab("skills")}>
            Skills
          </NavItem>
          <NavItem active={tab === "general"} onClick={() => setTab("general")}>
            General
          </NavItem>
          <NavItem active={tab === "about"} onClick={() => setTab("about")}>
            About
          </NavItem>
        </aside>

        <section style={content}>
          <button style={closeBtn} onClick={onClose} title="Close">
            <CloseIcon />
          </button>
          {tab === "models" && <ModelsTab />}
          {tab === "mcp" && <McpTab />}
          {tab === "approvals" && <ApprovalRulesTab />}
          {tab === "skills" && <SkillsTab />}
          {tab === "general" && <GeneralTab />}
          {tab === "about" && <AboutTab />}
        </section>
      </div>
    </div>
  );
}

function NavItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button style={{ ...navItem, ...(active ? navItemActive : {}) }} onClick={onClick}>
      {children}
    </button>
  );
}

// ---------------- Models ----------------

function ModelsTab() {
  const profiles = useStore((s) => s.profiles);
  const [editing, setEditing] = useState<ModelProfile | "new" | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; ok: boolean; detail: string } | null>(null);

  const runTest = async (p: ModelProfile) => {
    setTesting(p.id);
    setResult(null);
    try {
      const r = await api.testProfile(p.id);
      setResult({ id: p.id, ...r });
    } catch (e) {
      setResult({ id: p.id, ok: false, detail: String(e) });
    } finally {
      setTesting(null);
    }
  };

  if (editing) {
    return (
      <ProfileForm
        profile={editing === "new" ? null : editing}
        onDone={async () => {
          await store.refreshProfiles();
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      <h2 style={h2}>Models</h2>
      <p style={hint}>
        保存多套 LLM 配置，不同 Bot 可以使用不同模型。标记为 Default 的配置用于新建 Bot 和未单独指定模型的 Bot。
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        {profiles.map((p) => (
          <div key={p.id} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
              {p.is_default === 1 && <span style={badge}>Default</span>}
              {p.vision !== 1 && <span style={mutedBadge}>text-only</span>}
              <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-secondary)" }}>
                {p.api}
              </span>
            </div>
            <div style={cardMeta}>
              {p.model_id} · {p.base_url}
            </div>
            {result?.id === p.id && (
              <div style={{ ...testResult, color: result.ok ? "var(--green-dot)" : "#ef4444" }}>
                {result.detail}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button style={smallBtn} onClick={() => runTest(p)} disabled={testing === p.id}>
                {testing === p.id ? "Testing…" : "Test"}
              </button>
              <button style={smallBtn} onClick={() => setEditing(p)}>
                Edit
              </button>
              {p.is_default !== 1 && (
                <button
                  style={smallBtn}
                  onClick={async () => {
                    await api.setDefaultProfile(p.id);
                    store.refreshProfiles();
                  }}
                >
                  Set default
                </button>
              )}
              <button
                style={{ ...smallBtn, color: "#ef4444" }}
                onClick={async () => {
                  if (!confirm(`Delete model config "${p.name}"?`)) return;
                  await api.deleteProfile(p.id);
                  store.refreshProfiles();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        {profiles.length === 0 && (
          <div style={{ ...hint, padding: "20px 0" }}>
            还没有模型配置。添加一个中转地址和 API key，Bot 才能真正对话。
          </div>
        )}
      </div>

      <button style={addBtn} onClick={() => setEditing("new")}>
        <PlusIcon size={16} />
        <span>Add model</span>
      </button>
    </div>
  );
}

function ProfileForm({
  profile,
  onDone,
  onCancel,
}: {
  profile: ModelProfile | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const profiles = useStore((s) => s.profiles);
  const [f, setF] = useState<ProfileInput>(
    profile
      ? {
          name: profile.name,
          baseUrl: profile.base_url,
          apiKey: profile.api_key,
          api: profile.api,
          modelId: profile.model_id,
          modelName: profile.model_name,
          reasoning: profile.reasoning === 1,
          vision: profile.vision === 1,
          visionProfileId: profile.vision_profile_id,
          thinking: profile.thinking,
          contextWindow: profile.context_window,
          maxTokens: profile.max_tokens,
        }
      : emptyForm,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modelList, setModelList] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState("");

  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const fetchModels = async () => {
    if (!f.baseUrl.trim()) {
      setFetchErr("先填 Base URL 再拉取。");
      return;
    }
    setFetching(true);
    setFetchErr("");
    setModelList(null);
    try {
      const r = await api.fetchModels(f.baseUrl.trim(), f.apiKey, f.api);
      if (r.ok) setModelList(r.models);
      else setFetchErr(r.detail);
    } catch (e) {
      setFetchErr(String(e));
    } finally {
      setFetching(false);
    }
  };

  // 输入框内容同时作为列表过滤词
  const filteredModels =
    modelList?.filter((m) => m.toLowerCase().includes(f.modelId.trim().toLowerCase())) ?? null;

  const save = async () => {
    if (!f.name.trim() || !f.baseUrl.trim() || !f.modelId.trim()) {
      setError("Name、Base URL、Model ID 为必填项。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = { ...f, modelName: f.modelName.trim() || f.modelId.trim() };
      if (profile) await api.updateProfile(profile.id, payload);
      else await api.createProfile(payload);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 style={h2}>{profile ? "Edit model" : "Add model"}</h2>

      <Field label="配置名称">
        <input style={input} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. 我的中转 - Claude" />
      </Field>

      <Field label="API 格式">
        <select style={input} value={f.api} onChange={(e) => set("api", e.target.value)}>
          {API_FORMATS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Base URL" hint="OpenAI 兼容通常以 /v1 结尾；Anthropic 格式填到域名即可">
        <input style={input} value={f.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="https://your-relay.com/v1" />
      </Field>

      <Field label="API Key">
        <input style={input} type="password" value={f.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder="sk-..." />
      </Field>

      <Field label="Model ID" hint={modelList ? "输入可过滤列表，点击条目填入" : undefined}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...input, flex: 1 }}
            value={f.modelId}
            onChange={(e) => set("modelId", e.target.value)}
            placeholder="gpt-4o / claude-opus-4-5"
          />
          <button style={{ ...smallBtn, flexShrink: 0 }} onClick={fetchModels} disabled={fetching}>
            {fetching ? "Fetching…" : "Fetch models"}
          </button>
        </div>
        {fetchErr && <div style={{ ...testResult, color: "#ef4444" }}>{fetchErr}</div>}
        {filteredModels && (
          <div style={modelListBox}>
            {filteredModels.length === 0 && (
              <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-secondary)" }}>
                No models match "{f.modelId}"
              </div>
            )}
            {filteredModels.map((m) => (
              <button
                key={m}
                style={{
                  ...modelListItem,
                  fontWeight: m === f.modelId ? 600 : 400,
                  color: m === f.modelId ? "var(--text-primary)" : "var(--text-secondary)",
                }}
                onClick={() => set("modelId", m)}
              >
                {m === f.modelId ? "● " : ""}
                {m}
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field label="显示名称（可选）">
        <input style={input} value={f.modelName} onChange={(e) => set("modelName", e.target.value)} placeholder="留空则与 Model ID 相同" />
      </Field>

      <div style={row2}>
        <Field label="上下文窗口">
          <input style={input} type="number" value={f.contextWindow} onChange={(e) => set("contextWindow", Number(e.target.value))} />
        </Field>
        <Field label="最大输出 tokens">
          <input style={input} type="number" value={f.maxTokens} onChange={(e) => set("maxTokens", Number(e.target.value))} />
        </Field>
      </div>

      <div style={row2}>
        <Field label="支持思考/推理">
          <label style={checkRow}>
            <input type="checkbox" checked={f.reasoning} onChange={(e) => set("reasoning", e.target.checked)} />
            <span style={{ fontSize: 13 }}>该模型支持 extended thinking</span>
          </label>
        </Field>
        <Field label="思考强度">
          <select style={input} value={f.thinking} onChange={(e) => set("thinking", e.target.value)} disabled={!f.reasoning}>
            {THINKING_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="视觉能力"
        hint="关闭后浏览器工具改回传文字快照；截图类工具会自动找一个有视觉的档案当「眼睛」转述画面"
      >
        <label style={checkRow}>
          <input type="checkbox" checked={f.vision} onChange={(e) => set("vision", e.target.checked)} />
          <span style={{ fontSize: 13 }}>该模型支持图片输入（视觉）</span>
        </label>
      </Field>

      {!f.vision && (
        <Field
          label="视觉辅助模型"
          hint="截图会先交给该视觉模型描述，再把纯文字结果交给当前模型；不选则自动使用第一个有视觉能力的档案"
        >
          <select
            style={input}
            value={f.visionProfileId ?? ""}
            onChange={(e) => set("visionProfileId", e.target.value || null)}
          >
            <option value="">Auto select</option>
            {profiles
              .filter((p) => p.vision === 1 && p.id !== profile?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model_id}
                </option>
              ))}
          </select>
        </Field>
      )}

      {error && <div style={{ ...testResult, color: "#ef4444" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button style={primaryBtn} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button style={smallBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint: fieldHint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>{label}</label>
      {children}
      {fieldHint && <div style={fieldHintStyle}>{fieldHint}</div>}
    </div>
  );
}

// ---------------- MCP ----------------

interface McpFormState {
  name: string;
  transport: "stdio" | "http";
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  enabled: boolean;
  defaultPolicy: "auto" | "ask" | "allow";
  toolConfig: McpToolConfig;
}

const emptyMcpForm: McpFormState = {
  name: "",
  transport: "stdio",
  command: "npx",
  argsText: "-y\n",
  envText: "{}",
  url: "",
  headersText: "{}",
  enabled: true,
  defaultPolicy: "auto",
  toolConfig: {},
};

function McpTab() {
  const servers = useStore((s) => s.mcpServers);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const runTest = async (server: McpServer) => {
    setTesting(server.id);
    try {
      await api.testMcpServer(server.id);
    } finally {
      await store.refreshMcpServers();
      setTesting(null);
    }
  };

  const setToolEnabled = async (server: McpServer, toolName: string, enabled: boolean) => {
    const toolConfig = safeToolConfig(server.tool_config);
    toolConfig[toolName] = { enabled };
    await api.updateMcpServer(server.id, mcpServerInput(server, toolConfig));
    await store.refreshMcpServers();
  };

  if (editing) {
    return (
      <McpForm
        server={editing === "new" ? null : editing}
        onDone={async () => {
          await store.refreshMcpServers();
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      <h2 style={h2}>MCP Servers</h2>
      <p style={hint}>
        MCP 运行在共享电脑里，所有 Bot 共用。支持本地 stdio package 和远程 Streamable
        HTTP（兼容旧 SSE）。文本模型收到 MCP 图片时会自动交给视觉辅助模型转述。
      </p>

      <div style={{ ...warningBox, marginTop: 14 }}>
        stdio MCP 可以在容器内执行命令。只添加你信任的 package，并把敏感环境变量限制到最低范围。
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {servers.map((server) => {
          const tools = safeTools(server.discovered_tools);
          const toolConfig = safeToolConfig(server.tool_config);
          const isExpanded = expanded === server.id;
          const statusColor =
            server.last_status === "connected"
              ? "#22c55e"
              : server.last_status === "error"
                ? "#ef4444"
                : server.last_status === "testing"
                  ? "#3b82f6"
                  : "var(--text-placeholder)";
          return (
            <div key={server.id} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{server.name}</span>
                <span style={mutedBadge}>{server.transport}</span>
                <span style={mutedBadge}>{server.default_policy}</span>
                <span
                  title={server.last_error || server.last_status}
                  style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor }}
                />
                <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                    {server.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <input
                    type="checkbox"
                    checked={server.enabled === 1}
                    onChange={async (e) => {
                      await api.toggleMcpServer(server.id, e.target.checked);
                      store.refreshMcpServers();
                    }}
                  />
                </label>
              </div>
              <div style={cardMeta}>
                {server.transport === "stdio"
                  ? [server.command, ...safeStringArray(server.args)].join(" ")
                  : server.url}
              </div>
              {server.last_error && (
                <div style={{ ...testResult, color: "#ef4444" }}>{server.last_error}</div>
              )}
              {server.last_checked_at && !server.last_error && (
                <div style={{ ...cardMeta, fontSize: 11 }}>
                  Connected · {tools.length} tools ·{" "}
                  {new Date(server.last_checked_at).toLocaleString()}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  style={smallBtn}
                  onClick={() => runTest(server)}
                  disabled={testing === server.id}
                >
                  {testing === server.id ? "Testing…" : "Test connection"}
                </button>
                {tools.length > 0 && (
                  <button
                    style={smallBtn}
                    onClick={() => setExpanded(isExpanded ? null : server.id)}
                  >
                    {isExpanded ? "Hide tools" : `Tools (${tools.length})`}
                  </button>
                )}
                <button style={smallBtn} onClick={() => setEditing(server)}>
                  Edit
                </button>
                <button
                  style={{ ...smallBtn, color: "#ef4444" }}
                  onClick={async () => {
                    if (!confirm(`Delete MCP server "${server.name}"?`)) return;
                    await api.deleteMcpServer(server.id);
                    store.refreshMcpServers();
                  }}
                >
                  Delete
                </button>
              </div>
              {isExpanded && (
                <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 12 }}>
                  {tools.map((tool) => (
                    <label
                      key={tool.name}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "9px 0",
                        borderBottom: "1px solid var(--border-subtle)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={toolConfig[tool.name]?.enabled !== false}
                        onChange={(e) => setToolEnabled(server, tool.name, e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{tool.name}</span>
                        {tool.readOnlyHint && <span style={{ ...mutedBadge, marginLeft: 6 }}>read</span>}
                        <span
                          style={{
                            display: "block",
                            color: "var(--text-secondary)",
                            fontSize: 11.5,
                            lineHeight: 1.4,
                            marginTop: 2,
                          }}
                        >
                          {tool.description || "No description"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {servers.length === 0 && (
          <div style={{ ...hint, padding: "20px 0" }}>
            还没有 MCP server。添加后，对 Bot 说“列出 MCP 工具”即可检查连接。
          </div>
        )}
      </div>

      <button style={addBtn} onClick={() => setEditing("new")}>
        <PlusIcon size={16} />
        <span>Add MCP server</span>
      </button>
    </div>
  );
}

function safeTools(value: string): DiscoveredMcpTool[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeToolConfig(value: string): McpToolConfig {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeStringRecord(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mcpServerInput(server: McpServer, toolConfig = safeToolConfig(server.tool_config)): McpServerInput {
  return {
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: safeStringArray(server.args),
    env: safeStringRecord(server.env),
    url: server.url,
    headers: safeStringRecord(server.headers),
    enabled: server.enabled === 1,
    defaultPolicy: server.default_policy,
    toolConfig,
  };
}

function safeStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeObjectText(value: string): string {
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return "{}";
  }
}

function McpForm({
  server,
  onDone,
  onCancel,
}: {
  server: McpServer | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<McpFormState>(
    server
      ? {
          name: server.name,
          transport: server.transport,
          command: server.command,
          argsText: safeStringArray(server.args).join("\n"),
          envText: safeObjectText(server.env),
          url: server.url,
          headersText: safeObjectText(server.headers),
          enabled: server.enabled === 1,
          defaultPolicy: server.default_policy,
          toolConfig: safeToolConfig(server.tool_config),
        }
      : emptyMcpForm,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const parseObject = (text: string, label: string): Record<string, string> => {
    const value = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label} 必须是 JSON object。`);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const input: McpServerInput = {
        name: f.name.trim(),
        transport: f.transport,
        enabled: f.enabled,
        defaultPolicy: f.defaultPolicy,
        toolConfig: f.toolConfig,
        ...(f.transport === "stdio"
          ? {
              command: f.command.trim(),
              args: f.argsText
                .split(/\r?\n/)
                .map((v) => v.trim())
                .filter(Boolean),
              env: parseObject(f.envText, "Environment"),
            }
          : {
              url: f.url.trim(),
              headers: parseObject(f.headersText, "Headers"),
            }),
      };
      if (server) await api.updateMcpServer(server.id, input);
      else await api.createMcpServer(input);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 style={h2}>{server ? "Edit MCP server" : "Add MCP server"}</h2>
      <p style={hint}>配置会热更新，不会重启共享电脑或中断正在工作的 Bot。</p>

      <Field label="名称">
        <input
          style={input}
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="e.g. Visual Inspector"
        />
      </Field>

      <Field label="Transport">
        <select
          style={input}
          value={f.transport}
          onChange={(e) =>
            setF({ ...f, transport: e.target.value as "stdio" | "http" })
          }
        >
          <option value="stdio">stdio · local package</option>
          <option value="http">Streamable HTTP / SSE</option>
        </select>
      </Field>

      <Field
        label="默认审批策略"
        hint="Auto：只读自动放行、写操作询问；Ask：全部询问；Allow：默认放行。Require Approval 规则始终优先。"
      >
        <select
          style={input}
          value={f.defaultPolicy}
          onChange={(e) =>
            setF({ ...f, defaultPolicy: e.target.value as "auto" | "ask" | "allow" })
          }
        >
          <option value="auto">Auto · 写操作询问</option>
          <option value="ask">Ask every time</option>
          <option value="allow">Allow by default</option>
        </select>
      </Field>

      {f.transport === "stdio" ? (
        <>
          <Field label="Command" hint="npm package 通常填 npx">
            <input
              style={input}
              value={f.command}
              onChange={(e) => setF({ ...f, command: e.target.value })}
              placeholder="npx"
            />
          </Field>
          <Field
            label="Arguments"
            hint={"每行一个参数。npm package 示例：第一行 -y，第二行 @scope/package"}
          >
            <textarea
              style={{ ...input, minHeight: 90, resize: "vertical", fontFamily: "monospace" }}
              value={f.argsText}
              onChange={(e) => setF({ ...f, argsText: e.target.value })}
            />
          </Field>
          <Field label="Environment (JSON)" hint="已保存的值显示为空；保留空值不会覆盖 secret">
            <textarea
              style={{ ...input, minHeight: 90, resize: "vertical", fontFamily: "monospace" }}
              value={f.envText}
              onChange={(e) => setF({ ...f, envText: e.target.value })}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="MCP URL">
            <input
              style={input}
              value={f.url}
              onChange={(e) => setF({ ...f, url: e.target.value })}
              placeholder="https://example.com/mcp"
            />
          </Field>
          <Field label="Headers (JSON)" hint='已保存的值显示为空；例如 {"Authorization":"Bearer ..."}'>
            <textarea
              style={{ ...input, minHeight: 90, resize: "vertical", fontFamily: "monospace" }}
              value={f.headersText}
              onChange={(e) => setF({ ...f, headersText: e.target.value })}
            />
          </Field>
        </>
      )}

      <label style={checkRow}>
        <input
          type="checkbox"
          checked={f.enabled}
          onChange={(e) => setF({ ...f, enabled: e.target.checked })}
        />
        <span style={{ fontSize: 13 }}>保存后立即启用</span>
      </label>

      {error && <div style={{ ...testResult, color: "#ef4444" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button style={primaryBtn} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button style={smallBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------- Approval rules ----------------

function ApprovalRulesTab() {
  const rules = useStore((s) => s.approvalRules);
  const servers = useStore((s) => s.mcpServers);
  const [action, setAction] = useState<"require" | "allow">("require");
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const [toolName, setToolName] = useState("*");
  const [busy, setBusy] = useState(false);
  const selected = servers.find((server) => server.id === serverId);
  const tools = selected ? safeTools(selected.discovered_tools) : [];

  const add = async () => {
    if (!serverId) return;
    setBusy(true);
    try {
      await api.createApprovalRule({ action, serverId, toolName });
      await store.refreshApprovalRules();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 style={h2}>Approval Rules</h2>
      <p style={hint}>
        控制 MCP 工具执行前是否需要确认。Require Approval 永远优先于 Always Allow；
        未命中规则时使用 MCP server 的默认策略。
      </p>

      <div style={{ ...card, marginTop: 16 }}>
        <Field label="Rule">
          <select
            style={input}
            value={action}
            onChange={(e) => setAction(e.target.value as "require" | "allow")}
          >
            <option value="require">Require Approval</option>
            <option value="allow">Always Allow</option>
          </select>
        </Field>
        <Field label="MCP server">
          <select
            style={input}
            value={serverId}
            onChange={(e) => {
              setServerId(e.target.value);
              setToolName("*");
            }}
          >
            {servers.length === 0 && <option value="">No MCP servers</option>}
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scope" hint="先在 MCP 页面 Test connection，才能按发现到的工具选择。">
          <select style={input} value={toolName} onChange={(e) => setToolName(e.target.value)}>
            <option value="*">All tools on this server</option>
            {tools.map((tool) => (
              <option key={tool.name} value={tool.name}>
                {tool.name}
              </option>
            ))}
          </select>
        </Field>
        <button style={primaryBtn} onClick={add} disabled={busy || !serverId}>
          {busy ? "Saving…" : "Add rule"}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        {rules.map((rule) => {
          const server = servers.find((item) => item.id === rule.server_id);
          return (
            <div key={rule.id} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    ...mutedBadge,
                    color: rule.action === "require" ? "#f59e0b" : "#22c55e",
                  }}
                >
                  {rule.action === "require" ? "Require Approval" : "Always Allow"}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {server?.name ?? "Deleted server"}
                </span>
                <code style={{ ...code, color: "var(--text-secondary)" }}>
                  {rule.tool_name === "*" ? "all tools" : rule.tool_name}
                </code>
                <button
                  style={{ ...smallBtn, color: "#ef4444", marginLeft: "auto" }}
                  onClick={async () => {
                    await api.deleteApprovalRule(rule.id);
                    store.refreshApprovalRules();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {rules.length === 0 && (
          <div style={{ ...hint, padding: "16px 0" }}>
            还没有显式规则。MCP 默认使用各 server 的 Auto 策略。
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Skills ----------------

const emptySkill = { name: "", description: "", content: "" };

function SkillsTab() {
  const skills = useStore((s) => s.skills);
  const [editing, setEditing] = useState<Skill | "new" | null>(null);

  if (editing) {
    return (
      <SkillForm
        skill={editing === "new" ? null : editing}
        onDone={async () => {
          await store.refreshSkills();
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      <h2 style={h2}>Skills</h2>
      <p style={hint}>
        Skill 是可复用的"做事方法"，全部 Bot 共享。在输入框里键入 <code style={code}>/</code>{" "}
        引用；也可以直接让 Bot "把刚才的流程存成 skill"。
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        {skills.map((s) => (
          <div key={s.id} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>/{s.slug}</span>
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{s.name}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-placeholder)" }}>
                {s.created_by.startsWith("bot:") ? `by ${s.created_by.slice(4)}` : "by you"}
              </span>
            </div>
            {s.description && <div style={cardMeta}>{s.description}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button style={smallBtn} onClick={() => setEditing(s)}>
                Edit
              </button>
              <button
                style={{ ...smallBtn, color: "#ef4444" }}
                onClick={async () => {
                  if (!confirm(`Delete skill "/${s.slug}"?`)) return;
                  await api.deleteSkill(s.id);
                  store.refreshSkills();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {skills.length === 0 && (
          <div style={{ ...hint, padding: "20px 0" }}>
            还没有 skill。完成一次满意的任务后，让 Bot "存成 skill"，或在这里手动添加。
          </div>
        )}
      </div>

      <button style={addBtn} onClick={() => setEditing("new")}>
        <PlusIcon size={16} />
        <span>Add skill</span>
      </button>
    </div>
  );
}

function SkillForm({
  skill,
  onDone,
  onCancel,
}: {
  skill: Skill | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState(
    skill
      ? { name: skill.name, description: skill.description, content: skill.content }
      : emptySkill,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!f.name.trim() || !f.content.trim()) {
      setError("Name 和 Content 为必填项。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (skill) await api.updateSkill(skill.id, f);
      else await api.createSkill(f);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 style={h2}>{skill ? `Edit /${skill.slug}` : "Add skill"}</h2>

      <Field label="名称" hint="引用 slug 由名称生成，例如 'Weekly report' → /weekly-report">
        <input style={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Weekly account health" />
      </Field>

      <Field label="一句话说明（可选）">
        <input style={input} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="什么时候用这个 skill" />
      </Field>

      <Field label="内容（markdown）" hint="建议包含：何时使用、所需输入、步骤、如何校验、返回什么、哪些操作要审批">
        <textarea
          style={{ ...input, minHeight: 220, resize: "vertical", fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5 }}
          value={f.content}
          onChange={(e) => setF({ ...f, content: e.target.value })}
        />
      </Field>

      {error && <div style={{ ...testResult, color: "#ef4444" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button style={primaryBtn} onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button style={smallBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------- General ----------------

function GeneralTab() {
  const p = usePrefs();
  return (
    <div>
      <h2 style={h2}>General</h2>
      <p style={hint}>界面偏好保存在本机浏览器。</p>

      <Toggle
        label="默认展开 Bot 的电脑面板"
        desc="打开某个 Bot 时自动显示右侧屏幕与例行任务面板"
        checked={p.panelOpenByDefault}
        onChange={(v) => prefs.set({ panelOpenByDefault: v })}
      />
      <Toggle
        label="发送前确认删除"
        desc="删除 Bot 或群聊线程时弹出确认框"
        checked={p.confirmDestructive}
        onChange={(v) => prefs.set({ confirmDestructive: v })}
      />
      <Toggle
        label="显示工作记录"
        desc="关闭后，会话中不再显示 Bot 调用工具的过程，只保留对话"
        checked={p.showToolCards}
        onChange={(v) => prefs.set({ showToolCards: v })}
      />
      <Toggle
        label="显示系统提示行"
        desc="模型报错、权限变更等系统消息"
        checked={p.showSystemLines}
        onChange={(v) => prefs.set({ showSystemLines: v })}
      />
      <Toggle
        label="桌面通知"
        desc="Bot 需要审批或完成任务时，如果你不在看这个页面就发系统通知"
        checked={p.notifications}
        onChange={async (v) => {
          if (v && typeof Notification !== "undefined" && Notification.permission !== "granted") {
            const perm = await Notification.requestPermission();
            if (perm !== "granted") return;
          }
          prefs.set({ notifications: v });
        }}
      />
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={toggleRow}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{desc}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, flexShrink: 0 }}
      />
    </label>
  );
}

// ---------------- About ----------------

function AboutTab() {
  const [cfg, setCfg] = useState<{ image: string; serverPort: number } | null>(null);
  const bots = useStore((s) => s.bots);
  const profiles = useStore((s) => s.profiles);

  useEffect(() => {
    api.config().then(setCfg).catch(() => setCfg(null));
  }, []);

  return (
    <div>
      <h2 style={h2}>About</h2>
      <p style={hint}>
        Pibot — 本机单用户版 Grok Bot 复刻。所有 Bot 共享一台 Docker 电脑，Bot 会话相互独立，大脑层基于 pi-sdk。
      </p>
      <dl style={{ margin: "16px 0 0" }}>
        <Row k="Bots" v={String(bots.length)} />
        <Row k="Model configs" v={String(profiles.length)} />
        <Row k="Container image" v={cfg?.image ?? "—"} />
        <Row k="Server" v={cfg ? `http://localhost:${cfg.serverPort}` : "—"} />
      </dl>
      <p style={{ ...hint, marginTop: 16 }}>
        提示：请用 <code style={code}>localhost</code> 访问本界面。KasmVNC 要求安全上下文，
        换成局域网 IP 时 Bot 的电脑面板无法显示画面。
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={aboutRow}>
      <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{k}</span>
      <span style={{ fontSize: 13 }}>{v}</span>
    </div>
  );
}

// ---------------- styles ----------------

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "grid",
  placeItems: "center",
  zIndex: 45,
  backdropFilter: "blur(2px)",
};
const modal: React.CSSProperties = {
  width: 820,
  maxWidth: "94vw",
  height: 600,
  maxHeight: "90vh",
  display: "flex",
  background: "var(--bg-sidebar)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 16,
  overflow: "hidden",
  animation: "fade-up 0.2s ease",
};
const nav: React.CSSProperties = {
  width: 180,
  minWidth: 180,
  borderRight: "1px solid var(--border-subtle)",
  padding: "18px 10px",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};
const navTitle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  padding: "0 10px 10px",
};
const navItem: React.CSSProperties = {
  textAlign: "left",
  fontSize: 13.5,
  padding: "9px 10px",
  borderRadius: 8,
  color: "var(--text-primary)",
};
const navItemActive: React.CSSProperties = { background: "var(--bg-active)", fontWeight: 600 };
const content: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "22px 24px",
  overflowY: "auto",
  position: "relative",
};
const closeBtn: React.CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  width: 30,
  height: 30,
  borderRadius: 7,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
};
const h2: React.CSSProperties = { fontSize: 18, fontWeight: 600, margin: "0 0 6px" };
const hint: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
  margin: 0,
};
const warningBox: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: "#d6a84b",
  background: "rgba(214,168,75,0.08)",
  border: "1px solid rgba(214,168,75,0.22)",
  borderRadius: 8,
  padding: "9px 11px",
};
const card: React.CSSProperties = {
  background: "var(--bg-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 10,
  padding: "12px 14px",
};
const cardMeta: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  marginTop: 4,
  wordBreak: "break-all",
};
const badge: React.CSSProperties = {
  fontSize: 10.5,
  background: "#fff",
  color: "#000",
  fontWeight: 600,
  padding: "1px 7px",
  borderRadius: 8,
};
const mutedBadge: React.CSSProperties = {
  fontSize: 10.5,
  background: "var(--bg-active)",
  color: "var(--text-secondary)",
  fontWeight: 500,
  padding: "1px 7px",
  borderRadius: 8,
};
const testResult: React.CSSProperties = {
  fontSize: 12,
  marginTop: 8,
  lineHeight: 1.5,
  wordBreak: "break-word",
};
const smallBtn: React.CSSProperties = {
  background: "var(--bg-active)",
  fontSize: 12.5,
  padding: "6px 12px",
  borderRadius: 7,
  color: "var(--text-primary)",
};
const primaryBtn: React.CSSProperties = {
  background: "#fff",
  color: "#000",
  fontWeight: 600,
  fontSize: 13,
  padding: "8px 18px",
  borderRadius: 8,
};
const addBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  marginTop: 14,
  background: "var(--bg-active)",
  fontSize: 13,
  padding: "9px 14px",
  borderRadius: 8,
  color: "var(--text-primary)",
};
const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--text-secondary)",
  marginBottom: 5,
};
const fieldHintStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-placeholder)",
  marginTop: 4,
};
const input: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 8,
  padding: "8px 11px",
  fontSize: 13.5,
  outline: "none",
};
const row2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const modelListBox: React.CSSProperties = {
  marginTop: 8,
  maxHeight: 180,
  overflowY: "auto",
  background: "var(--bg-input)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 8,
  padding: 4,
};
const modelListItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontSize: 12.5,
  fontFamily: "ui-monospace, Consolas, monospace",
  padding: "5px 8px",
  borderRadius: 6,
};
const checkRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  height: 36,
};
const toggleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 20,
  padding: "12px 0",
  borderBottom: "1px solid var(--border-subtle)",
  cursor: "pointer",
};
const aboutRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 20,
  padding: "8px 0",
  borderBottom: "1px solid var(--border-subtle)",
};
const code: React.CSSProperties = {
  background: "var(--code-bg)",
  color: "var(--code-pink)",
  padding: "1px 5px",
  borderRadius: 4,
  fontSize: "0.92em",
};
