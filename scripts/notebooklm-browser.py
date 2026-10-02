#!/usr/bin/env python3
"""Offline built-page export; live sync uses the installed skill's patchright."""
import argparse
from datetime import date
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import tempfile

MAX_SOURCE_BYTES = 1_000_000
TITLE = "AstroLineage｜{year} 精读日报与周报"


class ReaderText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.stack = []
        self.main = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "main":
            self.main = True
        # Keep original TeX annotations, not duplicate rendered MathML/HTML.
        ignored = tag in ("script", "style", "nav") or "katex-html" in attrs.get("class", "").split()
        ignored = ignored or (bool(self.stack) and self.stack[-1][1])
        if tag not in ("meta", "link", "img", "br", "hr", "input", "wbr", "source"):
            self.stack.append((tag, ignored))
        if self.main and not ignored:
            if tag in ("h1", "h2", "h3", "h4", "h5", "p", "li", "section", "br", "hr"):
                self.parts.append("\n")
            if tag == "a" and attrs.get("href", "").startswith("https://"):
                self.parts.append(f" {attrs['href']} ")
            if tag == "annotation":
                self.parts.append(" $")

    def handle_endtag(self, tag):
        if tag == "annotation":
            self.parts.append("$ ")
        if self.main and tag in ("p", "li", "section", "h1", "h2", "h3", "h4", "h5", "details"):
            self.parts.append("\n")
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                self.stack = self.stack[:i]
                break
        if tag == "main":
            self.main = False

    def handle_data(self, text):
        if not self.main or (self.stack and self.stack[-1][1]):
            return
        in_math = any(tag == "math" for tag, _ in self.stack)
        in_annotation = any(tag == "annotation" for tag, _ in self.stack)
        if not in_math or in_annotation:
            self.parts.append(text)

    def text(self):
        return "\n".join(re.sub(r"[ \t\r]+", " ", line).strip()
                         for line in "".join(self.parts).splitlines() if line.strip())


def export_pages(dist):
    groups = {}
    reports = []
    for kind, route, pattern in (
        ("daily", "arxiv-daily", r"\d{4}-\d{2}-\d{2}"),
        ("weekly", "arxiv-weekly", r"\d{4}-W\d{2}"),
    ):
        for page in sorted((dist / route).glob("*/index.html")):
            identity = page.parent.name
            if not re.fullmatch(pattern, identity):
                continue
            if kind == "daily":
                stamp = date.fromisoformat(identity)
                year, month = stamp.year, stamp.month
            else:
                year, week = int(identity[:4]), int(identity[-2:])
                month = date.fromisocalendar(year, week, 4).month
            if page.stat().st_size > 20_000_000:
                raise ValueError("NOTEBOOKLM_PAGE_TOO_LARGE")
            html = page.read_bytes()
            reader = ReaderText()
            reader.feed(html.decode("utf-8"))
            text = reader.text()
            if not text:
                raise ValueError("NOTEBOOKLM_EMPTY_PAGE")
            route_path = f"/{route}/{identity}/"
            report = {"kind": kind, "id": identity, "route": route_path,
                      "page_sha256": hashlib.sha256(html).hexdigest()}
            reports.append(report)
            body = f"## {identity}\n网页归档路径：{route_path}\n{text}\n"
            groups.setdefault((year, kind, month), []).append(body)
    sources = []
    for (year, kind, month), bodies in sorted(groups.items()):
        chunks, chunk = [], ""
        for body in bodies:
            if len(body.encode("utf-8")) > MAX_SOURCE_BYTES - 1000:
                raise ValueError("NOTEBOOKLM_REPORT_TOO_LARGE")
            if len((chunk + body).encode("utf-8")) > MAX_SOURCE_BYTES - 1000:
                chunks.append(chunk)
                chunk = ""
            chunk += body + "\n"
        if chunk:
            chunks.append(chunk)
        for part, body in enumerate(chunks, 1):
            key = f"{kind}-{year}-{month:02d}-p{part:02d}"
            text = (f"# {TITLE.format(year=year)} · {key}\n"
                    "以下为已构建网页导读，不是论文全文，也不代表独立验证。"
                    "保留各条阅读范围、候选关系和未核实事项；待分析不等于不值得读。\n\n" + body)
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            sources.append({"year": year, "key": key, "sha256": digest,
                            "title": f"AL-{key}-{digest}.txt",
                            "text": f"ASTROLINEAGE_SOURCE_SHA256_{digest}\n{text}"})
    return {"schema_version": 1, "reports": reports, "sources": sources}


def source_button(page, title):
    return page.get_by_role("button", name=re.compile(r"^" + re.escape(title) + r"$"))


def verify_source(page, source):
    button = source_button(page, source["title"])
    button.wait_for(state="visible", timeout=90_000)
    button.click()
    page.get_by_text(f"ASTROLINEAGE_SOURCE_SHA256_{source['sha256']}", exact=False).first.wait_for(
        state="visible", timeout=90_000)
    # Reload to return to the source list: 'Close source guide' only collapses
    # the generated synopsis, not the source viewer in the current UI.
    page.goto(page.url.split("?")[0], wait_until="domcontentloaded")
    page.get_by_role("button", name="Add source", exact=True).wait_for(state="visible")


