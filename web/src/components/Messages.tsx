import React, { useEffect, useState } from "react";
import type { Message, ApprovalMeta, ToolMeta, Attachment, FileMeta } from "../types";
import { Markdown } from "./Markdown";
import { store } from "../store";
import { api } from "../api";
import { CopyIcon, CheckIcon, FileIcon, ChevronRight, DownloadIcon, CloseIcon } from "./icons";
import { useT, translateToolName, translateOption, type TFn } from "../i18n";

// 悬停复制按钮：官方气泡右侧的操作列（这里先实现复制）
function CopyAction({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const tr = useT();
  return (
    <button
      className="msg-act"
      style={copyBtn}
      title={tr("msg.copy")}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? <CheckIcon size={13} color="var(--green-dot)" /> : <CopyIcon size={13} />}
    </button>
  );
}

function AttachmentView({ att, botId }: { att: Attachment; botId: string }) {
  const url = api.fileUrl(botId, att.path);
  if (att.mime.startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={att.name} style={attImage} />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={attFile}>
      <FileIcon size={15} color="var(--text-secondary)" />
      <span style={attFileName}>{att.name}</span>
      <span style={attFileSize}>{formatSize(att.size)}</span>
    </a>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileMeta(message: Message): FileMeta {
  try {
    return (message.meta ? JSON.parse(message.meta) : {}) as FileMeta;
  } catch {
    return { name: message.content || "file", path: "", size: 0, mime: "" };
  }
}

function isImageFile(meta: FileMeta): boolean {
  return meta.mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(meta.name);
}

function isTextPreview(meta: FileMeta): boolean {
  if (isImageFile(meta) || meta.size > 256 * 1024) return false;
  if (meta.mime.startsWith("text/") || meta.mime.includes("json") || meta.mime.includes("xml")) return true;
  return /\.(md|csv|tsv|json|ya?ml|xml|html?|css|ts|tsx|js|jsx|py|sh|sql|log|txt)$/i.test(meta.name);
}

export function FileCard({ message }: { message: Message }) {
  const meta = fileMeta(message);
  const tr = useT();
  const [preview, setPreview] = useState(false);
  const [broken, setBroken] = useState(false);
  const url = meta.path ? api.fileUrl(message.bot_id, meta.path) : "";
  const downloadUrl = meta.path ? api.fileUrl(message.bot_id, meta.path, true) : "";
  const image = isImageFile(meta);
  const text = isTextPreview(meta);
  const pdf = meta.mime === "application/pdf" || /\.pdf$/i.test(meta.name);
  const canPreview = image || text;
  const ext = (meta.name.split(".").pop() ?? "").toUpperCase();

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-start", margin: "6px 0" }}>
        <div style={fileCard}>
          {image && url && !broken && (
            <button style={fileThumbBtn} onClick={() => setPreview(true)} title={tr("file.open")}>
              <img
                src={url}
                alt={meta.name}
                style={fileThumb}
                onError={() => setBroken(true)}
              />
            </button>
          )}
          <div style={fileRow}>
            <button
              className="file-card"
              style={fileMain}
              onClick={() => {
                if (canPreview && url) setPreview(true);
                else if (pdf && url) window.open(url, "_blank");
                else if (downloadUrl) window.open(downloadUrl, "_blank");
              }}
              title={canPreview || pdf ? tr("file.open") : tr("file.download")}
            >
              {!(image && url && !broken) && (
                <span style={fileGlyph}>
                  <FileIcon size={16} color="var(--text-secondary)" />
                </span>
              )}
              <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                <span style={fileName}>{meta.name || message.content}</span>
                <span style={fileSub}>
                  {ext && `${ext} · `}
                  {formatSize(meta.size)}
                </span>
              </span>
            </button>
            {downloadUrl && (
              <a href={downloadUrl} download={meta.name} style={fileDl} title={tr("file.download")}>
                <DownloadIcon size={14} color="var(--text-secondary)" />
              </a>
            )}
          </div>
        </div>
      </div>
      {preview && url && (
        <FilePreview
          name={meta.name}
          url={url}
          downloadUrl={downloadUrl}
          image={image}
          text={text}
          onClose={() => setPreview(false)}
        />
      )}
    </>
  );
}

function FilePreview({
  name,
  url,
  downloadUrl,
  image,
  text,
  onClose,
}: {
  name: string;
  url: string;
  downloadUrl: string;
  image: boolean;
  text: boolean;
  onClose: () => void;
}) {
  const tr = useT();
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!text) return;
    let cancelled = false;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("missing");
        return r.text();
      })
      .then((t) => {
        if (!cancelled) setBody(t);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [text, url]);

  return (
    <div style={previewOverlay} onClick={onClose}>
      <div style={previewPanel} onClick={(e) => e.stopPropagation()}>
        <div style={previewBar}>
          <span style={previewTitle}>{name}</span>
          <a href={downloadUrl} download={name} style={previewBarBtn} title={tr("file.download")}>
            <DownloadIcon size={15} />
          </a>
          <button style={previewBarBtn} onClick={onClose} title={tr("file.close")}>
            <CloseIcon size={15} />
          </button>
        </div>
        <div style={previewBody}>
          {image && <img src={url} alt={name} style={previewImage} />}
          {text && failed && <div style={previewEmpty}>{tr("file.unavailable")}</div>}
          {text && !failed && body === null && <div style={previewEmpty}>…</div>}
          {text && body !== null && /\.(md|markdown)$/i.test(name) && (
            <div style={previewMd}>
              <Markdown text={body} />
            </div>
          )}
          {text && body !== null && !/\.(md|markdown)$/i.test(name) && (
            <pre style={previewText}>{body}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function UserBubble({ message }: { message: Message }) {
  const meta = message.meta ? (JSON.parse(message.meta) as { attachments?: Attachment[] }) : {};
  const attachments = meta.attachments ?? [];
  const tr = useT();
  const source =
    message.author === "routine"
      ? tr("msg.routine")
      : message.author.startsWith("bot:")
        ? tr("msg.from", { name: message.author.slice(4) })
        : null;
  return (
    <div className="msg-row" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, margin: "3px 0" }}>
      {message.content && <CopyAction text={message.content} />}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, maxWidth: "74%" }}>
        {source && <div style={sourceTag}>{source}</div>}
        {attachments.map((a) => (
          <AttachmentView key={a.path} att={a} botId={message.bot_id} />
        ))}
        {message.content && <div style={{ ...bubbleUser, maxWidth: "100%" }}>{message.content}</div>}
      </div>
    </div>
  );
}

