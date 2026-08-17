#!/usr/bin/env node
// Pibot 一键启动：环境检测 → 依赖/前端构建 → 单端口启动（UI / API / WS 同在 :8790）
// 开发模式仍可用 npm run dev + npm run dev:web（vite 5190 代理到 8790）。
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ok = (msg) => console.log(`  [ok] ${msg}`);
const warn = (msg) => console.log(`  [!!] ${msg}`);

function npmInvocation(args) {
  // npm start 会提供 npm_execpath；直接用 Node 执行 npm CLI，可以保留参数边界且无需 shell。
  const npmCli = process.env.npm_execpath;
  if (npmCli && existsSync(npmCli)) {
    return { command: process.execPath, args: [npmCli, ...args] };
  }

  const bundledNpmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(bundledNpmCli)) {
    return { command: process.execPath, args: [bundledNpmCli, ...args] };
  }

  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args],
    };
  }
  return { command: "npm", args };
}

function runNpm(args, options = {}) {
  const invocation = npmInvocation(args);
  return spawnSync(invocation.command, invocation.args, {
    cwd: root,
    windowsHide: true,
    ...options,
  });
}

function dependencyFingerprint() {
  const hash = createHash("sha256");
  const lockfile = join(root, "package-lock.json");
  if (existsSync(lockfile)) hash.update(readFileSync(lockfile));

  // 只跟踪会影响安装结果的字段；改 description/scripts 不应触发 npm install。
  const installFields = [
    "workspaces",
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "overrides",
    "engines",
    "os",
    "cpu",
    "allowScripts",
  ];
  const manifests = ["package.json", join("server", "package.json"), join("web", "package.json")];
  for (const relativePath of manifests) {
    const file = join(root, relativePath);
    if (existsSync(file)) {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      const installConfig = Object.fromEntries(
        installFields.filter((field) => field in manifest).map((field) => [field, manifest[field]]),
      );
      hash.update(relativePath);
      hash.update(JSON.stringify(installConfig));
    }
  }
  return hash.digest("hex");
}

