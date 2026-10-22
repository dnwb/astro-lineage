import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("mobile responsive contract: homepage paper grid and card constraints", async () => {
  const globalCss = await readFile(join(projectRoot, "src/styles/global.css"), "utf-8");
  const indexAstro = await readFile(join(projectRoot, "src/pages/index.astro"), "utf-8");

  // 1. Grid track must use minmax(0, 1fr) to prevent track blowout from intrinsic min-content
  assert.match(
    globalCss,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    "intelligence-grid must define minmax(0, 1fr) track to prevent mobile overflow"
  );

  // 2. intel-card must enforce min-width: 0 to shrink inside flex/grid
  assert.match(
    globalCss,
    /\.intel-card\s*\{[^}]*min-width:\s*0/s,
    "intel-card must enforce min-width: 0"
  );

  // 3. reader-math inline formulas must allow horizontal scroll instead of expanding container
  assert.match(
    globalCss,
    /\.reader-math\s*\{[^}]*overflow-x:\s*auto/s,
    "reader-math must allow overflow-x: auto for long formulas"
  );

  // 4. pills-scroll in index.astro must have min-width: 0 and flex: 1
  assert.match(
    indexAstro,
    /\.pills-scroll\s*\{[^}]*min-width:\s*0/s,
    "pills-scroll must have min-width: 0 to prevent expanding flex parent"
  );

  // 5. intel-pick-links in index.astro must wrap on narrow screens
  assert.match(
    indexAstro,
    /\.intel-pick-links\s*\{[^}]*flex-wrap:\s*wrap/s,
    "intel-pick-links must have flex-wrap: wrap"
  );
});

function hasPlaywright() {
  const check = spawnSync("python3", ["-c", "import playwright.sync_api"], {
    stdio: "ignore",
  });
  return check.status === 0;
}

test("mobile viewport rendered layout: 375px mobile screen prevents horizontal overflow", async (t) => {
  const distHtml = join(projectRoot, "dist/index.html");
  if (!existsSync(distHtml) || !existsSync("/usr/bin/chromium") || !hasPlaywright()) {
    t.skip(
      "Skipping rendered layout test: dist/index.html, chromium or python playwright not available"
    );
    return;
  }

  // Execute the playwright diagnostic script in scratch or inline
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import threading, http.server, socketserver, functools, sys
from playwright.sync_api import sync_playwright

DIRECTORY = '${projectRoot}/dist'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True
    def handle_error(self, request, client_address):
        pass

server_ready = threading.Event()
server_port = 0
def run_server():
    global server_port
    handler = functools.partial(QuietHandler, directory=DIRECTORY)
    with ReusableTCPServer(('127.0.0.1', 0), handler) as httpd:
        server_port = httpd.server_address[1]
        server_ready.set()
        httpd.serve_forever()

t = threading.Thread(target=run_server, daemon=True)
t.start()
server_ready.wait()

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium')
    ctx = b.new_context(viewport={'width': 375, 'height': 667}, is_mobile=True)
    page = ctx.new_page()
    page.goto(f'http://127.0.0.1:{server_port}/')
    page.wait_for_load_state('networkidle')

    res = page.evaluate('''() => {
        const bodyScrollWidth = document.body.scrollWidth;
        const dailyCard = document.querySelector('.intel-card-daily');
        const weeklyCard = document.querySelector('.intel-card-weekly');
        const dailyWidth = dailyCard ? Math.round(dailyCard.getBoundingClientRect().width) : 0;
        const weeklyWidth = weeklyCard ? Math.round(weeklyCard.getBoundingClientRect().width) : 0;
        const dailyRight = dailyCard ? Math.round(dailyCard.getBoundingClientRect().right) : 0;
        const weeklyRight = weeklyCard ? Math.round(weeklyCard.getBoundingClientRect().right) : 0;
        return { bodyScrollWidth, dailyWidth, weeklyWidth, dailyRight, weeklyRight };
    }''')
    b.close()
    print(f"{res['bodyScrollWidth']},{res['dailyWidth']},{res['weeklyWidth']},{res['dailyRight']},{res['weeklyRight']}")
`,
    ],
    { encoding: "utf-8" }
  );

  if (result.status !== 0) {
    throw new Error(`Python diagnostic failed: ${result.stderr || result.stdout}`);
  }

  const [bodyScrollWidth, dailyWidth, weeklyWidth, dailyRight, weeklyRight] = result.stdout
    .trim()
    .split(",")
    .map(Number);

  assert.ok(
    bodyScrollWidth <= 375,
    `body.scrollWidth (${bodyScrollWidth}px) exceeds 375px viewport`
  );
  assert.ok(dailyWidth <= 375, `dailyCard.width (${dailyWidth}px) exceeds 375px viewport`);
  assert.ok(weeklyWidth <= 375, `weeklyCard.width (${weeklyWidth}px) exceeds 375px viewport`);
  assert.ok(dailyRight <= 375, `dailyCard.right (${dailyRight}px) exceeds 375px viewport`);
  assert.ok(weeklyRight <= 375, `weeklyCard.right (${weeklyRight}px) exceeds 375px viewport`);
});
