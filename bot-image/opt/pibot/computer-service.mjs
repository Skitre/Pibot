// 共享电脑薄服务：浏览器（容器内 CDP）+ 桌面截屏。只听 127.0.0.1，不映射 9222。
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";

const PORT = Number(process.env.PIBOT_COMPUTER_PORT || 8792);
const CDP_URL = process.env.PIBOT_CDP_URL || "http://127.0.0.1:9222";

let browserCtx = null;
const pages = new Map();

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function botKey(body) {
  return String(body.botId || "default");
}

async function connectCdp(timeout) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout });
  browserCtx = browser.contexts()[0] ?? (await browser.newContext());
  browser.on("disconnected", () => {
    browserCtx = null;
    pages.clear();
  });
}

function launchChromium() {
  const child = execFile("/opt/pibot/bin/start-chromium.sh", [], {
    env: { ...process.env, DISPLAY: ":1", HOME: "/config" },
  });
  child.unref();
}

async function getPage(botId) {
  if (!browserCtx) {
    try {
      await connectCdp(5000);
    } catch {
      launchChromium();
      await new Promise((r) => setTimeout(r, 5000));
      await connectCdp(15000);
    }
  }
  const existing = pages.get(botId);
  if (existing && !existing.isClosed()) return existing;
  const open = browserCtx.pages();
  const taken = new Set([...pages.values()].map((p) => p).filter((p) => p && !p.isClosed()));
  const blank = open.find(
    (p) =>
      !taken.has(p) && (p.url() === "about:blank" || p.url() === "chrome://new-tab-page/"),
  );
  const page = blank ?? (await browserCtx.newPage());
  page.on("close", () => {
    if (pages.get(botId) === page) pages.delete(botId);
  });
  pages.set(botId, page);
  return page;
}

async function textSnapshot(page) {
  const data = await page.evaluate(() => {
    const clickables = Array.from(
      document.querySelectorAll("a, button, [role=button], input, select, textarea"),
    )
      .filter((el) => el.offsetParent !== null)
      .slice(0, 60)
      .map((el, i) => {
        const label = (
          el.innerText ||
          el.value ||
          el.placeholder ||
          el.getAttribute("aria-label") ||
          ""
        )
          .trim()
          .slice(0, 60);
        return `[${i}] <${el.tagName.toLowerCase()}> ${label}`;
      });
    return { text: (document.body?.innerText ?? "").slice(0, 3500), clickables };
  });
  return `Title: ${await page.title()}\nURL: ${page.url()}\n\n--- Visible text ---\n${data.text}\n\n--- Interactive elements ---\n${data.clickables.join("\n")}`;
}

async function shot(page) {
  const buf = await page.screenshot({ type: "png" });
  return { data: buf.toString("base64"), mimeType: "image/png" };
}

async function handleNavigate(body) {
  if (!body.url) return { ok: false, isError: true, text: "url is required" };
  const page = await getPage(botKey(body));
  await page.goto(body.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(800);
  const snapshot = await textSnapshot(page);
  const header = `Opened: ${await page.title()} — ${page.url()}`;
  return {
    ok: true,
    text: body.screenshot ? header : `${header}\n\n${snapshot}`,
    snapshot,
    image: body.screenshot ? await shot(page) : undefined,
  };
}

async function handleRead(body) {
  const page = await getPage(botKey(body));
  const data = await page.evaluate(() => {
    const clickables = Array.from(
      document.querySelectorAll("a, button, [role=button], input[type=submit]"),
    )
      .filter((el) => el.offsetParent !== null)
      .slice(0, 80)
      .map((el, i) => {
        const label = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 80);
        return `[${i}] <${el.tagName.toLowerCase()}> ${label}`;
      });
    return { text: (document.body?.innerText ?? "").slice(0, 6000), clickables };
  });
  return {
    ok: true,
    text: `Title: ${await page.title()}\nURL: ${page.url()}\n\n--- Page text ---\n${data.text}\n\n--- Clickables ---\n${data.clickables.join("\n")}`,
  };
}

async function handleClick(body) {
  const page = await getPage(botKey(body));
  if (body.selector) await page.click(body.selector, { timeout: 10000 });
  else if (body.text) await page.getByText(body.text, { exact: false }).first().click({ timeout: 10000 });
  else return { ok: false, isError: true, text: "Provide selector or text." };
  await page.waitForTimeout(1000);
  const snapshot = await textSnapshot(page);
  const header = `Clicked. Now at: ${page.url()}`;
  return {
    ok: true,
    text: body.screenshot ? header : `${header}\n\n${snapshot}`,
    snapshot,
    image: body.screenshot ? await shot(page) : undefined,
  };
}

async function handleType(body) {
  const page = await getPage(botKey(body));
  let locator;
  if (body.selector) locator = page.locator(body.selector).first();
  else if (body.label) locator = page.getByPlaceholder(body.label).or(page.getByLabel(body.label)).first();
  else return { ok: false, isError: true, text: "Provide selector or label." };
  await locator.fill(String(body.value ?? ""), { timeout: 10000 });
  if (body.submit) await locator.press("Enter");
  await page.waitForTimeout(800);
  const snapshot = await textSnapshot(page);
  const header = `Typed into input. URL: ${page.url()}`;
  return {
    ok: true,
    text: body.screenshot ? header : `${header}\n\n${snapshot}`,
    snapshot,
    image: body.screenshot ? await shot(page) : undefined,
  };
}

async function handleBrowserScreenshot(body) {
  const page = await getPage(botKey(body));
  const snapshot = await textSnapshot(page);
  return {
    ok: true,
    text: `URL: ${page.url()}`,
    snapshot,
    image: await shot(page),
  };
}

function execFileAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function handleDesktopScreenshot() {
  const file = `/tmp/pibot-screen-${Date.now()}.png`;
  await execFileAsync("scrot", ["-o", file], { env: { ...process.env, DISPLAY: ":1" } });
  try {
    const data = readFileSync(file).toString("base64");
    return { ok: true, text: "Desktop screenshot:", image: { data, mimeType: "image/png" } };
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

const routes = {
  "/browser/navigate": handleNavigate,
  "/browser/read": handleRead,
  "/browser/click": handleClick,
  "/browser/type": handleType,
  "/browser/screenshot": handleBrowserScreenshot,
  "/desktop/screenshot": handleDesktopScreenshot,
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, service: "pibot-computer" });
      return;
    }
    if (req.method !== "POST") {
      json(res, 405, { ok: false, isError: true, text: "method not allowed" });
      return;
    }
    const handler = routes[url.pathname];
    if (!handler) {
      json(res, 404, { ok: false, isError: true, text: "not found" });
      return;
    }
    const body = await readBody(req);
    json(res, 200, await handler(body));
  } catch (err) {
    json(res, 200, { ok: false, isError: true, text: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[pibot-computer] listening on 127.0.0.1:${PORT}`);
});
