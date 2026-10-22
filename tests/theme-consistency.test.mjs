import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("theme consistency contract: ThemeToggle and global.css guards", async () => {
  const toggleContent = await readFile(
    join(projectRoot, "src/components/ThemeToggle.astro"),
    "utf-8"
  );
  const globalCss = await readFile(join(projectRoot, "src/styles/global.css"), "utf-8");

  // 1. ThemeToggle must not invert checked state on Dark OS
  assert.doesNotMatch(
    toggleContent,
    /isDarkOS\s*\?\s*!isDark\s*:\s*isDark/,
    "ThemeToggle must not invert checked state with isDarkOS ? !isDark : isDark"
  );
  assert.match(
    toggleContent,
    /el\.checked\s*=\s*isDark/,
    "ThemeToggle must align el.checked directly to isDark"
  );

  // 2. global.css must guard dark preference overrides with :root:not([data-theme="light"])
  assert.match(
    globalCss,
    /:root:not\(\[data-theme="light"\]\)\s*body:not\(:has\(#site-theme-toggle:checked\)\)\s*\.intel-pick-item/,
    "global.css must guard intel-pick-item dark preference overrides with :root:not([data-theme='light'])"
  );

  // 3. global.css must contain explicit light overrides for card items
  assert.match(
    globalCss,
    /:root\[data-theme="light"\]\s*\.intel-daily-quick-item/,
    "global.css must enforce explicit :root[data-theme='light'] rules for quick item"
  );
  assert.match(
    globalCss,
    /:root\[data-theme="light"\]\s*\.intel-pick-item/,
    "global.css must enforce explicit :root[data-theme='light'] rules for pick item"
  );
});

test("theme rendered matrix: 4-quadrant color verification across OS color schemes", async (t) => {
  const distHtml = join(projectRoot, "dist/index.html");
  if (!existsSync(distHtml) || !existsSync("/usr/bin/chromium")) {
    t.skip("Skipping rendered theme test: dist/index.html or /usr/bin/chromium not available");
    return;
  }

  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import threading, http.server, socketserver, functools, sys
from playwright.sync_api import sync_playwright

DIRECTORY = '${projectRoot}/dist'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
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
httpd_holder = []
def run_server():
    global server_port
    httpd = ReusableTCPServer(('127.0.0.1', 0), QuietHandler)
    httpd_holder.append(httpd)
    server_port = httpd.server_address[1]
    server_ready.set()
    httpd.serve_forever()

t = threading.Thread(target=run_server, daemon=True)
t.start()
server_ready.wait()

try:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium')
        
        # 1. Dark OS -> Light Mode
        ctx1 = b.new_context(color_scheme='dark')
        page1 = ctx1.new_page()
        page1.goto(f'http://127.0.0.1:{server_port}/')
        page1.wait_for_load_state('networkidle')
        page1.wait_for_selector('label[for="site-theme-toggle"]')
        page1.click('label[for="site-theme-toggle"]')
        page1.wait_for_timeout(250)
        q1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-quick-item')).backgroundColor")
        p1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-pick-item')).backgroundColor")
        m1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-metrics-strip')).backgroundColor")
        c1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-card')).backgroundColor")
        assert q1 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {q1}'
        assert p1 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {p1}'
        assert m1 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {m1}'
        assert c1 == 'rgb(255, 255, 255)', f'Expected #ffffff, got {c1}'
        ctx1.close()

        # 2. Dark OS -> Dark Mode (default)
        ctx2 = b.new_context(color_scheme='dark')
        page2 = ctx2.new_page()
        page2.goto(f'http://127.0.0.1:{server_port}/')
        page2.wait_for_load_state('networkidle')
        page2.wait_for_selector('.intel-card')
        page2.wait_for_timeout(250)
        q2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-quick-item')).backgroundColor")
        p2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-pick-item')).backgroundColor")
        m2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-metrics-strip')).backgroundColor")
        c2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-card')).backgroundColor")
        assert q2 == 'rgb(23, 23, 23)', f'Expected #171717, got {q2}'
        assert p2 == 'rgb(15, 23, 42)', f'Expected #0f172a, got {p2}'
        assert m2 == 'rgb(15, 23, 42)', f'Expected #0f172a, got {m2}'
        assert c2 == 'rgb(30, 41, 59)', f'Expected #1e293b, got {c2}'
        ctx2.close()

        # 3. Light OS -> Light Mode (default)
        ctx3 = b.new_context(color_scheme='light')
        page3 = ctx3.new_page()
        page3.goto(f'http://127.0.0.1:{server_port}/')
        page3.wait_for_load_state('networkidle')
        page3.wait_for_selector('.intel-card')
        page3.wait_for_timeout(250)
        q3 = page3.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-quick-item')).backgroundColor")
        p3 = page3.evaluate("window.getComputedStyle(document.querySelector('.intel-pick-item')).backgroundColor")
        m3 = page3.evaluate("window.getComputedStyle(document.querySelector('.intel-metrics-strip')).backgroundColor")
        c3 = page3.evaluate("window.getComputedStyle(document.querySelector('.intel-card')).backgroundColor")
        assert q3 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {q3}'
        assert p3 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {p3}'
        assert m3 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {m3}'
        assert c3 == 'rgb(255, 255, 255)', f'Expected #ffffff, got {c3}'
        ctx3.close()

        # 4. Light OS -> Dark Mode (toggled)
        ctx4 = b.new_context(color_scheme='light')
        page4 = ctx4.new_page()
        page4.goto(f'http://127.0.0.1:{server_port}/')
        page4.wait_for_load_state('networkidle')
        page4.wait_for_selector('label[for="site-theme-toggle"]')
        page4.click('label[for="site-theme-toggle"]')
        page4.wait_for_timeout(250)
        q4 = page4.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-quick-item')).backgroundColor")
        p4 = page4.evaluate("window.getComputedStyle(document.querySelector('.intel-pick-item')).backgroundColor")
        m4 = page4.evaluate("window.getComputedStyle(document.querySelector('.intel-metrics-strip')).backgroundColor")
        c4 = page4.evaluate("window.getComputedStyle(document.querySelector('.intel-card')).backgroundColor")
        assert q4 == 'rgb(23, 23, 23)', f'Expected #171717, got {q4}'
        assert p4 == 'rgb(15, 23, 42)', f'Expected #0f172a, got {p4}'
        assert m4 == 'rgb(15, 23, 42)', f'Expected #0f172a, got {m4}'
        assert c4 == 'rgb(30, 41, 59)', f'Expected #1e293b, got {c4}'
        ctx4.close()

        b.close()
finally:
    if httpd_holder:
        httpd_holder[0].shutdown()
        httpd_holder[0].server_close()
sys.exit(0)
`,
    ],
    { encoding: "utf-8" }
  );

  assert.equal(result.status, 0, `Theme matrix test failed: ${result.stderr || result.stdout}`);
});
