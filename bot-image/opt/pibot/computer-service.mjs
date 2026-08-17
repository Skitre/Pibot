// 共享电脑薄服务：每个 Bot 一块独立屏上的浏览器（容器内 CDP）+ 该屏截图。只听 127.0.0.1，不映射 9222。
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const PORT = Number(process.env.PIBOT_COMPUTER_PORT || 8792);
const SLOT_FILE = "/config/.pibot/screen-slots.json";

const browsers = new Map();
const contexts = new Map();
const pages = new Map();
const slotGates = new Map();
const botGates = new Map();

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

function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

const screenEnv = readEnvFile("/opt/pibot/desktop/screens.env");
const SLOT_W = Number(screenEnv.PIBOT_SLOT_W || 1600);
const SLOT_H = Number(screenEnv.PIBOT_SLOT_H || 900);
const SLOT_COUNT = Number(screenEnv.PIBOT_SLOT_COUNT || 6);
const PANEL_H = Number(screenEnv.PIBOT_PANEL_H || 56);

function slotRect(index) {
  const i = ((Number(index) % SLOT_COUNT) + SLOT_COUNT) % SLOT_COUNT;
  return {
    slot: i,
    display: `:${1 + i}`,
    cdp: `http://127.0.0.1:${9222 + i}`,
    x: 0,
    y: 0,
    w: SLOT_W,
    h: SLOT_H,
    winH: SLOT_H - PANEL_H,
  };
}

function loadSlots() {
  try {
    const raw = JSON.parse(readFileSync(SLOT_FILE, "utf8"));
    if (raw && typeof raw === "object" && raw.slots && typeof raw.slots === "object") return raw.slots;
  } catch {
    // first run
  }
  return {};
}

function saveSlots(slots) {
  mkdirSync("/config/.pibot", { recursive: true });
  writeFileSync(SLOT_FILE, JSON.stringify({ slots }, null, 2));
}

