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

  // 4. Ticket #34: Reader typography measure (72ch) and BLUF grid alignment
  assert.match(
    globalCss,
    /--measure-prose:\s*72ch;/,
    "global.css must declare --measure-prose: 72ch in :root"
  );
  assert.match(
    globalCss,
    /\.bluf-text[^}]*max-inline-size:\s*var\(--measure-prose,\s*72ch\)/s,
    "global.css must apply max-inline-size: var(--measure-prose, 72ch) to .bluf-text"
  );
  assert.match(
    globalCss,
    /\.bluf-item\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*5\.25rem\s+minmax\(0,\s*1fr\);[^}]*column-gap:\s*0\.75rem;[^}]*align-items:\s*baseline;/s,
    "global.css must configure .bluf-item with strict 2-column grid layout"
  );

  // 5. Ticket #34: WCAG AA contrast tokens & softened dark must-read card
  assert.match(
    globalCss,
    /:root\s*\{[^}]*--text-muted:\s*#526071;/s,
    "global.css must set WCAG AA compliant --text-muted: #526071 in light mode :root"
  );
  assert.match(
    globalCss,
    /:root\[data-theme="dark"\][^{]*\{[^}]*--text-muted:\s*#94a3b8\s*!important;/s,
    "global.css must set high-contrast --text-muted: #94a3b8 in dark mode"
  );
  assert.match(
    globalCss,
    /:root\[data-theme="dark"\][^{]*\{[^}]*--must-read-bg:\s*#1e2433\s*!important;/s,
    "global.css must soften dark mode --must-read-bg to #1e2433"
  );
  assert.match(
    globalCss,
    /:is\(\[data-theme="dark"\][^{]*\.radar-card-must-read[^{]*\{[^}]*background:\s*var\(--must-read-bg/s,
    "global.css must soften dark must-read cards with neutral background and accent border"
  );
  assert.match(
    globalCss,
    /:root\s*\{[^}]*--text-secondary:\s*#475569;/s,
    "global.css must set WCAG AA compliant --text-secondary: #475569 in light mode :root"
  );
  assert.match(
    globalCss,
    /:root\[data-theme="dark"\][^{]*\{[^}]*--text-secondary:\s*#cbd5e1\s*!important;/s,
    "global.css must set high-contrast --text-secondary: #cbd5e1 in dark mode"
  );
  assert.match(
    globalCss,
    /:root\s*\{[^}]*--accent-must-read:\s*#f59e0b;/s,
    "global.css must set harmonized --accent-must-read: #f59e0b in :root"
  );
  assert.match(
    globalCss,
    /\.reader-math\s*>\s*\.katex\s*\{[^}]*font-size:\s*1\.03em;/s,
    "global.css must set .reader-math > .katex font-size to 1.03em"
  );

  // 6. Ticket #34: Boilerplate elimination in DailyRadarCard.astro
  const radarCard = await readFile(
    join(projectRoot, "src/components/DailyRadarCard.astro"),
    "utf-8"
  );
  assert.doesNotMatch(
    radarCard,
    /radar-en-deck/,
    "DailyRadarCard.astro must not contain radar-en-deck boilerplate"
  );
  assert.doesNotMatch(
    radarCard,
    /Click the button above to view full quantitative analysis/,
    "DailyRadarCard.astro must not contain repetitive modal guide text"
  );

  // 7. Daily Radar Dark Mode contrast & hygiene contract
  const indexAstro = await readFile(
    join(projectRoot, "src/pages/index.astro"),
    "utf-8"
  );
  assert.doesNotMatch(
    indexAstro,
    /<style is:global>/,
    "src/pages/index.astro must not use <style is:global> which corrupts :global() pseudo-classes"
  );
  assert.match(
    indexAstro,
    /:global\(:is\(\[data-theme="dark"\],\s*body:has\(#site-theme-toggle:checked\)\)\)\s*\.intel-daily-date-pills/,
    "index.astro must bind dark theme to .intel-daily-date-pills with toggle and data-theme guards"
  );
  assert.match(
    indexAstro,
    /:global\(:is\(\[data-theme="dark"\],\s*body:has\(#site-theme-toggle:checked\)\)\)\s*\.intel-inline-figure/,
    "index.astro must bind dark theme to .intel-inline-figure with toggle and data-theme guards"
  );

  const switcherContent = await readFile(
    join(projectRoot, "src/components/DailyDateSwitcher.astro"),
    "utf-8"
  );
  assert.match(
    switcherContent,
    /:global\(:root:not\(\[data-theme="light"\]\)\s*body:not\(:has\(#site-theme-toggle:checked\)\)\)\s*\.aihot-date-ribbon/,
    "DailyDateSwitcher.astro must guard dark OS media query with :root:not([data-theme='light'])"
  );
});

function hasPlaywright() {
  const check = spawnSync("python3", ["-c", "import playwright.sync_api"], {
    stdio: "ignore",
  });
  return check.status === 0;
}

test("theme rendered matrix: 4-quadrant color verification across OS color schemes", async (t) => {
  const distHtml = join(projectRoot, "dist/index.html");
  if (!existsSync(distHtml) || !existsSync("/usr/bin/chromium") || !hasPlaywright()) {
    t.skip(
      "Skipping rendered theme test: dist/index.html, chromium or python playwright not available"
    );
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

class ReusableThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    def handle_error(self, request, client_address):
        pass

server_ready = threading.Event()
server_port = 0
httpd_holder = []
def run_server():
    global server_port
    httpd = ReusableThreadingServer(('127.0.0.1', 0), QuietHandler)
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
        
        # 1. Dark OS -> Light Mode (user explicitly toggled light)
        ctx1 = b.new_context(color_scheme='dark')
        page1 = ctx1.new_page()
        page1.goto(f'http://127.0.0.1:{server_port}/', wait_until='domcontentloaded')
        page1.wait_for_selector('label[for="site-theme-toggle"]')
        page1.click('label[for="site-theme-toggle"]')
        page1.wait_for_timeout(250)
        q1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-quick-item')).backgroundColor")
        p1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-pick-item')).backgroundColor")
        c1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-card')).backgroundColor")
        pills1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-date-pills')).backgroundColor")
        fig1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-inline-figure')).backgroundColor")
        chip1 = page1.evaluate("window.getComputedStyle(document.querySelector('.daily-date-chip:not(.active)')).backgroundColor")
        img_flt1 = page1.evaluate("window.getComputedStyle(document.querySelector('.intel-figure-img')).filter")
        assert q1 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {q1}'
        assert p1 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {p1}'
        assert c1 == 'rgb(255, 255, 255)', f'Expected #ffffff, got {c1}'
        assert pills1 == 'rgb(248, 250, 252)', f'Expected light pills #f8fafc, got {pills1}'
        assert fig1 == 'rgb(248, 250, 252)', f'Expected light figure card #f8fafc, got {fig1}'
        assert chip1 == 'rgb(255, 255, 255)', f'Expected light chip #ffffff, got {chip1}'
        assert img_flt1 == 'none', f'Scientific image must not be filtered, got {img_flt1}'
        ctx1.close()

        # 2. Dark OS -> Dark Mode (default, un-toggled)
        ctx2 = b.new_context(color_scheme='dark')
        page2 = ctx2.new_page()
        page2.goto(f'http://127.0.0.1:{server_port}/', wait_until='domcontentloaded')
        page2.wait_for_selector('.intel-card')
        page2.wait_for_timeout(250)
        q2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-quick-item')).backgroundColor")
        p2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-pick-item')).backgroundColor")
        c2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-card')).backgroundColor")
        pills2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-date-pills')).backgroundColor")
        fig2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-inline-figure')).backgroundColor")
        chip2 = page2.evaluate("window.getComputedStyle(document.querySelector('.daily-date-chip:not(.active)')).backgroundColor")
        badge2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-figure-badge')).color")
        core2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-figure-core')).color")
        img_flt2 = page2.evaluate("window.getComputedStyle(document.querySelector('.intel-figure-img')).filter")
        assert q2 == 'rgb(23, 23, 23)', f'Expected #171717, got {q2}'
        assert p2 == 'rgb(15, 23, 42)', f'Expected #0f172a, got {p2}'
        assert c2 == 'rgb(30, 41, 59)', f'Expected #1e293b, got {c2}'
        assert pills2 == 'rgb(15, 23, 42)', f'Expected dark pills #0f172a, got {pills2}'
        assert fig2 == 'rgb(15, 23, 42)', f'Expected dark figure card #0f172a, got {fig2}'
        assert chip2 == 'rgb(30, 41, 59)', f'Expected dark chip #1e293b, got {chip2}'
        assert badge2 == 'rgb(147, 197, 253)', f'Expected dark badge text #93c5fd, got {badge2}'
        assert core2 == 'rgb(203, 213, 225)', f'Expected dark core text #cbd5e1, got {core2}'
        assert img_flt2 == 'none', f'Scientific image must not be filtered/inverted in dark mode, got {img_flt2}'
        ctx2.close()

        # 3. Light OS -> Light Mode (default)
        ctx3 = b.new_context(color_scheme='light')
        page3 = ctx3.new_page()
        page3.goto(f'http://127.0.0.1:{server_port}/', wait_until='domcontentloaded')
        page3.wait_for_selector('.intel-card')
        page3.wait_for_timeout(250)
        q3 = page3.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-quick-item')).backgroundColor")
        p3 = page3.evaluate("window.getComputedStyle(document.querySelector('.intel-pick-item')).backgroundColor")
        c3 = page3.evaluate("window.getComputedStyle(document.querySelector('.intel-card')).backgroundColor")
        pills3 = page3.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-date-pills')).backgroundColor")
        fig3 = page3.evaluate("window.getComputedStyle(document.querySelector('.intel-inline-figure')).backgroundColor")
        assert q3 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {q3}'
        assert p3 == 'rgb(250, 248, 245)', f'Expected #faf8f5, got {p3}'
        assert c3 == 'rgb(255, 255, 255)', f'Expected #ffffff, got {c3}'
        assert pills3 == 'rgb(248, 250, 252)', f'Expected light pills #f8fafc, got {pills3}'
        assert fig3 == 'rgb(248, 250, 252)', f'Expected light figure card #f8fafc, got {fig3}'
        ctx3.close()

        # 4. Light OS -> Dark Mode (toggled)
        ctx4 = b.new_context(color_scheme='light')
        page4 = ctx4.new_page()
        page4.goto(f'http://127.0.0.1:{server_port}/', wait_until='domcontentloaded')
        page4.wait_for_selector('label[for="site-theme-toggle"]')
        page4.click('label[for="site-theme-toggle"]')
        page4.wait_for_timeout(250)
        q4 = page4.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-quick-item')).backgroundColor")
        p4 = page4.evaluate("window.getComputedStyle(document.querySelector('.intel-pick-item')).backgroundColor")
        c4 = page4.evaluate("window.getComputedStyle(document.querySelector('.intel-card')).backgroundColor")
        pills4 = page4.evaluate("window.getComputedStyle(document.querySelector('.intel-daily-date-pills')).backgroundColor")
        fig4 = page4.evaluate("window.getComputedStyle(document.querySelector('.intel-inline-figure')).backgroundColor")
        assert q4 == 'rgb(23, 23, 23)', f'Expected #171717, got {q4}'
        assert p4 == 'rgb(15, 23, 42)', f'Expected #0f172a, got {p4}'
        assert c4 == 'rgb(30, 41, 59)', f'Expected #1e293b, got {c4}'
        assert pills4 == 'rgb(15, 23, 42)', f'Expected dark pills #0f172a, got {pills4}'
        assert fig4 == 'rgb(15, 23, 42)', f'Expected dark figure card #0f172a, got {fig4}'
        ctx4.close()

        # 5. Mobile Narrow Screen Responsiveness (viewport width: 375px)
        ctx5 = b.new_context(viewport={'width': 375, 'height': 667}, color_scheme='dark')
        page5 = ctx5.new_page()
        page5.goto(f'http://127.0.0.1:{server_port}/', wait_until='domcontentloaded')
        page5.wait_for_selector('.intel-card')
        page5.wait_for_timeout(250)
        pills_w = page5.evaluate("document.querySelector('.intel-daily-date-pills').getBoundingClientRect().width")
        assert pills_w <= 375, f'Pills container width {pills_w} must fit within 375px viewport'
        ctx5.close()

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
