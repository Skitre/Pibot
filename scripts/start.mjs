#!/usr/bin/env node
// Pibot 一键启动：环境检测 → 依赖/前端构建 → 单端口启动（UI / API / WS 同在 :8790）
// 开发模式仍可用 npm run dev + npm run dev:web（vite 5190 代理到 8790）。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ok = (msg) => console.log(`  [ok] ${msg}`);
const warn = (msg) => console.log(`  [!!] ${msg}`);

function sh(cmd, args) {
  // Windows 上 npm/docker 是 .cmd，统一走 shell 免得 spawn ENOENT
  return spawnSync(cmd + " " + args.join(" "), { shell: true, encoding: "utf8", cwd: root });
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
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

  // 2. 依赖
  if (!existsSync(join(root, "node_modules"))) {
    console.log("  ..  首次安装依赖（几分钟）");
    const r = sh("npm", ["install"]);
    if (r.status !== 0) {
      console.error(`  [xx] npm install 失败\n${r.stderr}`);
      process.exit(1);
    }
  }
  ok("依赖已安装");

  // 3. 模型中转配置（缺失不致命：服务能起，但 Bot 连不上模型）
  if (!existsSync(join(root, "server", "config.json"))) {
    warn("server/config.json 不存在（用默认空配置启动）。复制 server/config.example.json 为 config.json 并填入中转地址/密钥。");
  } else {
    ok("server/config.json 已配置");
  }

  // 4. Docker（共享电脑）。不在也不挡启动：UI 会显示电脑离线，可稍后再开
  const config = (() => {
    try {
      return JSON.parse(readFileSync(join(root, "server", "config.json"), "utf8"));
    } catch {
      return {};
    }
  })();
  const dockerOk = sh("docker", ["info"]).status === 0;
  if (dockerOk) {
    ok("Docker 已运行");
    const imageName = config?.docker?.image ?? "pibot-computer:latest";
    if (sh("docker", ["image", "inspect", imageName]).status !== 0) {
      warn(`镜像 ${imageName} 不存在，先构建：npm run image`);
    } else {
      ok(`镜像 ${imageName} 已就绪`);
    }
  } else {
    warn("Docker 未运行：以「电脑离线」模式启动，桌面/浏览器工具不可用。启动 Docker Desktop 后在 UI 里点重试即可。");
  }

  // 5. 前端构建产物
  if (!existsSync(join(root, "web", "dist", "index.html"))) {
    console.log("  ..  构建前端（web/dist 不存在）");
    const r = sh("npm", ["run", "build", "--workspace", "web"]);
    if (r.status !== 0) {
      console.error(`  [xx] 前端构建失败\n${r.stderr}`);
      process.exit(1);
    }
  }
  ok("前端已构建");

  // 6. 端口占用
  const port = config?.port ?? 8790;
  if (await portInUse(port)) {
    console.error(`  [xx] 端口 ${port} 已被占用：服务是否已经在跑？先停掉旧进程再启动。`);
    process.exit(1);
  }

  // 7. 启动
  console.log(`\n  ..  启动服务 http://localhost:${port}（Ctrl+C 停止）\n`);
  const child = spawn("npm run start --workspace server", { shell: true, stdio: "inherit", cwd: root });
  const stop = () => {
    if (process.platform === "win32") spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true });
    else child.kill("SIGTERM");
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  child.on("exit", (code) => process.exit(code ?? 0));

  // 8. 等就绪后打开浏览器
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) process.exit(child.exitCode ?? 1);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/bots`);
      if (res.ok) {
        const open = process.platform === "win32" ? `start "" http://localhost:${port}`
          : process.platform === "darwin" ? `open http://localhost:${port}`
          : `xdg-open http://localhost:${port}`;
        spawn(open, { shell: true, detached: true, stdio: "ignore" });
        break;
      }
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(500);
  }
}

main();
