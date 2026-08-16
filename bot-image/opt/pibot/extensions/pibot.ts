// Pibot 容器扩展：注册中转模型 provider + Bot 专用工具。
// 由 /config/.pi/agent/settings.json 的 extensions 字段加载。
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// 共享电脑架构：每个 Bot 一个 pi 进程，私有目录由桥接注入（HOME=/config/bots/<id>）
const BOT_DIR = process.env.PIBOT_BOT_DIR ?? process.env.HOME ?? "/config";
const MODEL_FILE = `${BOT_DIR}/pibot-model.json`;
const MCP_FILE = "/config/mcp-servers.json";
const CDP_URL = "http://127.0.0.1:9222";

interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  defaultPolicy?: "auto" | "ask" | "allow";
  toolConfig?: Record<string, { enabled: boolean }>;
  rules?: Array<{ action: "require" | "allow"; toolName: string }>;
}

function loadMcpServers(): McpServerConfig[] {
  try {
    const value = JSON.parse(readFileSync(MCP_FILE, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

// 模型配置来源：宿主下发的配置文件优先（设置页可随时切换），
// 文件不存在时回落到容器创建时注入的环境变量。
function loadModelConfig() {
  const fromEnv = {
    baseUrl: env("PIBOT_BASE_URL", "https://api.openai.com/v1"),
    apiKey: env("PIBOT_API_KEY"),
    api: env("PIBOT_API", "openai-completions"),
    modelId: env("PIBOT_MODEL_ID", "gpt-4o"),
    modelName: env("PIBOT_MODEL_NAME", env("PIBOT_MODEL_ID", "gpt-4o")),
    reasoning: env("PIBOT_REASONING", "false") === "true",
    vision: true,
    contextWindow: Number(env("PIBOT_CONTEXT_WINDOW", "200000")),
    maxTokens: Number(env("PIBOT_MAX_TOKENS", "8192")),
    visionHelper: undefined as
      | { baseUrl: string; apiKey: string; api: string; modelId: string }
      | undefined,
  };
  try {
    if (existsSync(MODEL_FILE)) {
      return { ...fromEnv, ...JSON.parse(readFileSync(MODEL_FILE, "utf8")) };
    }
  } catch {
    // 配置文件损坏时静默回退到环境变量，保证 Bot 仍能启动
  }
  return fromEnv;
}

/** 用视觉辅助模型把截图转成文字描述（主模型无视觉时的"眼睛"） */
async function describeImageWithHelper(
  helper: { baseUrl: string; apiKey: string; api: string; modelId: string },
  base64Image: string,
  mediaType = "image/png",
): Promise<string> {
  const base = helper.baseUrl.replace(/\/+$/, "");
  const instruction =
    "Describe this screenshot for a text-only agent operating the computer. Include: page/app title, visible text (verbatim where important), buttons/links/inputs with their labels, current state (errors, dialogs, focus), and layout. Be thorough but concise.";
  const timeout = AbortSignal.timeout(60000);

  if (helper.api === "anthropic-messages") {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": helper.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: helper.modelId,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
              { type: "text", text: instruction },
            ],
          },
        ],
      }),
      signal: timeout,
    });
    if (!res.ok) throw new Error(`vision helper HTTP ${res.status}`);
    const json: any = await res.json();
    return (json.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }

  if (helper.api === "openai-responses") {
    const res = await fetch(`${base}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${helper.apiKey}` },
      body: JSON.stringify({
        model: helper.modelId,
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: `data:${mediaType};base64,${base64Image}` },
              { type: "input_text", text: instruction },
            ],
          },
        ],
      }),
      signal: timeout,
    });
    if (!res.ok) throw new Error(`vision helper HTTP ${res.status}`);
    const json: any = await res.json();
    if (typeof json.output_text === "string") return json.output_text;
    return (json.output ?? [])
      .flatMap((o: any) => o.content ?? [])
      .filter((c: any) => c.type === "output_text")
      .map((c: any) => c.text)
      .join("");
  }

  // openai-completions（默认）
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${helper.apiKey}` },
    body: JSON.stringify({
      model: helper.modelId,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64Image}` } },
            { type: "text", text: instruction },
          ],
        },
      ],
    }),
    signal: timeout,
  });
  if (!res.ok) throw new Error(`vision helper HTTP ${res.status}`);
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function imageBlock(base64: string, mediaType = "image/png") {
  return {
    type: "image" as const,
    data: base64,
    mimeType: mediaType,
  };
}

