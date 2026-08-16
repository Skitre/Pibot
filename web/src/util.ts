import { localeTag } from "./prefs";
import { t } from "./i18n";

export function isMainChannel(channel?: string) {
  return !channel || channel === "main" || channel === "unknown";
}

export function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const loc = localeTag();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) {
    return d.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" });
  }
  if (d.toDateString() === yesterday.toDateString()) return t("time.yesterday");
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 7) return d.toLocaleDateString(loc, { weekday: "long" });
  return d.toLocaleDateString(loc, { month: "short", day: "numeric" });
}

export function formatDayDivider(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const loc = localeTag();
  const prefix =
    d.toDateString() === now.toDateString()
      ? t("time.today")
      : d.toLocaleDateString(loc, { weekday: "long", month: "short", day: "numeric" });
  return `${prefix} ${d.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" })}`;
}
