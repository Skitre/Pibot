import { useEffect, useRef, useState } from "react";
import type { Skill } from "../types";
import { PlusIcon, MicIcon, SendArrow, StopIcon, CloseIcon, FileIcon } from "./icons";
import { api } from "../api";
import { useStore } from "../store";
import { useT } from "../i18n";

interface Props {
  botId?: string;
  botName: string;
  onSend: (text: string, files: File[]) => void;
  /** 生成中：右侧按钮变为停止 */
  working?: boolean;
  onStop?: () => void;
  /** 上传中：禁用发送，避免重复提交 */
  busy?: boolean;
  /** 关闭后隐藏附件按钮（默认开启；群聊与私聊都走共享 workspace） */
  allowAttachments?: boolean;
  /** 群聊 @ 补全：成员名 + everyone */
  mentionNames?: string[];
  onFocusChange?: (focused: boolean) => void;
}

const MAX_FILE_MB = 25;

export function Composer({
  botId,
  botName,
  onSend,
  working = false,
  onStop,
  busy = false,
  allowAttachments = true,
  mentionNames,
  onFocusChange,
}: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [skillSel, setSkillSel] = useState(0);
  const [botSkills, setBotSkills] = useState<Skill[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const globalSkills = useStore((s) => s.skills);
  const botSkillEpoch = useStore((s) => s.botSkillEpoch);
  const tr = useT();
  const hasContent = text.trim().length > 0 || files.length > 0;

  useEffect(() => {
    if (!botId) {
      setBotSkills(null);
      return;
    }
    let cancelled = false;
    api
      .getBotSettings(botId)
      .then(({ settings }) => {
        if (!cancelled) setBotSkills(settings.skills.filter((s) => s.enabled === 1));
      })
      .catch(() => {
        if (!cancelled) setBotSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [botId, botSkillEpoch]);

  const skills = botId ? (botSkills ?? []) : globalSkills;
  const focusCb = useRef(onFocusChange);
  focusCb.current = onFocusChange;

  useEffect(() => () => focusCb.current?.(false), []);

  // "/" 技能引用补全：文本以 /xxx 结尾（词首）时弹出匹配菜单
  const slashMatch = text.match(/(?:^|\s)\/([a-z0-9\u4e00-\u9fa5-]*)$/);
  const skillMenu =
    slashMatch !== null
      ? skills.filter((s) => s.slug.startsWith(slashMatch[1].toLowerCase())).slice(0, 6)
      : [];

  const atMatch = mentionNames?.length ? text.match(/(?:^|\s)@([^\s@]*)$/) : null;
  const mentionMenu =
    atMatch && mentionNames
      ? mentionNames.filter((n) => n.toLowerCase().startsWith(atMatch[1].toLowerCase())).slice(0, 8)
      : [];

  const pickSkill = (slug: string) => {
    const m = slashMatch![0]; // "/xxx" 或 " /xxx"
    const keep = m.startsWith(" ") ? " " : "";
    setText(text.slice(0, text.length - m.length) + keep + `/${slug} `);
    setSkillSel(0);
  };

  const pickMention = (name: string) => {
    const m = atMatch![0];
    const keep = m.startsWith(" ") ? " " : "";
    setText(text.slice(0, text.length - m.length) + keep + `@${name} `);
    setSkillSel(0);
  };

  const addFiles = (list: FileList | File[]) => {
    if (!allowAttachments) return;
    const next: File[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        alert(tr("composer.fileTooBig", { name: f.name, n: MAX_FILE_MB }));
        continue;
      }
      next.push(f);
    }
    if (next.length) setFiles((prev) => [...prev, ...next]);
  };

  const submit = () => {
    if (!hasContent || busy) return;
    onSend(text.trim(), files);
    setText("");
    setFiles([]);
  };

  return (
    <div style={{ ...wrap, position: "relative" }}>
      {mentionMenu.length > 0 && (
        <div style={skillMenuBox}>
          <div style={skillMenuLabel}>{tr("composer.mentions")}</div>
          {mentionMenu.map((name, i) => (
            <button
              key={name}
              style={{ ...skillMenuItem, background: i === skillSel ? "var(--bg-active)" : "transparent" }}
              onMouseEnter={() => setSkillSel(i)}
              onClick={() => pickMention(name)}
            >
              <span style={{ fontWeight: 600 }}>@{name}</span>
            </button>
          ))}
        </div>
      )}
      {mentionMenu.length === 0 && skillMenu.length > 0 && (
        <div style={skillMenuBox}>
          <div style={skillMenuLabel}>{tr("composer.skills")}</div>
          {skillMenu.map((s, i) => (
            <button
              key={s.id}
              style={{ ...skillMenuItem, background: i === skillSel ? "var(--bg-active)" : "transparent" }}
              onMouseEnter={() => setSkillSel(i)}
              onClick={() => pickSkill(s.slug)}
            >
              <span style={{ fontWeight: 600 }}>/{s.slug}</span>
              <span style={{ color: "var(--text-secondary)", marginLeft: 8, fontSize: 12 }}>
                {s.name}
                {s.description ? ` — ${s.description}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div style={chipRow}>
          {files.map((f, i) => (
            <AttachmentChip key={`${f.name}-${i}`} file={f} onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <div
        style={{ ...pill, ...(dragOver ? pillDragOver : {}) }}
        onDragOver={(e) => {
          if (!allowAttachments) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!allowAttachments) return;
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        {allowAttachments && (
          <>
            <button style={plusBtn} title={tr("composer.attach")} onClick={() => fileInput.current?.click()}>
              <PlusIcon size={18} color="var(--composer-plus-fg)" />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        )}
        <textarea
          style={input}
          placeholder={tr("composer.message", { name: botName })}
          value={text}
          rows={1}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (!allowAttachments) return;
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) {
              e.preventDefault();
              addFiles(pasted);
            }
          }}
          onKeyDown={(e) => {
            const menu = mentionMenu.length > 0 ? mentionMenu : skillMenu.length > 0 ? skillMenu : [];
            if (menu.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSkillSel((v) => (v + 1) % menu.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSkillSel((v) => (v - 1 + menu.length) % menu.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const i = Math.min(skillSel, menu.length - 1);
                if (mentionMenu.length > 0) pickMention(mentionMenu[i]);
                else pickSkill(skillMenu[i].slug);
                return;
              }
              if (e.key === "Escape") {
                setText(text + " ");
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {working && !hasContent ? (
          <button style={stopBtn} onClick={onStop} title={tr("composer.stop")}>
            <StopIcon size={16} color="var(--btn-primary-fg)" />
          </button>
        ) : (
          <button
            style={hasContent ? { ...sendBtn, opacity: busy ? 0.5 : 1 } : micBtn}
            onClick={submit}
            title={hasContent ? tr("composer.send") : tr("composer.voice")}
            disabled={busy}
          >
            {hasContent ? <SendArrow size={18} color="var(--btn-primary-fg)" /> : <MicIcon size={18} color="var(--composer-mic-fg)" />}
          </button>
        )}
      </div>
    </div>
  );
}

function AttachmentChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const tr = useT();
  return (
    <div style={chip}>
      {isImage ? (
        <img src={URL.createObjectURL(file)} style={chipThumb} alt={file.name} />
      ) : (
        <span style={chipIcon}>
          <FileIcon size={15} color="var(--text-secondary)" />
        </span>
      )}
      <span style={chipName}>{file.name}</span>
      <button style={chipRemove} onClick={onRemove} title={tr("composer.remove")}>
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

const wrap: React.CSSProperties = { padding: "10px 20px 18px" };
const skillMenuBox: React.CSSProperties = {
  position: "absolute",
  bottom: "100%",
  left: 20,
  right: 20,
  marginBottom: 6,
  background: "var(--bg-elevated)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-subtle)",
  borderRadius: 12,
  padding: 4,
  boxShadow: "var(--shadow)",
  zIndex: 25,
  animation: "fade-up 0.12s ease",
};
const skillMenuLabel: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  padding: "6px 10px 4px",
};
const skillMenuItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontSize: 13,
  padding: "7px 10px",
  borderRadius: 8,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const chipRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  padding: "0 4px 8px",
};
const chip: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  background: "var(--bg-input)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 10,
  padding: "5px 8px",
  maxWidth: 220,
  animation: "fade-up 0.15s ease",
};
const chipThumb: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  objectFit: "cover",
  flexShrink: 0,
};
const chipIcon: React.CSSProperties = { display: "grid", placeItems: "center", flexShrink: 0 };
const chipName: React.CSSProperties = {
  fontSize: 12,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const chipRemove: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  color: "var(--text-secondary)",
  flexShrink: 0,
};
const pill: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 46,
  background: "var(--composer-bg)",
  border: "1px solid var(--composer-border)",
  borderRadius: 23,
  padding: "4px 6px 4px 6px",
  boxShadow: "var(--composer-shadow)",
};
const pillDragOver: React.CSSProperties = {
  borderColor: "var(--accent-blue)",
  background: "var(--bg-active)",
};
const plusBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  background: "var(--composer-plus-bg)",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};
const input: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  resize: "none",
  fontSize: 14,
  lineHeight: "1.4",
  padding: "8px 2px",
  maxHeight: 120,
};
const sendBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  background: "var(--btn-primary-bg)",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};
const stopBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  background: "var(--btn-primary-bg)",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};
const micBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "50%",
  background: "var(--composer-mic-bg)",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
};