export function BotBubble({ text, botId }: { text: string; botId?: string }) {
  void botId;
  return (
    <div className="msg-row" style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 6, margin: "3px 0" }}>
      <div style={bubbleBot}>
        <Markdown text={text} />
      </div>
      <CopyAction text={text} />
    </div>
  );
}

export function SystemLine({ text }: { text: string }) {
  return <div style={systemLine}>{text}</div>;
}

function toolMeta(message: Message): ToolMeta {
  try {
    return (message.meta ? JSON.parse(message.meta) : {}) as ToolMeta;
  } catch {
    return { toolName: "tool", isError: false, toolCallId: "" };
  }
}

function toolLabel(message: Message, tr: TFn): string {
  const name = toolMeta(message).toolName ?? "tool";
  return translateToolName(name, tr);
}

function formatDuration(ms: number, tr: TFn): string {
  if (ms < 1000) return tr("duration.lt1");
  const s = Math.round(ms / 1000);
  if (s < 60) return tr("duration.s", { n: s });
  return tr("duration.ms", { m: Math.floor(s / 60), s: s % 60 });
}

// 单个工具步骤：一行摘要，点击后在下方展开完整输出
function WorkStep({ message }: { message: Message }) {
  const meta = toolMeta(message);
  const [open, setOpen] = useState(meta.isError);
  const preview = message.content.replace(/\s+/g, " ").trim();
  const hasBody = preview.length > 0;
  const tr = useT();
  return (
    <div style={stepRoot}>
      <button
        className="work-step"
        style={{ ...stepHead, cursor: hasBody ? "pointer" : "default" }}
        onClick={() => hasBody && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasBody}
      >
        <span style={toolDot(meta.isError)} />
        <span style={{ ...stepLabel, color: meta.isError ? "#f87171" : "var(--text-primary)" }}>
          {toolLabel(message, tr)}
        </span>
        {!open && hasBody && <span style={stepPreview}>{preview.slice(0, 80)}</span>}
      </button>
      {open && hasBody && (
        <div style={stepBody}>
          <Markdown text={message.content} />
        </div>
      )}
    </div>
  );
}

