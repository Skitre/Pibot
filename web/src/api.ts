import type {
  Attachment,
  ApprovalRule,
  ApprovalRuleInput,
  Bot,
  BotSettings,
  BotSettingsInput,
  Computer,
  Group,
  GroupMessage,
  GroupModeratorInput,
  Message,
  McpServer,
  McpServerInput,
  ModelProfile,
  ProfileInput,
  Routine,
  SearchHit,
  Skill,
} from "./types";

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export function apiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* keep raw */
  }
  return raw;
}

export const api = {
  listBots: () => fetch("/api/bots").then(j<{ bots: Bot[] }>),
  createBot: (name: string, role: string, modelProfileId?: string) =>
    fetch("/api/bots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role, modelProfileId }),
    }).then(j<{ bot: Bot }>),
  setBotModel: (id: string, profileId: string | null) =>
    fetch(`/api/bots/${id}/model`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId }),
    }),
  getBotSettings: (id: string) =>
    fetch(`/api/bots/${id}/settings`).then(j<{ settings: BotSettings }>),
  updateBotSettings: (id: string, input: BotSettingsInput) =>
    fetch(`/api/bots/${id}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ settings: BotSettings }>),
  messages: (id: string) =>
    fetch(`/api/bots/${id}/messages`).then(j<{ messages: Message[] }>),
  updateBot: (
    id: string,
    name: string,
    role: string,
    look?: { avatar_color?: string; avatar_shape?: string | null },
  ) =>
    fetch(`/api/bots/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role, ...look }),
    }).then(j<{ bot: Bot }>),
  clearMessages: (id: string) => fetch(`/api/bots/${id}/messages`, { method: "DELETE" }),
  uploadFile: (id: string, name: string, dataBase64: string, mime: string) =>
    fetch(`/api/bots/${id}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, data: dataBase64, mime }),
    }).then(j<{ attachment: Attachment }>),
  uploadGroupFile: (gid: string, name: string, dataBase64: string, mime: string) =>
    fetch(`/api/groups/${gid}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, data: dataBase64, mime }),
    }).then(j<{ attachment: Attachment }>),
  fileUrl: (botId: string, path: string, download = false) =>
    botId
      ? `/api/bots/${botId}/files?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`
      : `/api/files?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`,
  getMemory: (id: string) => fetch(`/api/bots/${id}/memory`).then(j<{ content: string }>),
  setMemory: (id: string, content: string) =>
    fetch(`/api/bots/${id}/memory`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }).then(j<{ ok: boolean }>),
  startBot: (id: string) => fetch(`/api/bots/${id}/start`, { method: "POST" }),
  stopBot: (id: string) => fetch(`/api/bots/${id}/stop`, { method: "POST" }),
  deleteBot: (id: string) => fetch(`/api/bots/${id}`, { method: "DELETE" }),
  pinBot: (id: string, pinned: boolean) =>
    fetch(`/api/bots/${id}/pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned }),
    }),
  hideBot: (id: string, hidden: boolean) =>
    fetch(`/api/bots/${id}/hide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hidden }),
    }),
  routines: (id: string) =>
    fetch(`/api/bots/${id}/routines`).then(j<{ routines: Routine[] }>),
  createRoutine: (id: string, name: string, cron: string, prompt: string) =>
    fetch(`/api/bots/${id}/routines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, cron, prompt }),
    }).then(j<{ routine: Routine }>),
  toggleRoutine: (rid: string, enabled: boolean) =>
    fetch(`/api/routines/${rid}/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  deleteRoutine: (rid: string) => fetch(`/api/routines/${rid}`, { method: "DELETE" }),
  runRoutine: (rid: string) => fetch(`/api/routines/${rid}/run`, { method: "POST" }),
  config: () =>
    fetch("/api/config").then(j<{ image: string; serverPort: number; vncHost: string }>),
  startComputer: () =>
    fetch("/api/computer/start", { method: "POST" }).then(j<{ computer: Computer }>),
  restartComputer: () =>
    fetch("/api/computer/restart", { method: "POST" }).then(j<{ computer: Computer }>),
  stopComputer: () =>
    fetch("/api/computer/stop", { method: "POST" }).then(j<{ computer: Computer }>),

  listGroups: () => fetch("/api/groups").then(j<{ groups: Group[] }>),
  createGroup: (name: string, botIds: string[], description?: string) =>
    fetch("/api/groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, botIds, description }),
    }).then(j<{ group: Group }>),
  updateGroup: (gid: string, input: { name?: string; description?: string; botIds?: string[] }) =>
    fetch(`/api/groups/${gid}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ group: Group; members: Bot[] }>),
  groupMessages: (gid: string) =>
    fetch(`/api/groups/${gid}/messages`).then(j<{ messages: GroupMessage[]; members: Bot[] }>),
  deleteGroup: (gid: string) => fetch(`/api/groups/${gid}`, { method: "DELETE" }),
  updateGroupModerator: (gid: string, input: GroupModeratorInput) =>
    fetch(`/api/groups/${gid}/moderator`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ group: Group }>),
  listProfiles: () => fetch("/api/models").then(j<{ profiles: ModelProfile[] }>),
  createProfile: (input: ProfileInput) =>
    fetch("/api/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ profile: ModelProfile }>),
  updateProfile: (pid: string, input: ProfileInput) =>
    fetch(`/api/models/${pid}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ profile: ModelProfile }>),
  setDefaultProfile: (pid: string) => fetch(`/api/models/${pid}/default`, { method: "POST" }),
  fetchModels: (baseUrl: string, apiKey: string, apiFormat: string) =>
    fetch("/api/models/fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl, apiKey, api: apiFormat }),
    }).then(j<{ ok: boolean; models: string[]; detail: string }>),
  testProfile: (pid: string) =>
    fetch(`/api/models/${pid}/test`, { method: "POST" }).then(j<{ ok: boolean; detail: string }>),
  deleteProfile: (pid: string) => fetch(`/api/models/${pid}`, { method: "DELETE" }),

  listSkills: () => fetch("/api/skills").then(j<{ skills: Skill[] }>),
  createSkill: (input: { name: string; description: string; content: string }) =>
    fetch("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ skill: Skill }>),
  updateSkill: (sid: string, input: { name: string; description: string; content: string }) =>
    fetch(`/api/skills/${sid}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ skill: Skill }>),
  deleteSkill: (sid: string) => fetch(`/api/skills/${sid}`, { method: "DELETE" }),

  search: (q: string) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}`).then(j<{ messages: SearchHit[] }>),
  duplicateBot: (id: string) =>
    fetch(`/api/bots/${id}/duplicate`, { method: "POST" }).then(j<{ bot: Bot }>),

  listMcpServers: () => fetch("/api/mcp").then(j<{ servers: McpServer[] }>),
  createMcpServer: (input: McpServerInput) =>
    fetch("/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ server: McpServer }>),
  updateMcpServer: (id: string, input: McpServerInput) =>
    fetch(`/api/mcp/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ server: McpServer }>),
  toggleMcpServer: (id: string, enabled: boolean) =>
    fetch(`/api/mcp/${id}/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
  deleteMcpServer: (id: string) => fetch(`/api/mcp/${id}`, { method: "DELETE" }),
  testMcpServer: (id: string) =>
    fetch(`/api/mcp/${id}/test`, { method: "POST" }).then(j<{ server: McpServer }>),

  listApprovalRules: () =>
    fetch("/api/approval-rules").then(j<{ rules: ApprovalRule[] }>),
  createApprovalRule: (input: ApprovalRuleInput) =>
    fetch("/api/approval-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).then(j<{ rule: ApprovalRule }>),
  deleteApprovalRule: (id: string) =>
    fetch(`/api/approval-rules/${id}`, { method: "DELETE" }),
};