function portInUse(port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (inUse, sock) => {
      if (settled) return;
      settled = true;
      sock?.destroy();
      resolve(inUse);
    };
    try {
      const sock = createConnection({ host: "127.0.0.1", port }, () => finish(true, sock));
      sock.setTimeout(1_000, () => finish(false, sock));
      sock.once("error", () => finish(false, sock));
    } catch {
      resolve(false);
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("\nPibot 启动器\n============\n");

  // 1. Node 版本（SDK 需要 ≥ 20）
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    console.error(`  [xx] Node ${process.versions.node} 过低，需要 >= 20`);
    process.exit(1);
  }
  ok(`Node ${process.versions.node}`);

  // 2. 依赖：目录存在不代表依赖与当前 lockfile 一致。
  const nodeModules = join(root, "node_modules");
  const dependencyStamp = join(nodeModules, ".pibot-dependencies");
  const fingerprint = dependencyFingerprint();
  let stampedFingerprint = "";
  try {
    stampedFingerprint = readFileSync(dependencyStamp, "utf8").trim();
  } catch {
    // 首次启动或旧版本没有写入过指纹。
  }
  const dependencyTreeOk = existsSync(nodeModules)
    && stampedFingerprint === fingerprint
    && runNpm(["ls", "--workspaces", "--include-workspace-root", "--depth=0"], {
      stdio: "ignore",
      timeout: 30_000,
    }).status === 0;
  if (!dependencyTreeOk) {
    console.log("  ..  安装/更新依赖（首次运行可能需要几分钟）");
    const r = runNpm(["install"], { stdio: "inherit" });
    if (r.error || r.status !== 0) {
      console.error(`  [xx] npm install 失败${r.error ? `：${r.error.message}` : ""}`);
      process.exit(1);
    }
    try {
      writeFileSync(dependencyStamp, `${dependencyFingerprint()}\n`);
    } catch (err) {
      warn(`无法保存依赖状态，下次启动会重新检查：${err.message}`);
    }
  }
  ok("依赖已安装");

  // 3. 模型中转配置（缺失不致命：服务能起，但 Bot 连不上模型）
  const configPath = join(root, "server", "config.json");
  let config = {};
  if (!existsSync(configPath)) {
    warn("server/config.json 不存在（用默认空配置启动）。复制 server/config.example.json 为 config.json 并填入中转地址/密钥。");
  } else {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
      if (config === null || Array.isArray(config) || typeof config !== "object") {
        throw new Error("顶层必须是 JSON 对象");
      }
    } catch (err) {
      console.error(`  [xx] server/config.json 无效：${err.message}`);
      process.exit(1);
    }
    ok("server/config.json 已配置");
  }
  const port = config?.port ?? 8790;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    console.error("  [xx] server/config.json 中的 port 必须是 1-65535 之间的整数");
    process.exit(1);
  }
  const imageName = config?.docker?.image ?? "pibot-computer:latest";
  if (typeof imageName !== "string" || imageName.trim() === "") {
    console.error("  [xx] server/config.json 中的 docker.image 必须是非空字符串");
    process.exit(1);
  }

  // 4. Docker（共享电脑）。不在也不挡启动：UI 会显示电脑离线，可稍后再开
  const dockerOk = spawnSync("docker", ["info"], {
    cwd: root,
    stdio: "ignore",
    timeout: 10_000,
    windowsHide: true,
  }).status === 0;
  if (dockerOk) {
    ok("Docker 已运行");
    if (spawnSync("docker", ["image", "inspect", imageName], {
      cwd: root,
      stdio: "ignore",
      timeout: 10_000,
      windowsHide: true,
    }).status !== 0) {
      warn(`镜像 ${imageName} 不存在，先构建：npm run image`);
    } else {
      ok(`镜像 ${imageName} 已就绪`);
    }
  } else {
    warn("Docker 未运行：以「电脑离线」模式启动，桌面/浏览器工具不可用。启动 Docker Desktop 后在 UI 里点重试即可。");
  }

  // 5. 每次重建，避免拉取新代码后继续提供旧的 web/dist。
  console.log("  ..  构建前端");
  const build = runNpm(["run", "build", "--workspace", "web"], { stdio: "inherit" });
  if (build.error || build.status !== 0) {
    console.error(`  [xx] 前端构建失败${build.error ? `：${build.error.message}` : ""}`);
    process.exit(1);
  }
  if (!existsSync(join(root, "web", "dist", "index.html"))) {
    console.error("  [xx] 前端构建完成，但 web/dist/index.html 不存在");
    process.exit(1);
  }
  ok("前端已构建");

  // 6. 端口占用
  if (await portInUse(port)) {
    console.error(`  [xx] 端口 ${port} 已被占用：服务是否已经在跑？先停掉旧进程再启动。`);
    process.exit(1);
  }

  // 7. 启动
  console.log(`\n  ..  启动服务 http://localhost:${port}（Ctrl+C 停止）\n`);
  const serverCommand = npmInvocation(["run", "start", "--workspace", "server"]);
  const child = spawn(serverCommand.command, serverCommand.args, {
    cwd: root,
    detached: process.platform !== "win32",
    stdio: "inherit",
    windowsHide: false,
  });
  let requestedExitCode = null;
  const stop = (signal) => {
    if (!child.pid || child.exitCode !== null) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-child.pid, signal);
      } catch (err) {
        if (err.code !== "ESRCH") warn(`停止服务失败：${err.message}`);
      }
    }
  };
  const handleSignal = (signal, exitCode) => {
    requestedExitCode = exitCode;
    stop(signal);
    const forceExit = setTimeout(() => process.exit(exitCode), 5_000);
    forceExit.unref();
  };
  process.once("SIGINT", () => handleSignal("SIGINT", 130));
  process.once("SIGTERM", () => handleSignal("SIGTERM", 143));
  child.once("error", (err) => {
    console.error(`  [xx] 服务进程启动失败：${err.message}`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => {
    if (requestedExitCode !== null) process.exit(requestedExitCode);
    if (code !== null) process.exit(code);
    console.error(`  [xx] 服务进程被信号 ${signal ?? "unknown"} 终止`);
    process.exit(1);
  });

  // 8. 等就绪后打开浏览器
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) process.exit(child.exitCode ?? 1);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/bots`);
      if (res.ok) {
        const url = `http://localhost:${port}`;
        const browser = process.platform === "win32"
          ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "start", "", url], {
            windowsHide: true, detached: true, stdio: "ignore",
          })
          : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
            detached: true, stdio: "ignore",
          });
        browser.once("error", (err) => warn(`无法自动打开浏览器：${err.message}`));
        browser.unref();
        break;
      }
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(500);
  }
}

main().catch((err) => {
  console.error(`  [xx] 启动器异常：${err.stack ?? err.message}`);
  process.exit(1);
});
