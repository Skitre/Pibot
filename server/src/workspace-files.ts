/** 共享工作区路径与 Bot 产出文件识别 */

export const WORKSPACE = "/config/workspace";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  markdown: "text/plain; charset=utf-8",
  json: "application/json",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  xml: "application/xml",
  yaml: "text/yaml; charset=utf-8",
  yml: "text/yaml; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  jsx: "text/plain; charset=utf-8",
  py: "text/plain; charset=utf-8",
  sh: "text/plain; charset=utf-8",
  sql: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
};

const SKIP_SEGMENTS = new Set([".git", "node_modules", "__pycache__", ".pi", "uploads"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

export function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function fileBasename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "file";
}

/** 把 write/edit 的 path 收成 workspace 内绝对路径；不合格返回 null */
export function resolveWorkspacePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.includes("\0")) return null;
  const abs = trimmed.startsWith("/")
    ? trimmed
    : `${WORKSPACE}/${trimmed.replace(/^\.\//, "")}`;
  const parts: string[] = [];
  for (const part of abs.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const normalized = `/${parts.join("/")}`;
  if (normalized !== WORKSPACE && !normalized.startsWith(`${WORKSPACE}/`)) return null;
  const rel = normalized.slice(WORKSPACE.length + 1);
  if (!rel) return null;
  if (rel.split("/").some((seg) => SKIP_SEGMENTS.has(seg))) return null;
  if (rel === "AGENTS.md") return null;
  return normalized;
}

export function toolWritePath(toolName: string, args: unknown): string | null {
  if (!WRITE_TOOLS.has(toolName) || !args || typeof args !== "object") return null;
  const path = (args as { path?: unknown }).path;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

export function workspaceRelPath(abs: string): string {
  return abs.startsWith(`${WORKSPACE}/`) ? abs.slice(WORKSPACE.length + 1) : abs;
}
