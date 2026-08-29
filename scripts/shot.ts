#!/usr/bin/env node
// Photographs the built game in real Chrome, at the viewports it is marked at.
//
// Why this exists: the harness cannot see anything the canvas does. Every check
// in `pnpm check` parses `dist/` as text, so a game that renders a black
// rectangle at 390x844 passes all of them. The rendered page is the truth, and
// this is how the rendered page gets looked at without a human at a browser.
//
// It drives Chrome over the DevTools protocol — no dependency, no Playwright:
// node 24 has a global WebSocket and Chrome ships the rest. Presses are real
// `Input.dispatchKeyEvent` events, so what is photographed is what a player
// would have got, autoplay policy and all.
//
//   node scripts/shot.ts            # writes .shots/*.png
//   node scripts/shot.ts --card     # ...and copies the card frame to public/
//
// Needs `pnpm build` first, and Chrome on PATH.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
// The shot list is a separate module so a test can replay it: see
// `scripts/shot-plan.ts` and `spec/shot-plan.test.ts`.
import { SHOTS } from "./shot-plan.ts";
import type { Shot } from "./shot-plan.ts";

const PREVIEW_PORT = 4331;
const CDP_PORT = 9333;
/**
 * The site is built under a base path, and its script tag is an absolute URL
 * beneath it, so `dist/index.html` opened as a file loads no game at all. It
 * has to be served from that prefix — which is also the shape the deployed
 * site has, and therefore the shape worth photographing.
 */
const PREFIX = "/comp4020-crit5-marcuszorian";
const BASE = `http://127.0.0.1:${PREVIEW_PORT}${PREFIX}/`;
const OUT = ".shots";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "shot-"));
  let preview: Server | undefined;
  let chrome: ChildProcess | undefined;

  try {
    preview = serveDist();
    await waitFor(BASE, "the static server");

    chrome = spawn(
      chromeBinary(),
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        // Deliberately NOT --autoplay-policy=no-user-gesture-required. The real
        // policy is part of what is being checked: an AudioContext built before
        // the opening press earns a console warning, and this run reads those.
        `--user-data-dir=${profile}`,
        `--remote-debugging-port=${CDP_PORT}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, "Chrome");

    const page = await pageTarget();
    const cdp = await connect(page);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Log.enable");
      for (const shot of SHOTS) await capture(cdp, shot);

      // A screenshot of a page whose console is full of exceptions looks
      // exactly like a screenshot of a working one, so the run reads the
      // console too and refuses to be quietly wrong.
      if (cdp.complaints.length > 0) {
        for (const line of cdp.complaints) console.error(`! ${line}`);
        throw new Error(`Chrome logged ${cdp.complaints.length} problem(s)`);
      }
    } finally {
      cdp.close();
    }

    if (process.argv.includes("--card")) {
      copyFileSync(join(OUT, "card.png"), join("public", "card.png"));
      console.log("→ public/card.png");
    }
  } finally {
    chrome?.kill();
    preview?.close();
    // Chrome writes its profile out on the way down, so a delete issued the
    // instant after SIGTERM loses the race with it. The directory is in /tmp
    // either way; failing to clean it up is not worth a non-zero exit.
    await sleep(400);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Left behind in /tmp. Harmless.
    }
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/**
 * Twenty lines instead of `astro preview`, which in this version daemonises
 * itself and hands back whatever build it was started on — the wrong dist is
 * the one bug a screenshot cannot show you.
 */
function serveDist(): Server {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", BASE).pathname;
    const relative = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path;
    const file = join("dist", normalize(relative === "/" || relative === "" ? "/index.html" : relative));
    try {
      const body = readFileSync(file);
      response.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not built");
    }
  });
  server.listen(PREVIEW_PORT, "127.0.0.1");
  return server;
}

async function capture(cdp: Client, shot: Shot): Promise<void> {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: shot.dpr,
    // Mobile emulation is what makes 390x844 behave like a phone rather than
    // like a very narrow desktop: touch events, and a real visual viewport.
    mobile: shot.width < 600,
  });
  await cdp.send("Page.navigate", { url: BASE });
  await cdp.loaded();

  let elapsed = 0;
  for (const at of [...shot.press].sort((a, b) => a - b)) {
    await sleep(Math.max(0, at - elapsed));
    elapsed = at;
    await press(cdp);
  }
  await sleep(Math.max(0, shot.at - elapsed));

  const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
  });
  const file = join(OUT, `${shot.name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`→ ${file}  ${shot.width}x${shot.height} @${shot.dpr}x`);
}

async function press(cdp: Client): Promise<void> {
  const key = { code: "Space", key: " ", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
}

// --- the thinnest usable DevTools client -------------------------------------

interface Client {
  send<T = unknown>(method: string, params?: object): Promise<T>;
  loaded(): Promise<void>;
  /** Uncaught exceptions and console errors/warnings, in the order Chrome saw them. */
  readonly complaints: string[];
  close(): void;
}

function connect(wsUrl: string): Promise<Client> {
  const socket = new WebSocket(wsUrl);
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  const complaints: string[] = [];
  let loads: (() => void)[] = [];
  let id = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: {
        exceptionDetails?: { text?: string; exception?: { description?: string } };
        entry?: { level?: string; text?: string; url?: string };
      };
      result?: unknown;
      error?: { message: string };
    };
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      complaints.push(details?.exception?.description ?? details?.text ?? "unknown exception");
      return;
    }
    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry;
      // Everything Chrome calls an error or a warning, including the autoplay
      // one — there is nothing on this page either is allowed to be about.
      if (entry?.level === "error" || entry?.level === "warning") {
        complaints.push(`${entry.level}: ${entry.text ?? ""} ${entry.url ?? ""}`.trim());
      }
      return;
    }
    if (message.method === "Page.loadEventFired") {
      const waiting = loads;
      loads = [];
      for (const done of waiting) done();
      return;
    }
    if (message.id === undefined) return;
    const slot = pending.get(message.id);
    if (slot === undefined) return;
    pending.delete(message.id);
    if (message.error) slot.reject(new Error(message.error.message));
    else slot.resolve(message.result as never);
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener("error", () => reject(new Error(`cannot reach ${wsUrl}`)));
    socket.addEventListener("open", () => {
      resolve({
        send: (method, params = {}) =>
          new Promise((ok, no) => {
            id += 1;
            pending.set(id, { resolve: ok as (v: never) => void, reject: no });
            socket.send(JSON.stringify({ id, method, params }));
          }),
        // Navigation is asynchronous; every shot waits for the load event
        // before its clock starts, so `press` timings mean what they say.
        loaded: () => new Promise<void>((done) => loads.push(done)),
        complaints,
        close: () => socket.close(),
      });
    });
  });
}

async function pageTarget(): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const targets = (await response.json()) as {
    type: string;
    webSocketDebuggerUrl?: string;
  }[];
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error("Chrome opened no page target");
  return page.webSocketDebuggerUrl;
}

function chromeBinary(): string {
  return (
    process.env.CHROME ??
    ["google-chrome", "google-chrome-stable", "chromium"].find(Boolean) ??
    "google-chrome"
  );
}

async function waitFor(url: string, what: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet. The loop is the retry.
    }
    await sleep(100);
  }
  throw new Error(`${what} never came up at ${url}`);
}

await main();