export default function (pi: ExtensionAPI) {
  // ---------- 中转模型 provider ----------
  const mc = loadModelConfig();

  const hasVision = mc.vision !== false;

  pi.registerProvider("pibot", {
    name: "Pibot Relay",
    baseUrl: mc.baseUrl,
    apiKey: mc.apiKey,
    api: mc.api as any,
    models: [
      {
        id: mc.modelId,
        name: mc.modelName,
        reasoning: mc.reasoning,
        // 无视觉模型只声明 text，pi 不会往请求里塞 image block
        input: hasVision ? ["text", "image"] : ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: mc.contextWindow,
        maxTokens: mc.maxTokens,
      },
    ],
  });

  // ---------- MCP client（账户级 server，所有 Bot 共享配置） ----------
  let mcpConfigs = loadMcpServers();
  const mcpClients = new Map<string, { fingerprint: string; client: Promise<Client> }>();

  function refreshMcpServers() {
    mcpConfigs = loadMcpServers();
    return mcpConfigs;
  }

  function findMcpServer(value: string): McpServerConfig | undefined {
    refreshMcpServers();
    const key = value.trim().toLowerCase();
    return mcpConfigs.find((s) => s.id === value || s.name.toLowerCase() === key);
  }

  async function connectMcp(server: McpServerConfig): Promise<Client> {
    const fingerprint = JSON.stringify({
      transport: server.transport,
      command: server.command,
      args: server.args,
      env: server.env,
      url: server.url,
      headers: server.headers,
    });
    const existing = mcpClients.get(server.id);
    if (existing?.fingerprint === fingerprint) return existing.client;
    if (existing) {
      mcpClients.delete(server.id);
      void existing.client.then((client) => client.close()).catch(() => undefined);
    }

    const connecting = (async () => {
      if (server.transport === "stdio") {
        const inherited = Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => {
            return typeof entry[1] === "string";
          }),
        );
        const client = new Client({ name: "pibot", version: "0.1.0" });
        const transport = new StdioClientTransport({
          command: server.command!,
          args: server.args ?? [],
          env: { ...inherited, ...(server.env ?? {}) },
          cwd: env("PIBOT_WORKSPACE", "/config/workspace"),
          stderr: "pipe",
        });
        await client.connect(transport);
        return client;
      }

      const url = new URL(server.url!);
      const requestInit = { headers: server.headers ?? {} };
      const fetchWithHeaders = (input: any, init: any = {}) => {
        const headers = new Headers(init.headers);
        for (const [name, value] of Object.entries(server.headers ?? {})) {
          headers.set(name, value);
        }
        return fetch(input, { ...init, headers });
      };
      const first = new Client({ name: "pibot", version: "0.1.0" });
      try {
        await first.connect(new StreamableHTTPClientTransport(url, { requestInit }));
        return first;
      } catch {
        await first.close().catch(() => undefined);
        // 兼容仍使用旧 HTTP+SSE transport 的 MCP server。
        const fallback = new Client({ name: "pibot", version: "0.1.0" });
        await fallback.connect(
          new SSEClientTransport(url, {
            requestInit,
            eventSourceInit: { fetch: fetchWithHeaders as any },
          }),
        );
        return fallback;
      }
    })();

    mcpClients.set(server.id, { fingerprint, client: connecting });
    connecting.catch(() => mcpClients.delete(server.id));
    return connecting;
  }

  function toolIsEnabled(server: McpServerConfig, toolName: string) {
    return server.toolConfig?.[toolName]?.enabled !== false;
  }

  function ruleFor(server: McpServerConfig, toolName: string): "require" | "allow" | undefined {
    const matching = (server.rules ?? []).filter(
      (rule) => rule.toolName === "*" || rule.toolName === toolName,
    );
    if (matching.some((rule) => rule.action === "require")) return "require";
    if (matching.some((rule) => rule.action === "allow")) return "allow";
    return undefined;
  }

  function looksReadOnly(toolName: string, annotations?: any) {
    if (annotations?.readOnlyHint === true) return true;
    if (annotations?.destructiveHint === true) return false;
    return /^(get|list|read|search|fetch|find|view|describe|inspect|query|lookup|status|health|screenshot|echo)(_|$)/i.test(
      toolName,
    );
  }

  async function shouldApprove(
    server: McpServerConfig,
    toolName: string,
    client: Client,
  ): Promise<{ required: boolean; forced: boolean }> {
    const rule = ruleFor(server, toolName);
    if (rule === "require") return { required: true, forced: true };
    if (rule === "allow") return { required: false, forced: false };
    if (server.defaultPolicy === "allow") return { required: false, forced: false };
    if (server.defaultPolicy === "ask") return { required: true, forced: false };
    try {
      const tools = await client.listTools(undefined, { timeout: 15000 });
      const tool = tools.tools.find((item) => item.name === toolName);
      return { required: !looksReadOnly(toolName, tool?.annotations), forced: false };
    } catch {
      return { required: !looksReadOnly(toolName), forced: false };
    }
  }

  pi.registerTool({
    name: "mcp_list_tools",
    label: "List MCP Tools",
    description:
      "List tools exposed by configured MCP servers. Call this before mcp_call when you need an external MCP capability.",
    promptSnippet: "Discover tools from configured MCP servers",
    parameters: Type.Object({
      server: Type.Optional(
        Type.String({ description: "Optional MCP server name or id; omit to list every server" }),
      ),
    }),
    async execute(_id: string, params: any) {
      const selected = params.server
        ? [findMcpServer(params.server)].filter(Boolean)
        : refreshMcpServers();
      if (selected.length === 0) {
        return {
          content: [textBlock("No matching enabled MCP server is configured.")],
          details: {},
          isError: true,
        };
      }

      const output: string[] = [];
      let errors = 0;
      for (const server of selected as McpServerConfig[]) {
        try {
          const client = await connectMcp(server);
          const result = await client.listTools(undefined, { timeout: 30000 });
          const visibleTools = result.tools.filter((tool) => toolIsEnabled(server, tool.name));
          output.push(
            `## ${server.name} (${server.id}) · policy=${server.defaultPolicy ?? "auto"}\n${visibleTools
              .map(
                (tool) =>
                  `- ${tool.name}: ${tool.description ?? "No description"}\n  inputSchema: ${JSON.stringify(tool.inputSchema)}`,
              )
              .join("\n")}`,
          );
        } catch (err) {
          errors++;
          output.push(`## ${server.name}\nConnection failed: ${(err as Error).message}`);
        }
      }
      return {
        content: [textBlock(output.join("\n\n"))],
        details: {},
        isError: errors === selected.length,
      };
    },
  });

  pi.registerTool({
    name: "mcp_call",
    label: "Call MCP Tool",
    description:
      "Call a tool on a configured MCP server. Use mcp_list_tools first to get the exact tool name and input schema. Image results are passed through directly for visual models, or described by the configured vision helper for text-only models.",
    promptSnippet: "Call an external tool through MCP",
    parameters: Type.Object({
      server: Type.String({ description: "MCP server name or id" }),
      tool: Type.String({ description: "Exact MCP tool name" }),
      argumentsJson: Type.Optional(
        Type.String({ description: "Tool arguments as a JSON object string; defaults to {}" }),
      ),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const server = findMcpServer(params.server);
      if (!server) {
        return {
          content: [textBlock(`No enabled MCP server named "${params.server}" is configured.`)],
          details: { server: params.server, tool: params.tool },
          isError: true,
        };
      }
      if (!toolIsEnabled(server, params.tool)) {
        return {
          content: [textBlock(`MCP tool "${params.tool}" is disabled in Settings.`)],
          details: { server: server.name, tool: params.tool },
          isError: true,
        };
      }

      let args: Record<string, unknown> = {};
      try {
        args = params.argumentsJson ? JSON.parse(params.argumentsJson) : {};
      } catch {
        return {
          content: [textBlock("argumentsJson must be a valid JSON object string.")],
          details: { server: server.name, tool: params.tool },
          isError: true,
        };
      }

      try {
        const client = await connectMcp(server);
        const approval = await shouldApprove(server, params.tool, client);
        if (approval.required) {
          if (!ctx?.ui?.select) {
            return {
              content: [textBlock("This MCP call requires approval, but no approval UI is available.")],
              details: { server: server.name, tool: params.tool },
              isError: true,
            };
          }
          const summary = JSON.stringify(args);
          const title =
            `[PIBOT_MCP_APPROVAL:${server.id}:${encodeURIComponent(params.tool)}] ` +
            `${server.name} / ${params.tool} — ${summary.length > 500 ? `${summary.slice(0, 500)}…` : summary}`;
          const options = approval.forced
            ? ["Allow once", "Deny"]
            : ["Allow once", "Always allow", "Deny"];
          const choice = await ctx.ui.select(title, options);
          if (choice !== "Allow once" && choice !== "Always allow") {
            return {
              content: [textBlock("MCP call denied by the user.")],
              details: { server: server.name, tool: params.tool },
              isError: true,
            };
          }
        }
        const result: any = await client.callTool(
          { name: params.tool, arguments: args },
          undefined,
          { timeout: 120000 },
        );
        const content: any[] = [];

        for (const block of result.content ?? []) {
          if (block.type === "text") {
            content.push(textBlock(block.text));
          } else if (block.type === "image" && block.data) {
            const mediaType = block.mimeType ?? "image/png";
            if (hasVision) {
              content.push(imageBlock(block.data, mediaType));
            } else if (mc.visionHelper) {
              try {
                const description = await describeImageWithHelper(
                  mc.visionHelper,
                  block.data,
                  mediaType,
                );
                content.push(textBlock(`[MCP image described by vision helper]\n${description}`));
              } catch (err) {
                content.push(
                  textBlock(
                    `[MCP returned an image, but the vision helper failed: ${(err as Error).message}]`,
                  ),
                );
              }
            } else {
              content.push(
                textBlock("[MCP returned an image, but this model has no vision helper configured.]"),
              );
            }
          } else if (block.type === "resource") {
            const resource = block.resource ?? {};
            if (typeof resource.text === "string") {
              content.push(textBlock(resource.text));
            } else if (resource.blob && String(resource.mimeType ?? "").startsWith("image/")) {
              if (hasVision) {
                content.push(imageBlock(resource.blob, resource.mimeType));
              } else if (mc.visionHelper) {
                const description = await describeImageWithHelper(
                  mc.visionHelper,
                  resource.blob,
                  resource.mimeType,
                );
                content.push(textBlock(`[MCP resource image described by vision helper]\n${description}`));
              }
            } else {
              content.push(textBlock(JSON.stringify(resource)));
            }
          } else {
            content.push(textBlock(JSON.stringify(block)));
          }
        }

        if (content.length === 0 && result.structuredContent !== undefined) {
          content.push(textBlock(JSON.stringify(result.structuredContent, null, 2)));
        }
        if (content.length === 0) content.push(textBlock("MCP tool completed with no content."));
        return { content, details: { server: server.name, tool: params.tool }, isError: !!result.isError };
      } catch (err) {
        mcpClients.delete(server.id);
        return {
          content: [textBlock(`MCP call failed: ${(err as Error).message}`)],
          details: { server: server.name, tool: params.tool },
          isError: true,
        };
      }
    },
  });

  // ---------- 浏览器工具（CDP 连接共享 Chromium，操作对用户可见） ----------
  // 所有 Bot 共用一个 Chromium（默认 context → cookie/登录态共享，与官方一致），
  // 但每个 Bot 进程持有自己的标签页，避免并行时互相抢页面。
  let browserCtx: any = null;
  let myPage: any = null;

  async function connectCdp(timeout: number) {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(CDP_URL, { timeout });
    browserCtx = browser.contexts()[0] ?? (await browser.newContext());
    browser.on("disconnected", () => {
      browserCtx = null;
      myPage = null;
    });
  }

  async function getPage(): Promise<any> {
    if (!browserCtx) {
      try {
        await connectCdp(5000);
      } catch {
        // Chromium 未运行：在共享桌面上拉起可见实例后重试
        const child = execFile(
          "chromium",
          [
            "--remote-debugging-port=9222",
            "--no-first-run",
            "--disable-dev-shm-usage",
            "--disable-session-crashed-bubble",
            "--start-maximized",
          ],
          { env: { ...process.env, DISPLAY: ":1", HOME: "/config" } },
        );
        child.unref();
        await new Promise((r) => setTimeout(r, 5000));
        await connectCdp(15000);
      }
    }
    if (myPage && !myPage.isClosed()) return myPage;
    const pages = browserCtx.pages();
    // 优先接管一个空白页（桌面刚启动的初始标签），否则新开自己的标签
    const blank = pages.find((p: any) => p.url() === "about:blank" || p.url() === "chrome://new-tab-page/");
    myPage = blank ?? (await browserCtx.newPage());
    myPage.on("close", () => {
      myPage = null;
    });
    return myPage;
  }

  // 页面文本快照：无视觉模型的"眼睛"基础版（标题/URL/正文/可点元素）
  async function textSnapshot(page: any): Promise<string> {
    const data = await page.evaluate(() => {
      const clickables = Array.from(
        document.querySelectorAll<HTMLElement>(
          "a, button, [role=button], input, select, textarea",
        ),
      )
        .filter((el) => el.offsetParent !== null)
        .slice(0, 60)
        .map((el, i) => {
          const label = (
            el.innerText ||
            (el as HTMLInputElement).value ||
            (el as HTMLInputElement).placeholder ||
            el.getAttribute("aria-label") ||
            ""
          )
            .trim()
            .slice(0, 60);
          return `[${i}] <${el.tagName.toLowerCase()}> ${label}`;
        });
      return { text: (document.body?.innerText ?? "").slice(0, 3500), clickables };
    });
    return `Title: ${await page.title()}\nURL: ${page.url()}\n\n--- Visible text ---\n${data.text}\n\n--- Interactive elements ---\n${data.clickables.join("\n")}`;
  }

  /**
   * 工具动作后的"页面状态"块：
   * 有视觉 → 截图；无视觉 → 文本快照（模型照样能操作浏览器）。
   */
  async function pageState(page: any): Promise<any[]> {
    if (hasVision) {
      const buf = await page.screenshot({ type: "png" });
      return [imageBlock(buf.toString("base64"))];
    }
    return [textBlock(await textSnapshot(page))];
  }

  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description:
      "Open a URL in the bot's visible Chromium browser. Returns page title, URL and a screenshot.",
    promptSnippet: "Open a URL in the visible browser",
    parameters: Type.Object({
      url: Type.String({ description: "Absolute URL to open" }),
    }),
    async execute(_id: string, params: any) {
      const page = await getPage();
      await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(800);
      return {
        content: [
          textBlock(`Opened: ${await page.title()} — ${page.url()}`),
          ...(await pageState(page)),
        ],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "browser_read",
    label: "Browser Read",
    description:
      "Read the current browser page: returns title, URL, visible text (truncated to ~6000 chars) and list of clickable links/buttons.",
    promptSnippet: "Read text and links from the current page",
    parameters: Type.Object({}),
    async execute() {
      const page = await getPage();
      const data = await page.evaluate(() => {
        const clickables = Array.from(
          document.querySelectorAll<HTMLElement>("a, button, [role=button], input[type=submit]"),
        )
          .filter((el) => el.offsetParent !== null)
          .slice(0, 80)
          .map((el, i) => `[${i}] <${el.tagName.toLowerCase()}> ${(el.innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim().slice(0, 80)}`);
        return {
          text: (document.body?.innerText ?? "").slice(0, 6000),
          clickables,
        };
      });
      return {
        content: [
          textBlock(
            `Title: ${await page.title()}\nURL: ${page.url()}\n\n--- Page text ---\n${data.text}\n\n--- Clickables ---\n${data.clickables.join("\n")}`,
          ),
        ],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description:
      "Click an element in the browser by CSS selector or by exact visible text. Returns a screenshot after the click.",
    promptSnippet: "Click an element on the current page",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS selector" })),
      text: Type.Optional(Type.String({ description: "Exact visible text of the element" })),
    }),
    async execute(_id: string, params: any) {
      const page = await getPage();
      if (params.selector) {
        await page.click(params.selector, { timeout: 10000 });
      } else if (params.text) {
        await page.getByText(params.text, { exact: false }).first().click({ timeout: 10000 });
      } else {
        return { content: [textBlock("Provide selector or text.")], details: {}, isError: true };
      }
      await page.waitForTimeout(1000);
      return {
        content: [textBlock(`Clicked. Now at: ${page.url()}`), ...(await pageState(page))],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "browser_type",
    label: "Browser Type",
    description:
      "Type text into an input in the browser (by CSS selector or placeholder/label text). Optionally press Enter after typing.",
    promptSnippet: "Type into an input on the current page",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "CSS selector of the input" })),
      label: Type.Optional(Type.String({ description: "Placeholder or label text of the input" })),
      value: Type.String({ description: "Text to type" }),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing" })),
    }),
    async execute(_id: string, params: any) {
      const page = await getPage();
      let locator: any;
      if (params.selector) locator = page.locator(params.selector).first();
      else if (params.label) locator = page.getByPlaceholder(params.label).or(page.getByLabel(params.label)).first();
      else return { content: [textBlock("Provide selector or label.")], details: {}, isError: true };
      await locator.fill(params.value, { timeout: 10000 });
      if (params.submit) await locator.press("Enter");
      await page.waitForTimeout(800);
      return {
        content: [textBlock(`Typed into input. URL: ${page.url()}`), ...(await pageState(page))],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description: hasVision
      ? "Take a screenshot of the current browser page."
      : "Get a visual description of the current browser page (a vision model describes the screenshot for you).",
    parameters: Type.Object({}),
    async execute() {
      const page = await getPage();
      if (hasVision) {
        const buf = await page.screenshot({ type: "png" });
        return {
          content: [textBlock(`URL: ${page.url()}`), imageBlock(buf.toString("base64"))],
          details: {},
        };
      }
      // 无视觉：优先视觉辅助模型转述，失败/未配置则退回文本快照
      if (mc.visionHelper) {
        try {
          const buf = await page.screenshot({ type: "png" });
          const desc = await describeImageWithHelper(mc.visionHelper, buf.toString("base64"));
          return {
            content: [textBlock(`URL: ${page.url()}\n\n[Visual description by helper model]\n${desc}`)],
            details: {},
          };
        } catch (err) {
          // helper 不可用，继续走文本快照
        }
      }
      return {
        content: [textBlock(await textSnapshot(page))],
        details: {},
      };
    },
  });

  // ---------- 桌面截图（视觉核对整个共享屏幕） ----------
  pi.registerTool({
    name: "computer_screenshot",
    label: "Computer Screenshot",
    description: hasVision
      ? "Take a screenshot of the shared desktop screen (not just the browser)."
      : "Get a visual description of the shared desktop screen (a vision model describes the screenshot for you). Prefer browser_read for web pages.",
    parameters: Type.Object({}),
    async execute() {
      const file = `/tmp/pibot-screen-${Date.now()}.png`;
      await new Promise<void>((resolve, reject) => {
        execFile(
          "scrot",
          ["-o", file],
          { env: { ...process.env, DISPLAY: ":1" } },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      const data = readFileSync(file).toString("base64");
      if (hasVision) {
        return { content: [textBlock("Desktop screenshot:"), imageBlock(data)], details: {} };
      }
      if (mc.visionHelper) {
        try {
          const desc = await describeImageWithHelper(mc.visionHelper, data);
          return {
            content: [textBlock(`[Desktop described by helper model]\n${desc}`)],
            details: {},
          };
        } catch (err) {
          return {
            content: [
              textBlock(
                `Vision helper failed (${(err as Error).message}). Your model cannot view images; use browser_read / browser tools for web pages, or bash tools for files.`,
              ),
            ],
            details: {},
            isError: true,
          };
        }
      }
      return {
        content: [
          textBlock(
            "Your model cannot view images and no vision-capable helper model is configured. Use browser_read for web pages, or ask the user to add a vision-capable model profile in Settings.",
          ),
        ],
        details: {},
        isError: true,
      };
    },
  });

  // ---------- 记忆 ----------
  pi.registerTool({
    name: "update_memory",
    label: "Update Memory",
    description:
      "Persist a lasting note. Use kind=preference for how the user likes work done, kind=fact for stable facts, kind=work for a one-line outcome of finished work. Notes apply across this Bot's private and group sessions. Do not store changing source data; reopen the current system for consequential decisions.",
    promptSnippet: "Remember a lasting preference, fact, or work outcome",
    promptGuidelines: [
      "Use update_memory for durable preferences, facts, or a finished-work one-liner — not transient task state.",
      "Put standing safety rules in your role description, not in memory.",
    ],
    parameters: Type.Object({
      kind: Type.Optional(Type.Union([Type.Literal("preference"), Type.Literal("fact"), Type.Literal("work")])),
      note: Type.String({ description: "One concise sentence to remember" }),
    }),
    async execute(_id: string, _params: any) {
      // 宿主拦截 tool_execution_start 后写入 AGENTS.md 的 Preferences / Facts / Work
      return { content: [textBlock("Remembered.")], details: {} };
    },
  });

  // ---------- 团队协作（真实动作由宿主服务端拦截 tool_execution 事件完成） ----------
  pi.registerTool({
    name: "send_message",
    label: "Send Message",
    description:
      "Post to the current group thread. Raw assistant text is a private draft and is not shown unless you never call any tool. Keep it short. Write @Name in the text to pull that teammate in — same as next. Set next to the teammate name(s) who should take over. Set ask_user=true only for a consequential/undo-hard action, true ambiguity you cannot look up, or something only the user knows — the room then waits. Set done=true when nothing useful remains for anyone. Set pass=true when you have nothing to say this turn — text is then ignored and never shown.",
    promptSnippet: "Speak in the group, hand off, ask the user, mark done, or pass",
    promptGuidelines: [
      "In a group, if there is work, do it first, then report with send_message.",
      "If you were asked to speak and have something to say — even a short reply — send that text.",
      "Keep each message short and conversational — usually one to three sentences. React to what was just said. Do not monologue, recap the thread, or restate other people.",
      "Write @Name in the post to pull that teammate in, or @everyone for the whole room. next is optional.",
      "Reply in the same language the user is using.",
      "Set pass=true only when you truly have nothing to add. Staying quiet is good. Do not write that you are staying silent.",
      "Default is to act, not to ask. For naming, defaults, or equivalent approaches: pick one, do it, and mention the assumption.",
      "ask_user=true is earned by only three things: a consequential or hard-to-undo action; true ambiguity you cannot look up; or something only the user knows. A low-stakes question is worse than a reasonable assumption. Before asking, try the obvious thing or a quick lookup. A brief \"want me to also…?\" offer is not ask_user.",
      "Do not set next so a teammate decides one of those three cases in the user's place.",
      "Set done=true only when nothing useful remains for anyone.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "What to post in the room. Ignored when pass=true." }),
      next: Type.Optional(
        Type.Array(Type.String(), {
          description: "Exact teammate name(s) who should act next",
        }),
      ),
      ask_user: Type.Optional(
        Type.Boolean({
          description:
            "True only for a consequential/undo-hard action, true ambiguity you cannot look up, or something only the user knows. text is the question shown in the room; the room then waits.",
        }),
      ),
      done: Type.Optional(
        Type.Boolean({ description: "True if nothing useful remains for anyone" }),
      ),
      pass: Type.Optional(
        Type.Boolean({
          description: "True if you have nothing to say this turn. text is ignored and not shown in the room.",
        }),
      ),
    }),
    async execute(_id: string, params: any) {
      if (params.pass === true) {
        return { content: [textBlock("Passed.")], details: {} };
      }
      const text = String(params.text ?? "").trim();
      if (!text || /^\(?pass\.?\)?$/i.test(text)) {
        return { content: [textBlock("Passed.")], details: {} };
      }
      return { content: [textBlock("Posted to the group.")], details: {} };
    },
  });

  pi.registerTool({
    name: "message_teammate",
    label: "Message Teammate",
    description:
      "Send a message to another Bot on your team by name. If you share a group (or you are already in one), this posts a visible handoff in that group. During an active group turn the orchestrator decides who speaks next — prefer @Name in send_message. Use a private ping only when you do not share a group.",
    promptSnippet: "Send a message to a teammate Bot",
    promptGuidelines: [
      "Use message_teammate to hand work to another Bot instead of asking the user to relay information.",
      "In a group, this stays in the group. Do not ask the teammate to reply in private chat.",
      "During a group turn, @Name in send_message is enough; message_teammate is only a visible handoff line.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Exact name of the teammate Bot" }),
      message: Type.String({ description: "The message or task for the teammate" }),
    }),
    async execute(_id: string, params: any) {
      return {
        content: [textBlock(`Message sent to ${params.name}. They will handle it and can reply to you the same way.`)],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "save_skill",
    label: "Save Skill",
    description:
      "Save a reusable skill: a named method for doing a task (steps, decision rules, output format, approval boundaries). Skills are shared with every Bot on the team and can be invoked by the user with /slug. Use save_skill after completing a task the user may want repeated.",
    promptSnippet: "Save a reusable method as a team skill",
    parameters: Type.Object({
      name: Type.String({ description: "Short skill name, e.g. 'Weekly account health'" }),
      description: Type.Optional(Type.String({ description: "One-line summary of when to use it" })),
      content: Type.String({
        description:
          "The full method in markdown: when to use, required inputs, step sequence, validation, what to return, what needs approval",
      }),
    }),
    async execute(_id: string, params: any) {
      return {
        content: [textBlock(`Skill "${params.name}" saved and shared with the team.`)],
        details: {},
      };
    },
  });

  // ---------- 审批 ----------
  pi.registerTool({
    name: "request_approval",
    label: "Request Approval",
    description:
      "Ask the user for approval before doing something consequential (sending messages on their behalf, purchases, deletions, logging into services). Blocks until the user responds. Use request_approval before any irreversible or externally visible action.",
    promptSnippet: "Ask the user to approve a consequential action",
    promptGuidelines: [
      "Use request_approval before irreversible or externally visible actions (sending emails, posting, purchasing, deleting).",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short title of what needs approval" }),
      message: Type.String({ description: "Details of the action awaiting approval" }),
      options: Type.Optional(
        Type.Array(Type.String(), { description: "Custom choices; defaults to Approve/Reject" }),
      ),
    }),
    async execute(_id: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const options: string[] =
        params.options && params.options.length > 0 ? params.options : ["Approve", "Reject"];
      const choice = await ctx.ui.select(`${params.title}\n${params.message}`, options);
      if (choice === undefined) {
        return { content: [textBlock("User dismissed the request (no decision).")], details: {} };
      }
      return { content: [textBlock(`User chose: ${choice}`)], details: { choice } };
    },
  });
}
