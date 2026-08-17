import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";

type TextField = HTMLInputElement | HTMLTextAreaElement;

const SKIP_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "file",
  "image",
  "hidden",
  "range",
  "color",
]);

function isTextInput(el: HTMLInputElement): boolean {
  if (el.disabled) return false;
  return !SKIP_INPUT_TYPES.has((el.type || "text").toLowerCase());
}

export function findTextField(target: EventTarget | null): TextField | HTMLElement | null {
  let node: Element | null = null;
  if (target instanceof Text) node = target.parentElement;
  else if (target instanceof Element) node = target;
  if (!node) return null;
  if (node.closest("iframe")) return null;
  const scoped = node.closest("input, textarea, [contenteditable], [data-edit-field]");
  if (!scoped) return null;
  if (scoped instanceof HTMLInputElement) return isTextInput(scoped) ? scoped : null;
  if (scoped instanceof HTMLTextAreaElement) return scoped.disabled ? null : scoped;
  if (scoped instanceof HTMLElement && scoped.isContentEditable) return scoped;
  return (
    scoped.querySelector<TextField>(
      "textarea:not([disabled]), input:not([type=file]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=hidden]):not([disabled])",
    ) ?? null
  );
}

export function isNativeContextTarget(el: EventTarget | null): boolean {
  if (el instanceof Element && el.closest("iframe")) return true;
  return !!findTextField(el);
}

export function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

export function selectedText(): string {
  return window.getSelection()?.toString().trim() ?? "";
}

type OpenOpts = { onClose?: () => void };

type MenuState = {
  x: number;
  y: number;
  content: ReactNode;
  onClose?: () => void;
};

type MenuApi = {
  open: (e: React.MouseEvent, content: ReactNode, opts?: OpenOpts) => void;
  openAt: (x: number, y: number, content: ReactNode, opts?: OpenOpts) => void;
  close: () => void;
};

const MenuCtx = createContext<MenuApi | null>(null);

export function useContextMenu(): MenuApi {
  const ctx = useContext(MenuCtx);
  if (!ctx) throw new Error("useContextMenu must be used inside ContextMenuProvider");
  return ctx;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const close = useCallback(() => {
    setMenu((prev) => {
      prev?.onClose?.();
      return null;
    });
  }, []);

  const openAt = useCallback((x: number, y: number, content: ReactNode, opts?: OpenOpts) => {
    window.dispatchEvent(new Event("pibot-app-menu"));
    setMenu((prev) => {
      if (prev && prev.onClose !== opts?.onClose) prev.onClose?.();
      return { x, y, content, onClose: opts?.onClose };
    });
  }, []);

  const open = useCallback(
    (e: React.MouseEvent, content: ReactNode, opts?: OpenOpts) => {
      e.preventDefault();
      e.stopPropagation();
      openAt(e.clientX, e.clientY, content, opts);
    },
    [openAt],
  );

  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("iframe")) return;
      const field = findTextField(e.target);
      if (field) {
        e.preventDefault();
        e.stopPropagation();
        openAt(e.clientX, e.clientY, <EditMenu field={field} />);
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx, true);
    return () => document.removeEventListener("contextmenu", onCtx, true);
  }, [openAt]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = () => close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, close]);

  return (
    <MenuCtx.Provider value={{ open, openAt, close }}>
      {children}
      {menu
        ? createPortal(
            <MenuPanel x={menu.x} y={menu.y} onClose={close}>
              {menu.content}
            </MenuPanel>,
            document.body,
          )
        : null}
    </MenuCtx.Provider>
  );
}

