import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  type BashOperations,
  type EditOperations,
  type ReadOperations,
  type ToolDefinition,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ComputerAccess, ComputerOfflineError, type ComputerServiceResult } from "./computer-access.js";
import type { HostMcpHub } from "./host-mcp.js";
import type { ContainerMcpServer } from "./mcp-servers.js";
import type { VisionHelperConfig } from "./model-profiles.js";
import { describeImageWithHelper } from "./vision-helper.js";

export function toContainerPath(hostResolved: string): string {
  const posix = hostResolved.replace(/\\/g, "/");
  const idx = posix.indexOf("/config/");
  if (idx >= 0) return posix.slice(idx);
  if (posix === "/config") return posix;
  throw new Error(`refusing path outside /config: ${hostResolved}`);
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], details: {}, isError };
}

type ToolContent = Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;

async function fromComputer(
  access: ComputerAccess,
  path: string,
  body: unknown,
  timeoutSec: number,
  opts: { vision?: boolean; visionHelper?: VisionHelperConfig },
) {
  try {
    const result: ComputerServiceResult = await access.service(path, body, timeoutSec);
    const content: ToolContent = [];
    if (result.text) content.push({ type: "text", text: String(result.text) });
    if (result.image?.data) {
      if (opts.vision) {
        content.push({
          type: "image",
          data: result.image.data,
          mimeType: result.image.mimeType ?? "image/png",
        });
      } else if (opts.visionHelper) {
        try {
          const description = await describeImageWithHelper(
            opts.visionHelper,
            result.image.data,
            result.image.mimeType ?? "image/png",
          );
          content.push({ type: "text", text: `[Visual description by helper model]\n${description}` });
        } catch (err) {
          if (result.snapshot) content.push({ type: "text", text: result.snapshot });
          else {
            content.push({
              type: "text",
              text: `Vision helper failed (${(err as Error).message}). Use browser_read for web pages.`,
            });
          }
        }
      } else if (result.snapshot) {
        content.push({ type: "text", text: result.snapshot });
      } else {
        content.push({
          type: "text",
          text: "Your model cannot view images and no vision helper is configured. Use browser_read for web pages, or ask the user to add a vision-capable model profile in Settings.",
        });
      }
    }
    if (content.length === 0) content.push({ type: "text", text: result.error ?? "Done." });
    return { content, details: {}, isError: !!result.isError || result.ok === false };
  } catch (err) {
    if (err instanceof ComputerOfflineError) return textResult(err.message, true);
    return textResult((err as Error).message, true);
  }
}

function looksReadOnly(toolName: string, readOnlyHint?: boolean) {
  if (readOnlyHint === true) return true;
  return /^(get|list|read|search|fetch|find|view|describe|inspect|query|lookup|status|health|screenshot|echo)(_|$)/i.test(
    toolName,
  );
}

function shouldApproveMcp(
  server: ContainerMcpServer,
  toolName: string,
  readOnlyHint?: boolean,
): { required: boolean; forced: boolean } {
  const matching = (server.rules ?? []).filter(
    (rule) => rule.toolName === "*" || rule.toolName === toolName,
  );
  if (matching.some((rule) => rule.action === "require")) return { required: true, forced: true };
  if (matching.some((rule) => rule.action === "allow")) return { required: false, forced: false };
  if (server.defaultPolicy === "allow") return { required: false, forced: false };
  if (server.defaultPolicy === "ask") return { required: true, forced: false };
  return { required: !looksReadOnly(toolName, readOnlyHint), forced: false };
}

function computerOps(access: ComputerAccess): {
  bash: BashOperations;
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
} {
  const readFile = async (absolutePath: string) => {
    const path = toContainerPath(absolutePath);
    const buf = await access.readFile(path);
    if (!buf) throw new Error(`File not found: ${path}`);
    return buf;
  };
  const writeFile = async (absolutePath: string, content: string) => {
    const path = toContainerPath(absolutePath);
    await access.writeFile(path, Buffer.from(content, "utf8"));
  };
  return {
    bash: {
      exec: async (command, cwd, options) => {
        const dir = toContainerPath(cwd);
        await access.mkdir(dir);
        const result = await access.exec(["bash", "-lc", command], { cwd: dir });
        if (result.stdout.length) options.onData(result.stdout);
        if (result.stderr) options.onData(Buffer.from(result.stderr));
        return { exitCode: result.exitCode };
      },
    },
    read: {
      readFile,
      access: async (absolutePath) => {
        const path = toContainerPath(absolutePath);
        const buf = await access.readFile(path);
        if (!buf) throw new Error(`File not found: ${path}`);
      },
    },
    write: {
      writeFile,
      mkdir: async (dir) => {
        await access.mkdir(toContainerPath(dir));
      },
    },
    edit: {
      readFile,
      writeFile,
      access: async (absolutePath) => {
        const path = toContainerPath(absolutePath);
        const buf = await access.readFile(path);
        if (!buf) throw new Error(`File not found: ${path}`);
      },
    },
  };
}