function assignSlot(botId) {
  const slots = loadSlots();
  if (Number.isInteger(slots[botId])) return slotRect(slots[botId]);
  const used = new Set(Object.values(slots).map((n) => Number(n)));
  let next = 0;
  while (used.has(next) && next < SLOT_COUNT) next += 1;
  if (next >= SLOT_COUNT) next = Object.keys(slots).length % SLOT_COUNT;
  slots[botId] = next;
  saveSlots(slots);
  return slotRect(next);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withSlotGate(slot, fn) {
  const prev = slotGates.get(slot) || Promise.resolve();
  const run = prev.then(fn, fn);
  slotGates.set(
    slot,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

function withBotGate(botId, fn) {
  const prev = botGates.get(botId) || Promise.resolve();
  const run = prev.then(fn, fn);
  botGates.set(
    botId,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

function screenState() {
  return { ok: true, text: "screens", slots: loadSlots(), slotCount: SLOT_COUNT };
}

function handleClaimScreens(body) {
  const ids = Array.isArray(body.botIds)
    ? body.botIds
    : body.botId
      ? [body.botId]
      : [];
  for (const id of ids) {
    if (id) assignSlot(String(id));
  }
  execFile("/opt/pibot/bin/compose-wallpapers.sh", [], { env: { ...process.env, HOME: "/config" } }, () => {});
  return screenState();
}

function dropBrowser(slot, browser) {
  if (browsers.get(slot) === browser) {
    browsers.delete(slot);
    contexts.delete(slot);
  }
  const ctx = browser.contexts()[0];
  for (const [id, page] of pages) {
    if (ctx && page.context() === ctx) pages.delete(id);
  }
}

async function connectCdp(slot, timeout) {
  const rect = slotRect(slot);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(rect.cdp, { timeout });
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  browsers.set(slot, browser);
  contexts.set(slot, ctx);
  browser.on("disconnected", () => dropBrowser(slot, browser));
}

function launchChromium(slot) {
  const child = execFile("/opt/pibot/bin/start-chromium.sh", [String(slot)], {
    env: { ...process.env, DISPLAY: slotRect(slot).display, HOME: "/config" },
  });
  child.unref();
}

async function windowIdFor(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    return windowId;
  } finally {
    await session.detach().catch(() => {});
  }
}

async function placeWindow(page, botId) {
  const rect = assignSlot(botId);
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { left: 0, top: 0, width: rect.w, height: rect.winH, windowState: "normal" },
    });
  } finally {
    await session.detach().catch(() => {});
  }
  return rect;
}

async function newBotWindow(ctx) {
  const donor = ctx.pages().find((p) => !p.isClosed());
  if (!donor) throw new Error("Chromium has no window to attach to");
  const before = new Set(ctx.pages());
  let opened = false;
  try {
    const session = await ctx.newCDPSession(donor);
    await session.send("Target.createTarget", { url: "about:blank", newWindow: true });
    await session.detach().catch(() => {});
    opened = true;
  } catch {
    opened = false;
  }
  if (!opened) {
    await Promise.all([
      ctx.waitForEvent("page", { timeout: 8000 }),
      donor.evaluate(() => {
        window.open("about:blank", "_blank", "popup=yes,noopener=yes");
      }),
    ]);
  }
  for (let i = 0; i < 50; i++) {
    const found = ctx.pages().find((p) => !before.has(p) && !p.isClosed());
    if (found) return found;
    await sleep(100);
  }
  throw new Error("failed to open a new browser window");
}

async function claimOrOpenPage(ctx, botId) {
  const open = ctx.pages().filter((p) => !p.isClosed());
  const takenPages = [...pages.entries()]
    .filter(([id, p]) => id !== botId && p && !p.isClosed() && p.context() === ctx)
    .map(([, p]) => p);
  const takenWindows = new Set();
  for (const p of takenPages) {
    try {
      takenWindows.add(await windowIdFor(p));
    } catch {
      // ignore
    }
  }
  for (const page of open) {
    if (takenPages.includes(page)) continue;
    let win;
    try {
      win = await windowIdFor(page);
    } catch {
      continue;
    }
    if (takenWindows.has(win)) continue;
    return page;
  }
  return newBotWindow(ctx);
}

async function ensureBrowser(slot) {
  if (contexts.get(slot)) return;
  try {
    await connectCdp(slot, 4000);
  } catch {
    launchChromium(slot);
    await sleep(5000);
    await connectCdp(slot, 15000);
  }
}

async function getPage(botId) {
  const rect = assignSlot(botId);
  return withBotGate(botId, () =>
    withSlotGate(rect.slot, async () => {
      await ensureBrowser(rect.slot);
      const ctx = contexts.get(rect.slot);
      if (!ctx) throw new Error("Chromium is not running on this screen");
      const existing = pages.get(botId);
      if (existing && !existing.isClosed()) {
        await placeWindow(existing, botId).catch(() => {});
        return existing;
      }
      const page = await claimOrOpenPage(ctx, botId);
      page.on("close", () => {
        if (pages.get(botId) === page) pages.delete(botId);
      });
      pages.set(botId, page);
      await placeWindow(page, botId).catch(() => {});
      await sleep(250);
      return page;
    }),
  );
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

async function handleDesktopScreenshot(body) {
  const file = `/tmp/pibot-screen-${Date.now()}.png`;
  const id = body && body.botId ? botKey(body) : "";
  const rect = id ? assignSlot(id) : slotRect(0);
  const label = `Desktop screenshot (screen ${rect.slot + 1}/${SLOT_COUNT}):`;
  await execFileAsync("scrot", ["-o", file], { env: { ...process.env, DISPLAY: rect.display } });
  try {
    const data = readFileSync(file).toString("base64");
    return { ok: true, text: label, image: { data, mimeType: "image/png" } };
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
  "/screens/claim": handleClaimScreens,
  "/screens/list": screenState,
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
