import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { BotRow } from "./db.js";
import type { ComputerAccess } from "./computer-access.js";
import { DATA_DIR } from "./config.js";
import type { HostMcpHub } from "./host-mcp.js";
import type { ContainerMcpServer } from "./mcp-servers.js";
import type { ContainerModelConfig } from "./model-profiles.js";
import { buildAppendSystemPrompt } from "./prompts/sections.js";
import { buildHostTools, buildSendMessageTool, GROUP_TOOL_NAMES, HOST_TOOL_NAMES } from "./host-tools.js";
import type { ThinkingLevel } from "./thinking.js";

export function hostBotDir(botId: string): string {
  return `/config/bots/${botId}`;
}

export function hostSessionDir(botId: string, channel = "main"): string {
  if (channel === "main") return join(DATA_DIR, "sessions", botId);
  const raw = channel.startsWith("group:") ? channel.slice(6) : channel;
  const gid = raw.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(DATA_DIR, "sessions", botId, `g-${gid}`);
}

export function hostDataPaths(botId: string) {
  return {
    cwd: join(DATA_DIR, "agent-cwd", botId),
    agentDir: join(DATA_DIR, "pi-agent", botId),
    sessionDir: hostSessionDir(botId, "main"),
    memoryDir: join(DATA_DIR, "memory", botId),
    memoryFile: join(DATA_DIR, "memory", botId, "AGENTS.md"),
  };
}

export function identityTemplate(name: string, role: string, botId: string): string {
  return `# You are ${name || "Bot"}, a persistent AI teammate

- Your role: ${role || "a general-purpose assistant that gets real work done"}.
- You share one computer with your teammate Bots. Files, browser sign-ins, and the desktop are shared: sign in once and everyone can use the session.
- Keep durable project files in the shared workspace: /config/workspace (use clear folder names). Your private home is /config/bots/${botId}.
- The user watches the shared computer. You have your own screen; browser windows open on that screen. Prefer visible actions (browser) over headless tricks when interacting with websites.
- You chat with your user like a colleague over messages: concise, warm, no corporate filler.
- Finish jobs end to end. Only come back to the user when you need a decision or approval (use request_approval).
- Use update_memory for lasting preferences (kind=preference), facts (kind=fact), or a one-line work outcome (kind=work).
- Memory is a hint, not the source of truth. Reopen current data for consequential decisions. Put standing safety rules in your role.

## Preferences

## Facts

## Work
`;
}

export function buildHostSystemPrompt(bot: BotRow, agentsMd: string): string {
  return [
    buildAppendSystemPrompt(),
    "",
    agentsMd.trim(),
    "",
    `Your private home on the computer is ${hostBotDir(bot.id)}. Shared files live in /config/workspace.`,
    "You have your own screen on the shared computer; computer_screenshot and browser windows use that screen.",
    `Current working directory: ${hostBotDir(bot.id)}`,
    "If a computer tool says the computer is offline, tell the user that in visible text. You are still available to talk. Do not say you are offline.",
  ].join("\n");
}

export function registerPibotModel(runtime: ModelRuntime, config: ContainerModelConfig) {
  runtime.registerProvider("pibot", {
    name: "Pibot Relay",
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    api: config.api as "openai-completions" | "anthropic-messages" | "openai-responses",
    models: [
      {
        id: config.modelId,
        name: config.modelName,
        reasoning: config.reasoning,
        thinkingLevelMap: config.thinkingLevelMap,
        input: config.vision ? ["text", "image"] : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: config.contextWindow,
        maxTokens: config.maxTokens,
      },
    ],
  });
  const model = runtime.getModel("pibot", config.modelId);
  if (!model) throw new Error(`model not registered: pibot/${config.modelId}`);
  return model;
}

function isolatedLoader(getSystem: () => string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: getSystem,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export type HostSession = {
  session: AgentSession;
  runtime: ModelRuntime;
  setSystem: (text: string) => void;
  dispose: () => void;
};

export async function createHostSession(opts: {
  bot: BotRow;
  agentsMd: string;
  model: ContainerModelConfig;
  thinking: ThinkingLevel;
  computer: ComputerAccess;
  onEvent: (event: AgentSessionEvent) => void;
  requestApproval: (
    requestId: string,
    title: string,
    message: string,
    options: string[],
  ) => Promise<string | undefined>;
  channel?: string;
  systemExtra?: string;
  includeSendMessage?: boolean;
  runtime?: ModelRuntime;
  mcp?: HostMcpHub;
  listMcpServers?: () => ContainerMcpServer[];
  rememberMcpAllow?: (serverId: string, toolName: string) => void;
}): Promise<HostSession> {
  const paths = hostDataPaths(opts.bot.id);
  const sessionDir = hostSessionDir(opts.bot.id, opts.channel ?? "main");
  mkdirSync(paths.cwd, { recursive: true });
  mkdirSync(paths.agentDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });

  let systemText = buildHostSystemPrompt(opts.bot, opts.agentsMd);
  if (opts.systemExtra?.trim()) systemText = `${systemText}\n\n${opts.systemExtra.trim()}`;
  const runtime =
    opts.runtime ??
    (await ModelRuntime.create({
      authPath: join(paths.agentDir, "auth.json"),
      modelsPath: join(paths.agentDir, "models.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    }));
  const model = registerPibotModel(runtime, opts.model);
  const customTools = buildHostTools({
    botId: opts.bot.id,
    computer: opts.computer,
    requestApproval: opts.requestApproval,
    vision: opts.model.vision,
    visionHelper: opts.model.visionHelper,
    mcp: opts.mcp,
    listMcpServers: opts.listMcpServers,
    rememberMcpAllow: opts.rememberMcpAllow,
  });
  if (opts.includeSendMessage) customTools.push(buildSendMessageTool());
  const toolNames = opts.includeSendMessage ? [...GROUP_TOOL_NAMES] : [...HOST_TOOL_NAMES];

  const { session } = await createAgentSession({
    cwd: paths.cwd,
    agentDir: paths.agentDir,
    model,
    thinkingLevel: opts.thinking,
    modelRuntime: runtime,
    noTools: "builtin",
    tools: toolNames,
    customTools,
    resourceLoader: isolatedLoader(() => systemText),
    sessionManager: SessionManager.continueRecent(paths.cwd, sessionDir),
    settingsManager: SettingsManager.inMemory({
      retry: { enabled: true, maxRetries: 3 },
      defaultProjectTrust: "never",
      compaction: { enabled: true },
    }),
  });

  session.agent.state.systemPrompt = systemText;
  const unsubscribe = session.subscribe((event) => opts.onEvent(event));

  return {
    session,
    runtime,
    setSystem: (text) => {
      systemText = text;
      session.agent.state.systemPrompt = text;
    },
    dispose: () => {
      unsubscribe();
      session.dispose();
    },
  };
}