export function buildHostTools(opts: {
  botId: string;
  computer: ComputerAccess;
  requestApproval: (
    requestId: string,
    title: string,
    message: string,
    options: string[],
  ) => Promise<string | undefined>;
  vision?: boolean;
  visionHelper?: VisionHelperConfig;
  mcp?: HostMcpHub;
  listMcpServers?: () => ContainerMcpServer[];
  rememberMcpAllow?: (serverId: string, toolName: string) => void;
}): ToolDefinition[] {
  const cwd = `/config/bots/${opts.botId}`;
  const ops = computerOps(opts.computer);
  const coding = [
    createReadToolDefinition(cwd, { operations: ops.read }),
    createBashToolDefinition(cwd, { operations: ops.bash, exposeSessionEnvironment: false }),
    createWriteToolDefinition(cwd, { operations: ops.write }),
    createEditToolDefinition(cwd, { operations: ops.edit }),
  ];

  const social: ToolDefinition[] = [
    defineTool({
      name: "update_memory",
      label: "Update Memory",
      description:
        "Persist a lasting note. Use kind=preference for how the user likes work done, kind=fact for stable facts, kind=work for a one-line outcome of finished work. Notes apply across this Bot's private and group sessions. Do not store changing source data; reopen the current system for consequential decisions.",
      promptSnippet: "Remember a lasting preference, fact, or work outcome",
      promptGuidelines: [
        "Use update_memory for durable preferences, facts, or a finished-work one-liner — not transient task state.",
      ],
      parameters: Type.Object({
        kind: Type.Optional(Type.Union([Type.Literal("preference"), Type.Literal("fact"), Type.Literal("work")])),
        note: Type.String({ description: "One concise sentence to remember" }),
      }),
      execute: async () => textResult("Remembered."),
    }),
    defineTool({
      name: "message_teammate",
      label: "Message Teammate",
      description:
        "Send a message to another Bot on your team by name. If you share a group, this posts a visible handoff in that group. Use a private ping only when you do not share a group.",
      promptSnippet: "Send a message to a teammate Bot",
      parameters: Type.Object({
        name: Type.String({ description: "Exact name of the teammate Bot" }),
        message: Type.String({ description: "The message or task for the teammate" }),
      }),
      execute: async (_id, params) =>
        textResult(`Message sent to ${params.name}. They will handle it and can reply to you the same way.`),
    }),
    defineTool({
      name: "save_skill",
      label: "Save Skill",
      description:
        "Save a reusable skill: a named method for doing a task. Skills are shared with every Bot and can be invoked with /slug.",
      promptSnippet: "Save a reusable method as a team skill",
      parameters: Type.Object({
        name: Type.String({ description: "Short skill name" }),
        description: Type.Optional(Type.String({ description: "One-line summary" })),
        content: Type.String({ description: "The full method in markdown" }),
      }),
      execute: async (_id, params) => textResult(`Skill "${params.name}" saved and shared with the team.`),
    }),
    defineTool({
      name: "request_approval",
      label: "Request Approval",
      description:
        "Ask the user for approval before doing something consequential. Blocks until the user responds.",
      promptSnippet: "Ask the user to approve a consequential action",
      parameters: Type.Object({
        title: Type.String({ description: "Short title of what needs approval" }),
        message: Type.String({ description: "Details of the action awaiting approval" }),
        options: Type.Optional(Type.Array(Type.String(), { description: "Custom choices; defaults to Approve/Reject" })),
      }),
      execute: async (toolCallId, params) => {
        const options =
          params.options && params.options.length > 0 ? params.options : ["Approve", "Reject"];
        const choice = await opts.requestApproval(toolCallId, params.title, params.message, options);
        if (choice === undefined) return textResult("User dismissed the request (no decision).");
        return textResult(`User chose: ${choice}`);
      },
    }),
  ];

  const wantShot = !!(opts.vision || opts.visionHelper);
  const browser: ToolDefinition[] = [
    defineTool({
      name: "browser_navigate",
      label: "Browser Navigate",
      description:
        "Open a URL in the shared visible Chromium browser. The computer must be online. Returns page title, URL and a screenshot or text snapshot.",
      promptSnippet: "Open a URL in the visible browser",
      parameters: Type.Object({
        url: Type.String({ description: "Absolute URL to open" }),
      }),
      execute: async (_id, params) =>
        fromComputer(
          opts.computer,
          "/browser/navigate",
          { botId: opts.botId, url: params.url, screenshot: wantShot },
          60,
          opts,
        ),
    }),
    defineTool({
      name: "browser_read",
      label: "Browser Read",
      description:
        "Read the current browser page: title, URL, visible text and clickable links/buttons. The computer must be online.",
      promptSnippet: "Read text and links from the current page",
      parameters: Type.Object({}),
      execute: async () => fromComputer(opts.computer, "/browser/read", { botId: opts.botId }, 30, opts),
    }),
    defineTool({
      name: "browser_click",
      label: "Browser Click",
      description:
        "Click an element in the browser by CSS selector or by visible text. The computer must be online.",
      promptSnippet: "Click an element on the current page",
      parameters: Type.Object({
        selector: Type.Optional(Type.String({ description: "CSS selector" })),
        text: Type.Optional(Type.String({ description: "Visible text of the element" })),
      }),
      execute: async (_id, params) =>
        fromComputer(
          opts.computer,
          "/browser/click",
          { botId: opts.botId, selector: params.selector, text: params.text, screenshot: wantShot },
          30,
          opts,
        ),
    }),
    defineTool({
      name: "browser_type",
      label: "Browser Type",
      description:
        "Type text into an input in the browser (by CSS selector or placeholder/label). Optionally press Enter. The computer must be online.",
      promptSnippet: "Type into an input on the current page",
      parameters: Type.Object({
        selector: Type.Optional(Type.String({ description: "CSS selector of the input" })),
        label: Type.Optional(Type.String({ description: "Placeholder or label text of the input" })),
        value: Type.String({ description: "Text to type" }),
        submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing" })),
      }),
      execute: async (_id, params) =>
        fromComputer(
          opts.computer,
          "/browser/type",
          {
            botId: opts.botId,
            selector: params.selector,
            label: params.label,
            value: params.value,
            submit: params.submit,
            screenshot: wantShot,
          },
          30,
          opts,
        ),
    }),
    defineTool({
      name: "browser_screenshot",
      label: "Browser Screenshot",
      description: opts.vision
        ? "Take a screenshot of the current browser page. The computer must be online."
        : "Get a visual description of the current browser page. The computer must be online.",
      promptSnippet: "Capture the current browser page",
      parameters: Type.Object({}),
      execute: async () =>
        fromComputer(opts.computer, "/browser/screenshot", { botId: opts.botId }, 30, opts),
    }),
    defineTool({
      name: "computer_screenshot",
      label: "Computer Screenshot",
      description: opts.vision
        ? "Take a screenshot of the shared desktop screen (not just the browser). The computer must be online."
        : "Get a visual description of the shared desktop screen. Prefer browser_read for web pages. The computer must be online.",
      promptSnippet: "Capture the shared desktop",
      parameters: Type.Object({}),
      execute: async () => fromComputer(opts.computer, "/desktop/screenshot", {}, 20, opts),
    }),
  ];

  const mcp: ToolDefinition[] = [
    defineTool({
      name: "mcp_list_tools",
      label: "List MCP Tools",
      description:
        "List tools exposed by configured MCP servers on the host. Call this before mcp_call when you need an external MCP capability. MCP does not use the shared computer.",
      promptSnippet: "Discover tools from configured MCP servers",
      parameters: Type.Object({
        server: Type.Optional(
          Type.String({ description: "Optional MCP server name or id; omit to list every server" }),
        ),
      }),
      execute: async (_id, params) => {
        if (!opts.mcp) return textResult("MCP is not available.", true);
        try {
          const result = await opts.mcp.list(params.server);
          return textResult(result.text || "No MCP tools.", result.isError);
        } catch (err) {
          return textResult(`MCP list failed: ${(err as Error).message}`, true);
        }
      },
    }),
    defineTool({
      name: "mcp_call",
      label: "Call MCP Tool",
      description:
        "Call a tool on a configured MCP server running on the host. Use mcp_list_tools first to get the exact tool name and input schema. MCP does not use the shared computer. Image results are passed through directly for visual models, or described by the configured vision helper for text-only models.",
      promptSnippet: "Call an external tool through MCP",
      parameters: Type.Object({
        server: Type.String({ description: "MCP server name or id" }),
        tool: Type.String({ description: "Exact MCP tool name" }),
        argumentsJson: Type.Optional(
          Type.String({ description: "Tool arguments as a JSON object string; defaults to {}" }),
        ),
      }),
      execute: async (toolCallId, params) => {
        const servers = opts.listMcpServers?.() ?? [];
        const key = String(params.server ?? "").trim().toLowerCase();
        const server = servers.find(
          (item) => item.id === params.server || item.name.toLowerCase() === key,
        );
        if (!server) return textResult(`No enabled MCP server named "${params.server}" is configured.`, true);
        if (server.toolConfig?.[params.tool]?.enabled === false) {
          return textResult(`MCP tool "${params.tool}" is disabled in Settings.`, true);
        }
        let args: Record<string, unknown> = {};
        try {
          args = params.argumentsJson ? JSON.parse(params.argumentsJson) : {};
        } catch {
          return textResult("argumentsJson must be a valid JSON object string.", true);
        }
        const approval = shouldApproveMcp(server, params.tool);
        if (approval.required) {
          const summary = JSON.stringify(args);
          const title = `${server.name} / ${params.tool} — ${summary.length > 500 ? `${summary.slice(0, 500)}…` : summary}`;
          const options = approval.forced ? ["Allow once", "Deny"] : ["Allow once", "Always allow", "Deny"];
          const choice = await opts.requestApproval(toolCallId, title, title, options);
          if (choice !== "Allow once" && choice !== "Always allow") {
            return textResult("MCP call denied by the user.", true);
          }
          if (choice === "Always allow") opts.rememberMcpAllow?.(server.id, params.tool);
        }
        if (!opts.mcp) return textResult("MCP is not available.", true);
        try {
          const result = await opts.mcp.call(server, params.tool, args);
          const blocks = result.content.length > 0 ? result.content : [{ type: "text" as const, text: result.text }];
          const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
          for (const block of blocks) {
            if (block.type === "image" && block.data) {
              if (opts.vision) {
                content.push({ type: "image", data: block.data, mimeType: block.mimeType ?? "image/png" });
              } else if (opts.visionHelper) {
                try {
                  const description = await describeImageWithHelper(
                    opts.visionHelper,
                    block.data,
                    block.mimeType ?? "image/png",
                  );
                  content.push({ type: "text", text: `[MCP image described by vision helper]\n${description}` });
                } catch (err) {
                  content.push({
                    type: "text",
                    text: `[MCP returned an image, but the vision helper failed: ${(err as Error).message}]`,
                  });
                }
              } else {
                content.push({
                  type: "text",
                  text: "[MCP returned an image, but this model has no vision helper configured.]",
                });
              }
            } else {
              content.push({
                type: "text",
                text: block.type === "text" ? block.text : "",
              });
            }
          }
          if (content.length === 0) content.push({ type: "text", text: "MCP tool completed with no content." });
          return { content, details: { server: server.name, tool: params.tool }, isError: !!result.isError };
        } catch (err) {
          return textResult(`MCP call failed: ${(err as Error).message}`, true);
        }
      },
    }),
  ];

  return [...coding, ...social, ...browser, ...mcp] as ToolDefinition[];
}

export function buildSendMessageTool(): ToolDefinition {
  return defineTool({
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
      done: Type.Optional(Type.Boolean({ description: "True if nothing useful remains for anyone" })),
      pass: Type.Optional(
        Type.Boolean({
          description: "True if you have nothing to say this turn. text is ignored and not shown in the room.",
        }),
      ),
    }),
    execute: async (_id, params) => {
      if (params.pass === true) return textResult("Passed.");
      const text = String(params.text ?? "").trim();
      if (!text || /^\(?pass\.?\)?$/i.test(text)) return textResult("Passed.");
      return textResult("Posted to the group.");
    },
  });
}

export const HOST_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "update_memory",
  "save_skill",
  "request_approval",
  "message_teammate",
  "browser_navigate",
  "browser_read",
  "browser_click",
  "browser_type",
  "browser_screenshot",
  "computer_screenshot",
  "mcp_list_tools",
  "mcp_call",
] as const;

export const GROUP_TOOL_NAMES = [...HOST_TOOL_NAMES, "send_message"] as const;
