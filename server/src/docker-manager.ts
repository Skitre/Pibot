import Docker from "dockerode";
import { AppConfig, SCREEN_SLOT_COUNT } from "./config.js";

const docker = new Docker();

/** 最小 USTAR tar 打包：单文件，归属 uid/gid 1000（容器内 abc 用户） */
function buildTar(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 99), 0, "utf8");
  header.write("0000644\0", 100, "ascii"); // mode
  header.write("0001750\0", 108, "ascii"); // uid 1000 (octal)
  header.write("0001750\0", 116, "ascii"); // gid 1000
  header.write(data.length.toString(8).padStart(11, "0") + " ", 124, "ascii");
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + " ", 136, "ascii");
  header.write("        ", 148, "ascii"); // checksum 占位（全空格参与求和）
  header.write("0", 156, "ascii"); // typeflag: regular file
  header.write("ustar\0" + "00", 257, "ascii");
  header.write("abc", 265, "ascii"); // uname
  header.write("abc", 297, "ascii"); // gname
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");

  const padded = Math.ceil(data.length / 512) * 512;
  const body = Buffer.alloc(padded);
  data.copy(body);
  return Buffer.concat([header, body, Buffer.alloc(1024)]);
}

/** 从 tar 流中取出第一个普通文件的内容（跳过 pax 扩展头等） */
function extractTarFile(tar: Buffer): Buffer | null {
  let off = 0;
  while (off + 512 <= tar.length) {
    const name = tar.subarray(off, off + 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break; // 结尾零块
    const size = parseInt(tar.subarray(off + 124, off + 136).toString("ascii").trim(), 8) || 0;
    const type = tar[off + 156];
    const dataStart = off + 512;
    // '0' 或 NUL 都表示普通文件
    if (type === 0x30 || type === 0) {
      return tar.subarray(dataStart, dataStart + size);
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

// 共享电脑：整个账户一台容器。脑子在本机，这里只跑桌面 / 浏览器 / 文件。
const COMPUTER_NAME = "pibot-computer-shared";
const COMPUTER_VOLUME = "pibot-computer-data";

function slotPortBindings(vncBasePort: number) {
  const bindings: Record<string, Array<{ HostPort: string }>> = {
    "3000/tcp": [{ HostPort: String(vncBasePort) }],
  };
  const exposed: Record<string, object> = { "3000/tcp": {} };
  for (let i = 0; i < SCREEN_SLOT_COUNT; i++) {
    const container = `${3001 + i}/tcp`;
    bindings[container] = [{ HostPort: String(vncBasePort + 1 + i) }];
    exposed[container] = {};
  }
  return { bindings, exposed };
}

export class DockerManager {
  constructor(private cfg: AppConfig) {}

  async ensureImage(): Promise<boolean> {
    try {
      await docker.getImage(this.cfg.docker.image).inspect();
      return true;
    } catch {
      return false;
    }
  }

  async hasSlotPorts(containerId?: string): Promise<boolean> {
    const existing = await docker.listContainers({
      all: true,
      filters: { name: [COMPUTER_NAME] },
    });
    const id = containerId ?? existing[0]?.Id;
    if (!id) return false;
    const info = await docker.getContainer(id).inspect();
    return Boolean(info.HostConfig?.PortBindings?.["3001/tcp"]);
  }

  /** 找到（或创建）并启动共享电脑容器，返回其 id 与固定端口 */
  async ensureComputer(): Promise<{ containerId: string; vncPort: number; bridgePort: number }> {
    const vncPort = this.cfg.docker.vncBasePort;
    const bridgePort = this.cfg.docker.bridgeBasePort;
    const { bindings, exposed } = slotPortBindings(vncPort);

    const existing = await docker.listContainers({
      all: true,
      filters: { name: [COMPUTER_NAME] },
    });
    if (existing.length > 0) {
      const c = docker.getContainer(existing[0].Id);
      const info = await c.inspect();
      if (!info.HostConfig?.PortBindings?.["3001/tcp"]) {
        await c.remove({ force: true });
      } else {
        if (existing[0].State !== "running") await c.start();
        return { containerId: existing[0].Id, vncPort, bridgePort };
      }
    }

    const container = await docker.createContainer({
      Image: this.cfg.docker.image,
      name: COMPUTER_NAME,
      Env: [
        `PIBOT_WORKSPACE=/config/workspace`,
        `TZ=Asia/Shanghai`,
      ],
      Labels: { "pibot.computer": "1" },
      HostConfig: {
        Binds: [`${COMPUTER_VOLUME}:/config`],
        PortBindings: bindings,
        ShmSize: this.cfg.docker.shmSize,
        SecurityOpt: ["seccomp=unconfined"],
        RestartPolicy: { Name: "unless-stopped" },
      },
      ExposedPorts: exposed,
    });

    await container.start();
    return { containerId: container.id, vncPort, bridgePort };
  }

  /**
   * 重启已有共享电脑容器（同一 id / 卷，不重建）。
   * 容器还不存在时退化为 ensureComputer。
   */
  async restartComputer(): Promise<{ containerId: string; vncPort: number; bridgePort: number }> {
    const vncPort = this.cfg.docker.vncBasePort;
    const bridgePort = this.cfg.docker.bridgeBasePort;
    const existing = await docker.listContainers({
      all: true,
      filters: { name: [COMPUTER_NAME] },
    });
    if (existing.length === 0) return this.ensureComputer();

    const c = docker.getContainer(existing[0].Id);
    await c.restart({ t: 10 });
    return { containerId: existing[0].Id, vncPort, bridgePort };
  }

  /** 关掉共享电脑，不删容器和卷。下次 ensure 再 start。 */
  async stopComputer(): Promise<void> {
    const existing = await docker.listContainers({
      all: true,
      filters: { name: [COMPUTER_NAME] },
    });
    if (existing.length === 0) return;
    if (existing[0].State !== "running") return;
    await docker.getContainer(existing[0].Id).stop({ t: 8 });
  }

  async startContainer(containerId: string) {
    const c = docker.getContainer(containerId);
    const info = await c.inspect();
    if (!info.State.Running) await c.start();
  }

  async stopContainer(containerId: string) {
    try {
      await docker.getContainer(containerId).stop({ t: 5 });
    } catch {
      // already stopped
    }
  }

  /** 迁移用：删除旧架构的 per-Bot 容器与卷 */
  async removeLegacyContainer(containerId: string, botId: string) {
    try {
      await docker.getContainer(containerId).remove({ force: true });
    } catch {
      // noop
    }
    try {
      await docker.getVolume(`pibot-${botId}`).remove({ force: true } as any);
    } catch {
      // noop
    }
  }

  async isRunning(containerId: string | null): Promise<boolean> {
    if (!containerId) return false;
    try {
      const info = await docker.getContainer(containerId).inspect();
      return info.State.Running;
    } catch {
      return false;
    }
  }

  // ---------- 容器内文件读写（附件上传、AGENTS.md 记忆等） ----------

  /** 在容器里执行命令，可选地经 stdin 喂数据，返回退出码与输出 */
  /** 看共享电脑在不在，不 start。 */
  async inspectComputer(): Promise<{
    containerId: string;
    running: boolean;
    vncPort: number;
    bridgePort: number;
  } | null> {
    const existing = await docker.listContainers({
      all: true,
      filters: { name: [COMPUTER_NAME] },
    });
    if (existing.length === 0) return null;
    return {
      containerId: existing[0].Id,
      running: existing[0].State === "running",
      vncPort: this.cfg.docker.vncBasePort,
      bridgePort: this.cfg.docker.bridgeBasePort,
    };
  }

  async exec(
    containerId: string,
    cmd: string[],
    opts: { input?: Buffer; env?: string[]; cwd?: string } = {},
  ): Promise<{ exitCode: number; stdout: Buffer; stderr: string }> {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      Env: opts.env,
      WorkingDir: opts.cwd,
      AttachStdin: !!opts.input,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: !!opts.input });

    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const { PassThrough } = await import("node:stream");
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on("data", (c: Buffer) => out.push(c));
    stderr.on("data", (c: Buffer) => err.push(c));
    container.modem.demuxStream(stream, stdout, stderr);

    if (opts.input) stream.write(opts.input);
    stream.end();
    await new Promise<void>((resolve) => stream.on("end", resolve));

    // 流关闭后 ExitCode 可能尚未落盘，轮询直到 exec 真正结束
    let info = await exec.inspect();
    for (let i = 0; i < 50 && (info.Running || info.ExitCode === null); i++) {
      await new Promise((r) => setTimeout(r, 100));
      info = await exec.inspect();
    }
    return {
      exitCode: info.ExitCode ?? -1,
      stdout: Buffer.concat(out),
      stderr: Buffer.concat(err).toString("utf8"),
    };
  }

  /**
   * 写文件到容器。用 putArchive（tar 上传）而不是 exec stdin：
   * Windows npipe 下 exec 的 stdin 半关闭不可靠，会静默丢数据截断文件。
   */
  async writeFile(containerId: string, path: string, data: Buffer): Promise<void> {
    const idx = path.lastIndexOf("/");
    const dir = path.slice(0, idx) || "/";
    const name = path.slice(idx + 1);
    const mk = await this.exec(containerId, ["mkdir", "-p", dir]);
    if (mk.exitCode !== 0) throw new Error(`mkdir ${dir} failed: ${mk.stderr || mk.exitCode}`);
    await docker
      .getContainer(containerId)
      .putArchive(buildTar(name, data), { path: dir });
    // tar 头里已带 uid/gid=1000（abc），无需再 chown；回读校验字节数
    const written = await this.readFile(containerId, path);
    if (!written || written.length !== data.length)
      throw new Error(
        `write ${path} verification failed: ${written?.length ?? "null"} != ${data.length} bytes`,
      );
  }

  /** 删除容器内目录/文件（删除 Bot 时清理其私有目录） */
  async removePath(containerId: string, path: string): Promise<void> {
    if (!path.startsWith("/config/bots/")) throw new Error(`refusing to remove ${path}`);
    const r = await this.exec(containerId, ["rm", "-rf", path]);
    if (r.exitCode !== 0) throw new Error(`rm ${path} failed: ${r.stderr || r.exitCode}`);
  }

  /** 取容器内文件字节数，不存在或失败返回 null */
  async statFile(containerId: string, path: string): Promise<number | null> {
    const r = await this.exec(containerId, ["stat", "-c", "%s", path]);
    if (r.exitCode !== 0) return null;
    const n = parseInt(r.stdout.toString("utf8").trim(), 10);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * 从容器读文件，不存在返回 null。
   * 用 getArchive（tar 下载）而不是 exec stdout：npipe 下 exec 输出偶发丢帧。
   */
  async readFile(containerId: string, path: string): Promise<Buffer | null> {
    let stream: NodeJS.ReadableStream;
    try {
      stream = await docker.getContainer(containerId).getArchive({ path });
    } catch {
      return null;
    }
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    return extractTarFile(Buffer.concat(chunks));
  }
}