def synchronize(page, request):
    page.goto("https://notebook.google.com/", wait_until="domcontentloaded")
    if "accounts.google.com" in page.url:
        raise ValueError("NOTEBOOKLM_AUTH_REQUIRED")
    page.get_by_role("button", name=re.compile(r"^(New notebook|Create new notebook)$", re.I)).first.wait_for(
        state="visible", timeout=20_000)
    year = request["year"]
    title = TITLE.format(year=year)
    url = request.get("notebook_url")
    if url:
        if not re.fullmatch(r"https://(?:notebook|notebooklm)\.google\.com/notebook/[0-9a-f-]{36}", url):
            raise ValueError("NOTEBOOKLM_INVALID_URL")
        page.goto(url, wait_until="domcontentloaded")
    else:
        # Expand the full list before deciding that the annual notebook is absent.
        for _ in range(50):
            more = page.get_by_role("button", name="See more recent notebooks", exact=True)
            if not more.count() or not more.is_visible():
                break
            before = page.locator('a[href*="/notebook/"]').count()
            more.click()
            page.wait_for_function("n => document.querySelectorAll('a[href*=\"/notebook/\"]').length > n", arg=before,
                                   timeout=10_000)
        else:
            raise ValueError("NOTEBOOKLM_INVENTORY_INCOMPLETE")
        match = page.get_by_role("link", name=title, exact=True)
        if match.count() > 1:
            raise ValueError("NOTEBOOKLM_DUPLICATE_ANNUAL_NOTEBOOKS")
        if match.count():
            match.click()
        else:
            page.get_by_role("button", name=re.compile(r"^(New notebook|Create new notebook)$", re.I)).first.click()
            page.wait_for_url("**/notebook/**")
            # Close the automatic add-source dialog before editing the title.
            close = page.get_by_role("button", name=re.compile(r"^Close$", re.I))
            if close.count():
                close.first.click()
            page.locator("input").first.fill(title)
            page.locator("input").first.press("Tab")
    page.get_by_role("button", name="Add source", exact=True).wait_for(state="visible")
    if page.locator("input").first.input_value() != title:
        raise ValueError("NOTEBOOKLM_TITLE_MISMATCH")
    # Return URL before uploads, so a partially failed run can reuse its notebook.
    print(json.dumps({"event": "notebook", "year": year, "url": page.url}), flush=True)
    with tempfile.TemporaryDirectory(prefix="astro-lineage-notebook-") as folder:
        for source in request["sources"]:
            if not source_button(page, source["title"]).count():
                page.get_by_role("button", name="Add source", exact=True).click()
                target = Path(folder) / source["title"]
                target.write_text(source["text"], encoding="utf-8")
                with page.expect_file_chooser() as chooser:
                    page.get_by_role("button", name="Upload files", exact=True).click()
                chooser.value.set_files(str(target))
            verify_source(page, source)
            # Only replace generated revisions of this exact bundle; no user sources/notebooks.
            old = page.get_by_role("button", name=re.compile(
                r"^AL-" + re.escape(source["key"]) + r"-[0-9a-f]{64}\.txt$"))
            old_titles = [old.nth(i).inner_text() for i in range(old.count())]
            for old_title in old_titles:
                if old_title == source["title"]:
                    continue
                row = source_button(page, old_title).locator(
                    "xpath=ancestor::*[.//button[starts-with(@id,'source-item-more-button-')]][1]")
                row.locator('button[id^="source-item-more-button-"]').click()
                page.get_by_role("menuitem", name=re.compile(r"^(Remove|Delete) source$", re.I)).click()
                page.get_by_role("button", name=re.compile(r"^(Remove|Delete)$", re.I)).click()
                source_button(page, old_title).wait_for(state="detached")
            print(json.dumps({"event": "source", "year": year, "key": source["key"],
                              "sha256": source["sha256"], "title": source["title"]}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--export", type=Path)
    parser.add_argument("--state", type=Path)
    parser.add_argument("--login", action="store_true")
    args = parser.parse_args()
    if args.export:
        print(json.dumps(export_pages(args.export), ensure_ascii=False))
        return
    if args.state is None:
        raise ValueError("NOTEBOOKLM_AUTH_REQUIRED")
    if not args.login and not args.state.exists():
        raise ValueError("NOTEBOOKLM_AUTH_REQUIRED")
    from patchright.sync_api import sync_playwright
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=not args.login, channel="chrome", args=["--no-sandbox"])
        try:
            context = browser.new_context(storage_state=str(args.state) if args.state.exists() else None)
            page = context.new_page()
            page.set_default_timeout(30_000)
            if args.login:
                page.goto("https://notebook.google.com/", wait_until="domcontentloaded")
                page.get_by_role("button", name=re.compile(r"^(New notebook|Create new notebook)$", re.I)).first.wait_for(
                    state="visible", timeout=300_000)
                args.state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                temporary = args.state.with_suffix(".tmp")
                context.storage_state(path=str(temporary))
                temporary.chmod(0o600)
                os.replace(temporary, args.state)
                print(json.dumps({"event": "authenticated"}))
            else:
                synchronize(page, json.load(sys.stdin))
        finally:
            browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never emit cookies, HTML, request bodies or browser error details.
        code = str(error) if re.fullmatch(r"NOTEBOOKLM_[A-Z_]+", str(error)) else "NOTEBOOKLM_BROWSER_FAILED"
        print(json.dumps({"event": "error", "code": code}), flush=True)
        sys.exit(1)