function MenuPanel({
  x,
  y,
  onClose,
  children,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [x, y, children]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" style={{ ...panel, left: pos.left, top: pos.top }}>
      {children}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { close } = useContextMenu();
  return (
    <button
      role="menuitem"
      type="button"
      disabled={disabled}
      style={{
        ...item,
        color: danger ? "#ef4444" : "var(--text-primary)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (disabled) return;
        onClick();
        close();
      }}
    >
      {children}
    </button>
  );
}

export function MenuSep() {
  return <div style={sep} />;
}

function fieldSnapshot(field: TextField | HTMLElement) {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? 0;
    return {
      start,
      end,
      text: field.value.slice(start, end),
      readOnly: field.readOnly || field.disabled,
    };
  }
  return {
    start: 0,
    end: 0,
    text: window.getSelection()?.toString() ?? "",
    readOnly: false,
  };
}

function setTextFieldValue(field: TextField, value: string, caret: number) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus();
  field.setSelectionRange(caret, caret);
}

async function writeClip(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* use execCommand below */
  }
  document.execCommand("copy");
}

async function cutField(field: TextField | HTMLElement, snap: ReturnType<typeof fieldSnapshot>) {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = field.selectionStart ?? snap.start;
    const end = field.selectionEnd ?? snap.end;
    const text = start !== end ? field.value.slice(start, end) : snap.text;
    if (!text) return;
    await writeClip(text);
    setTextFieldValue(field, field.value.slice(0, start) + field.value.slice(end), start);
    return;
  }
  field.focus();
  document.execCommand("cut");
}

async function copyField(field: TextField | HTMLElement, snap: ReturnType<typeof fieldSnapshot>) {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = field.selectionStart ?? snap.start;
    const end = field.selectionEnd ?? snap.end;
    const text = start !== end ? field.value.slice(start, end) : snap.text;
    if (text) await writeClip(text);
    return;
  }
  const text = window.getSelection()?.toString() || snap.text;
  if (text) await writeClip(text);
}

async function pasteField(field: TextField | HTMLElement, snap: ReturnType<typeof fieldSnapshot>) {
  let clip = "";
  try {
    clip = navigator.clipboard?.readText ? await navigator.clipboard.readText() : "";
  } catch {
    return;
  }
  if (!clip) return;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = field.selectionStart ?? snap.start;
    const end = field.selectionEnd ?? snap.end;
    setTextFieldValue(field, field.value.slice(0, start) + clip + field.value.slice(end), start + clip.length);
    return;
  }
  field.focus();
  document.execCommand("insertText", false, clip);
}

function selectAllField(field: TextField | HTMLElement) {
  field.focus();
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    field.setSelectionRange(0, field.value.length);
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(field);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function EditMenu({ field }: { field: TextField | HTMLElement }) {
  const tr = useT();
  const snap = fieldSnapshot(field);
  const canEdit = !snap.readOnly;
  const hasSel = snap.text.length > 0;
  return (
    <>
      <MenuItem
        disabled={!canEdit}
        onClick={() => {
          field.focus();
          document.execCommand("undo");
        }}
      >
        {tr("edit.undo")}
      </MenuItem>
      <MenuSep />
      <MenuItem disabled={!canEdit || !hasSel} onClick={() => void cutField(field, snap)}>
        {tr("edit.cut")}
      </MenuItem>
      <MenuItem disabled={!hasSel} onClick={() => void copyField(field, snap)}>
        {tr("edit.copy")}
      </MenuItem>
      <MenuItem disabled={!canEdit} onClick={() => void pasteField(field, snap)}>
        {tr("edit.paste")}
      </MenuItem>
      <MenuSep />
      <MenuItem onClick={() => selectAllField(field)}>{tr("edit.selectAll")}</MenuItem>
    </>
  );
}

const panel: React.CSSProperties = {
  position: "fixed",
  zIndex: 80,
  minWidth: 200,
  maxWidth: 280,
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 10,
  padding: 4,
  boxShadow: "var(--shadow)",
  animation: "fade-up 0.12s ease",
};

const item: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  fontSize: 13,
  padding: "8px 10px",
  borderRadius: 7,
};

const sep: React.CSSProperties = {
  height: 1,
  margin: "4px 6px",
  background: "var(--border-subtle)",
};
