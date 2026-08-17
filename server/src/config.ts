import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

export interface RelayConfig {
  baseUrl: string;
  apiKey: string;
  api: "anthropic-messages" | "openai-completions" | "openai-responses";
  modelId: string;
  modelName: string;
  reasoning: boolean;
  thinking: string;
  contextWindow: number;
  maxTokens: number;
}

export interface DockerConfig {
  image: string;
  vncBasePort: number;
  bridgeBasePort: number;
  shmSize: number;
}

/** 与 bot-image/opt/pibot/desktop/screens.env 的 PIBOT_SLOT_COUNT 对齐 */
export const SCREEN_SLOT_COUNT = 6;

export interface AppConfig {
  relay: RelayConfig;
  docker: DockerConfig;
  port: number;
}

const defaults: AppConfig = {
  relay: {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    api: "openai-completions",
    modelId: "gpt-4o",
    modelName: "GPT-4o",
    reasoning: false,
    thinking: "off",
    contextWindow: 200000,
    maxTokens: 8192,
  },
  docker: {
    image: "pibot-computer:latest",
    vncBasePort: 3100,
    bridgeBasePort: 8900,
    shmSize: 1024 * 1024 * 1024,
  },
  port: 8790,
};

export function loadConfig(): AppConfig {
  const file = join(root, "config.json");
  if (!existsSync(file)) {
    console.warn("[config] config.json not found; using defaults (relay apiKey empty).");
    return defaults;
  }
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return {
    relay: { ...defaults.relay, ...raw.relay },
    docker: { ...defaults.docker, ...raw.docker },
    port: raw.port ?? defaults.port,
  };
}

export const DATA_DIR = join(root, "data");