// 一轮回复里连续的工具调用合并成一条"工作记录"，默认折叠，出错时自动展开
export function WorkLog({ messages, live = false }: { messages: Message[]; live?: boolean }) {
  const errors = messages.filter((m) => toolMeta(m).isError).length;
  const [expanded, setExpanded] = useState(errors > 0 || live);
  const duration = messages[messages.length - 1].created_at - messages[0].created_at;
  const tr = useT();

  useEffect(() => {
    if (errors > 0 || live) setExpanded(true);
  }, [errors, live]);

  // 单步不套折叠头：直接一行，避免多点一次
  if (messages.length === 1) {
    return (
      <div style={workLogSingle}>
        <WorkStep message={messages[0]} />
      </div>
    );
  }

  return (
    <div style={{ ...workLog, borderColor: errors > 0 ? "#5b2b2b" : "var(--border-subtle)" }}>
      <button className="work-head" style={workHead} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span style={{ ...chevron, transform: expanded ? "rotate(90deg)" : "none" }}>
          <ChevronRight size={13} />
        </span>
        <span style={workSummary}>
          {tr("msg.worked", { duration: formatDuration(duration, tr), n: messages.length })}
        </span>
        {errors > 0 && <span style={failTag}>{tr("msg.failed", { n: errors })}</span>}
      </button>
      {expanded && (
        <div style={workSteps}>
          {messages.map((m) => (
            <WorkStep key={m.id} message={m} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ApprovalCard({ message }: { message: Message }) {
  const meta = (message.meta ? JSON.parse(message.meta) : {}) as ApprovalMeta;
  const tr = useT();
  const respond = (value: string | boolean) => {
    store.respondApproval(message.bot_id, meta.requestId, value);
  };
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", margin: "6px 0" }}>
      <div style={approvalCard}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: meta.message ? 4 : 8 }}>
          {message.content}
        </div>
        {meta.message && <div style={approvalMsg}>{meta.message}</div>}
        {meta.resolved ? (
          <div style={resolvedTag}>
            {typeof meta.decision === "boolean"
              ? meta.decision
                ? tr("msg.approved")
                : tr("msg.rejected")
              : tr("msg.chose", { value: translateOption(String(meta.decision), tr) })}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {meta.method === "confirm" ? (
              <>
                <button style={btnPrimary} onClick={() => respond(true)}>
                  {tr("msg.approve")}
                </button>
                <button style={btnGhost} onClick={() => respond(false)}>
                  {tr("msg.reject")}
                </button>
              </>
            ) : (
              meta.options.map((opt, i) => (
                <button
                  key={opt}
                  style={i === 0 ? btnPrimary : btnGhost}
                  onClick={() => respond(opt)}
                >
                  {translateOption(opt, tr)}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 把相邻的工具消息折叠成一组，其余消息原样保留顺序
export function MessageThread({ messages, live = false }: { messages: Message[]; live?: boolean }) {
  const out: React.ReactNode[] = [];
  let run: Message[] = [];
  const flush = (isTail: boolean) => {
    if (run.length === 0) return;
    out.push(<WorkLog key={`work-${run[0].id}`} messages={run} live={live && isTail} />);
    run = [];
  };
  for (const m of messages) {
    if (m.kind === "tool") {
      run.push(m);
      continue;
    }
    flush(false);
    out.push(renderMessage(m));
  }
  flush(true);
  return <>{out}</>;
}

function renderMessage(m: Message): React.ReactNode {
  switch (m.kind) {
    case "tool":
      return <WorkLog key={m.id} messages={[m]} />;
    case "approval":
      return <ApprovalCard key={m.id} message={m} />;
    case "file":
      return <FileCard key={m.id} message={m} />;
    case "system":
      return <SystemLine key={m.id} text={m.content} />;
    default:
      return m.role === "user" ? (
        <UserBubble key={m.id} message={m} />
      ) : (
        <BotBubble key={m.id} text={m.content} />
      );
  }
}

const bubbleBase: React.CSSProperties = {
  maxWidth: "74%",
  padding: "9px 14px",
  borderRadius: 18,
  fontSize: 14,
  wordBreak: "break-word",
  animation: "fade-up 0.18s ease",
};
const bubbleUser: React.CSSProperties = {
  ...bubbleBase,
  background: "var(--bg-bubble-user)",
  color: "var(--text-bubble-user)",
  borderBottomRightRadius: 6,
};
const bubbleBot: React.CSSProperties = {
  ...bubbleBase,
  background: "var(--bg-bubble-bot)",
  border: "1px solid var(--border-subtle)",
  borderBottomLeftRadius: 6,
};
const systemLine: React.CSSProperties = {
  textAlign: "center",
  fontSize: 11.5,
  color: "var(--text-secondary)",
  margin: "8px 0",
};
// 工作记录：无气泡、弱化底色，与 Bot 回复气泡区分开
// 拆分 border 属性：WorkLog 会按错误状态覆盖 borderColor
const workLog: React.CSSProperties = {
  maxWidth: "74%",
  margin: "6px 0",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 10,
  overflow: "hidden",
  animation: "fade-up 0.18s ease",
};
const workLogSingle: React.CSSProperties = {
  maxWidth: "74%",
  margin: "2px 0 2px 2px",
  animation: "fade-up 0.18s ease",
};
const workHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  textAlign: "left",
  padding: "6px 10px",
  color: "var(--text-secondary)",
};
const chevron: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
  transition: "transform 0.15s ease",
};
const workSummary: React.CSSProperties = {
  fontSize: 12.5,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const failTag: React.CSSProperties = {
  marginLeft: "auto",
  flexShrink: 0,
  fontSize: 11,
  color: "#f87171",
};
const workSteps: React.CSSProperties = {
  borderTop: "1px solid var(--border-subtle)",
  padding: "4px 0",
};
const stepRoot: React.CSSProperties = { padding: "0 10px" };
const stepHead: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "5px 0",
  minWidth: 0,
};
const stepLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 500, flexShrink: 0 };
const stepPreview: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const stepBody: React.CSSProperties = {
  margin: "2px 0 8px 15px",
  padding: "8px 10px",
  background: "var(--bg-bubble-bot)",
  borderRadius: 8,
  fontSize: 12.5,
  color: "var(--text-primary)",
  maxHeight: 420,
  overflow: "auto",
  wordBreak: "break-word",
};
const toolDot = (err: boolean): React.CSSProperties => ({
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: err ? "#ef4444" : "var(--green-dot)",
  flexShrink: 0,
});
const approvalCard: React.CSSProperties = {
  maxWidth: "74%",
  background: "var(--bg-bubble-bot)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 14,
  padding: "12px 14px",
  animation: "fade-up 0.18s ease",
};
const approvalMsg: React.CSSProperties = { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.4 };
const resolvedTag: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: "var(--text-secondary)",
  fontStyle: "italic",
};
const btnPrimary: React.CSSProperties = {
  background: "var(--btn-primary-bg)",
  color: "var(--btn-primary-fg)",
  fontWeight: 600,
  fontSize: 13,
  padding: "7px 16px",
  borderRadius: 8,
};
const btnGhost: React.CSSProperties = {
  background: "var(--bg-active)",
  color: "var(--text-primary)",
  fontWeight: 500,
  fontSize: 13,
  padding: "7px 16px",
  borderRadius: 8,
};
const sourceTag: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  margin: "2px 4px 0 0",
};
const copyBtn: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 7,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
  flexShrink: 0,
};
const attImage: React.CSSProperties = {
  maxWidth: 280,
  maxHeight: 220,
  borderRadius: 14,
  border: "1px solid var(--border-subtle)",
  display: "block",
  objectFit: "cover",
};
const attFile: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "var(--bg-bubble-user)",
  borderRadius: 12,
  padding: "9px 13px",
  color: "var(--text-bubble-user)",
  textDecoration: "none",
  maxWidth: 280,
};
const attFileName: React.CSSProperties = {
  fontSize: 13,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const attFileSize: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-secondary)",
  flexShrink: 0,
};
const fileCard: React.CSSProperties = {
  maxWidth: 320,
  background: "var(--bg-bubble-bot)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 14,
  overflow: "hidden",
  animation: "fade-up 0.18s ease",
};
const fileThumbBtn: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 0,
  background: "#111",
};
const fileThumb: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxHeight: 200,
  objectFit: "cover",
};
const fileRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  padding: "8px 8px 8px 10px",
};
const fileMain: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
  flex: 1,
  textAlign: "left",
  padding: "2px 0",
};
const fileGlyph: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  background: "var(--bg-active)",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};
const fileName: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const fileSub: React.CSSProperties = {
  display: "block",
  fontSize: 11.5,
  color: "var(--text-secondary)",
  marginTop: 2,
};
const fileDl: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 7,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
  flexShrink: 0,
};
const previewOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  background: "rgba(0, 0, 0, 0.62)",
  display: "grid",
  placeItems: "center",
  padding: 24,
};
const previewPanel: React.CSSProperties = {
  width: "min(760px, 100%)",
  maxHeight: "86vh",
  background: "var(--bg-panel)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 14,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 18px 48px rgba(0, 0, 0, 0.45)",
};
const previewBar: React.CSSProperties = {
  height: 46,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 10px 0 16px",
  borderBottom: "1px solid var(--border-subtle)",
};
const previewTitle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13.5,
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const previewBarBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 7,
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
};
const previewBody: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: 16,
};
const previewImage: React.CSSProperties = {
  display: "block",
  maxWidth: "100%",
  maxHeight: "72vh",
  margin: "0 auto",
  borderRadius: 8,
};
const previewText: React.CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};
const previewMd: React.CSSProperties = {
  fontSize: 14,
};
const previewEmpty: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  textAlign: "center",
  padding: "28px 12px",
};
