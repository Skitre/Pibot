import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DockerManager } from "./docker-manager.js";

const SERVICE_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../bot-image/opt/pibot/computer-service.mjs");
const SERVICE_DEST = "/opt/pibot/computer-service.mjs";
const SERVICE_URL = "http://127.0.0.1:8792";

export type ComputerAccessState = {
  containerId: string | null;
  status: "offline" | "starting" | "online";
};

export type ComputerServiceResult = {
  ok?: boolean;
  isError?: boolean;
  text?: string;
  snapshot?: string;
  image?: { data: string; mimeType?: string };
  error?: string;
  slots?: Record<string, number>;
  slotCount?: number;
};

/** 电脑类工具失败时抛给模型看的文案。不要报 Bot offline。 */
export class ComputerOfflineError extends Error {
  readonly status: ComputerAccessState["status"];

  constructor(status: ComputerAccessState["status"], message: string) {
    super(message);
    this.name = "ComputerOfflineError";
    this.status = status;
  }
}

const OFFLINE_MSG =
  "The computer is offline. Tell the user in visible text that the computer is offline. Do not exec, read, write, screenshot, or open the browser.";
const STARTING_MSG =
  "The computer is still starting. Tell the user in visible text that the computer is not ready yet. Do not retry exec.";

function assertConfigPath(path: string) {
  if (!path.startsWith("/config/")) {
    throw new Error(`refusing path outside /config: ${path}`);
  }
}

/**
 * 共享电脑的宿主入口。脑子和 MCP 在本机；文件/exec/浏览器/截屏只打进容器。
 * 浏览器走容器内 127.0.0.1:8792 薄服务，不映射 9222。
 */
export class ComputerAccess {
  private ensuringService: Promise<void> | null = null;

  constructor(
    private docker: DockerManager,
    private getState: () => ComputerAccessState,
  ) {}

  status(): ComputerAccessState {
    return this.getState();
  }

  /** 在线则返回 containerId，否则抛 ComputerOfflineError（文案给模型）。 */
  async assertOnline(): Promise<string> {
    const state = this.getState();
    if (state.status === "starting") {
      throw new ComputerOfflineError("starting", STARTING_MSG);
    }
    if (state.status !== "online" || !state.containerId) {
      throw new ComputerOfflineError(state.status === "offline" ? "offline" : state.status, OFFLINE_MSG);
    }
    if (!(await this.docker.isRunning(state.containerId))) {
      throw new ComputerOfflineError("offline", OFFLINE_MSG);
    }
    return state.containerId;
  }

  async exec(
    cmd: string[],
    opts: { input?: Buffer; env?: string[]; cwd?: string } = {},
  ): Promise<{ exitCode: number; stdout: Buffer; stderr: string }> {
    const cid = await this.assertOnline();
    return this.docker.exec(cid, cmd, opts);
  }

  async mkdir(path: string): Promise<void> {
    assertConfigPath(path);
    const result = await this.exec(["mkdir", "-p", path]);
    if (result.exitCode !== 0) throw new Error(result.stderr || `mkdir ${path} failed`);
  }

  async readFile(path: string): Promise<Buffer | null> {
    assertConfigPath(path);
    const cid = await this.assertOnline();
    return this.docker.readFile(cid, path);
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    assertConfigPath(path);
    const cid = await this.assertOnline();
    return this.docker.writeFile(cid, path, data);
  }

  async statFile(path: string): Promise<number | null> {
    assertConfigPath(path);
    const cid = await this.assertOnline();
    return this.docker.statFile(cid, path);
  }

  /**
   * 调容器内薄服务。请求/响应当文件走，避开 Windows npipe 对大截图的截断。
   */
  async service(path: string, body: unknown = {}, timeoutSec = 60): Promise<ComputerServiceResult> {
    const cid = await this.assertOnline();
    await this.ensureService();
    const id = randomUUID().slice(0, 8);
    const reqPath = `/config/.pibot/req-${id}.json`;
    const resPath = `/config/.pibot/res-${id}.json`;
    await this.docker.writeFile(cid, reqPath, Buffer.from(JSON.stringify(body ?? {}), "utf8"));
    const result = await this.docker.exec(cid, [
      "curl",
      "-sS",
      "-m",
      String(timeoutSec),
      "-X",
      "POST",
      "-H",
      "content-type: application/json",
      "--data-binary",
      `@${reqPath}`,
      "-o",
      resPath,
      "-w",
      "%{http_code}",
      `${SERVICE_URL}${path}`,
    ]);
    const raw = await this.docker.readFile(cid, resPath);
    void this.docker.exec(cid, ["rm", "-f", reqPath, resPath]).catch(() => undefined);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `computer service ${path} failed (${result.exitCode})`);
    }
    if (!raw?.length) throw new Error(`computer service ${path} returned empty`);
    let parsed: ComputerServiceResult;
    try {
      parsed = JSON.parse(raw.toString("utf8")) as ComputerServiceResult;
    } catch {
      throw new Error(`computer service ${path} returned non-JSON: ${raw.toString("utf8").slice(0, 200)}`);
    }
    const httpCode = result.stdout.toString("utf8").trim();
    if (httpCode && httpCode !== "200" && !parsed.text) {
      throw new Error(parsed.error || `computer service HTTP ${httpCode}`);
    }
    return parsed;
  }

  async ensureService(): Promise<void> {
    if (this.ensuringService) return this.ensuringService;
    this.ensuringService = this.doEnsureService().finally(() => {
      this.ensuringService = null;
    });
    return this.ensuringService;
  }

  private async doEnsureService(): Promise<void> {
    const cid = await this.assertOnline();
    if (await this.serviceHealthy(cid)) return;
    if (!existsSync(SERVICE_SRC)) throw new Error(`missing ${SERVICE_SRC}`);
    await this.docker.writeFile(cid, SERVICE_DEST, readFileSync(SERVICE_SRC));
    await this.docker.exec(cid, [
      "bash",
      "-lc",
      "fuser -k 8792/tcp >/dev/null 2>&1 || true; " +
        "setsid env DISPLAY=:1 HOME=/config /usr/bin/node /opt/pibot/computer-service.mjs " +
        ">/tmp/pibot-computer.log 2>&1 < /dev/null & echo started",
    ]);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await this.serviceHealthy(cid)) return;
    }
    const log = await this.docker.exec(cid, ["bash", "-lc", "tail -n 40 /tmp/pibot-computer.log || true"]);
    throw new Error(`computer service did not start: ${log.stdout.toString("utf8") || log.stderr}`);
  }

  private async serviceHealthy(containerId: string): Promise<boolean> {
    const result = await this.docker.exec(containerId, [
      "curl",
      "-sS",
      "-m",
      "2",
      `${SERVICE_URL}/health`,
    ]);
    if (result.exitCode !== 0) return false;
    try {
      const body = JSON.parse(result.stdout.toString("utf8"));
      return body?.ok === true;
    } catch {
      return false;
    }
  }
}
