import { useSyncExternalStore } from "react";

export type Locale = "zh" | "en";
export type Theme = "dark" | "light";

// 界面偏好：只影响本机显示，存 localStorage，不需要走服务端。
export interface Prefs {
  locale: Locale;
  theme: Theme;
  panelOpenByDefault: boolean;
  confirmDestructive: boolean;
  showToolCards: boolean;
  showSystemLines: boolean;
  notifications: boolean;
}

const DEFAULTS: Prefs = {
  locale: "zh",
  theme: "dark",
  panelOpenByDefault: true,
  confirmDestructive: true,
  showToolCards: true,
  showSystemLines: true,
  notifications: false,
};

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

const KEY = "pibot.prefs";

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    if (parsed.locale !== "zh" && parsed.locale !== "en") parsed.locale = "zh";
    if (parsed.theme !== "light" && parsed.theme !== "dark") parsed.theme = "dark";
    applyTheme(parsed.theme);
    return parsed;
  } catch {
    applyTheme(DEFAULTS.theme);
    return { ...DEFAULTS };
  }
}

class PrefsStore {
  private state: Prefs = load();
  private listeners = new Set<() => void>();

  get = () => this.state;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set(patch: Partial<Prefs>) {
    this.state = { ...this.state, ...patch };
    if (patch.theme) applyTheme(this.state.theme);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // 隐私模式等场景下写入失败，仅内存生效
    }
    this.listeners.forEach((l) => l());
  }
}

export const prefs = new PrefsStore();

export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get, prefs.get);
}

export function askConfirm(message: string): boolean {
  if (!prefs.get().confirmDestructive) return true;
  return window.confirm(message);
}

export function localeTag(locale: Locale = prefs.get().locale): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}
