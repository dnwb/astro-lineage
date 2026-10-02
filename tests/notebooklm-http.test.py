import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "notebooklm-http.py"
SPEC = importlib.util.spec_from_file_location("notebooklm_http", SCRIPT)
http = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(http)

NOTEBOOK_ID = "862f49b9-9262-4111-88c1-da374e875333"
OTHER_ID = "11111111-1111-4111-8111-111111111111"
SOURCE_ID = "22222222-2222-4222-8222-222222222222"


def request(notebook_url=None):
    year = 2026
    body = "# 2026-01\nA tested summary.\n"
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    key = "daily-2026-01-p01"
    return {
        "year": year,
        "notebook_url": notebook_url,
        "sources": [{
            "key": key,
            "title": f"AL-{key}-{digest}.txt",
            "sha256": digest,
            "text": f"ASTROLINEAGE_SOURCE_SHA256_{digest}\n{body}",
        }],
    }


class FakeCLI:
    def __init__(self, notebooks=None, sources=None, *, add_timeout=False):
        self.notebooks = list(notebooks or [])
        self.sources = {key: list(value) for key, value in (sources or {}).items()}
        self.calls = []
        self.add_timeout = add_timeout
        self.fulltext_title = None
        self.fulltext_content = None
        self.upload_payloads = []

    def __call__(self, argv):
        self.calls.append(list(argv))
        self.assert_cli_argv(argv)
        args = argv[1:]
        if args[:1] == ["--storage"]:
            args = args[2:]
        command = args[0:2]
        if args[:1] == ["list"]:
            return 0, json.dumps({"notebooks": self.notebooks}), ""
        if args[:1] == ["create"]:
            title = args[1]
            created = {"id": OTHER_ID, "title": title}
            self.notebooks.append(created)
            return 0, json.dumps({"notebook": created}), ""
        if command == ["source", "list"]:
            notebook_id = args[args.index("-n") + 1]
            rows = [{"id": row["id"], "title": row["title"], "status": row["status"]}
                    for row in self.sources.get(notebook_id, [])]
            return 0, json.dumps({"notebook_id": notebook_id, "sources": rows, "count": len(rows)}), ""
        if command == ["source", "add"]:
            filename = Path(args[2])
            source_title = args[args.index("--title") + 1]
            notebook_id = args[args.index("-n") + 1]
            payload = filename.read_text(encoding="utf-8")
            self.upload_payloads.append(payload)
            lines = payload.splitlines(keepends=True)
            opening = lines[0].rstrip("\r\n")
            match = re.fullmatch(r"(`{3,})text", opening)
            if not match or lines[-1].rstrip("\r\n") != match.group(1):
                raise AssertionError("upload payload is not a fenced plaintext block")
            content = "".join(lines[1:-1])
            row = {"id": SOURCE_ID, "title": source_title, "status": "processing", "content": content}
            self.sources.setdefault(notebook_id, []).append(row)
            if self.add_timeout:
                self.add_timeout = False
                return 1, "", "request timed out after upload"
            return 0, json.dumps({"source": {"id": SOURCE_ID, "title": source_title}}), ""
        if command == ["source", "wait"]:
            source_id = args[2]
            notebook_id = args[args.index("-n") + 1]
            row = self._source(notebook_id, source_id)
            row["status"] = "ready"
            return 0, json.dumps({"source_id": source_id, "title": row["title"], "status": "ready"}), ""
        if command == ["source", "fulltext"]:
            source_id = args[2]
            notebook_id = args[args.index("-n") + 1]
            row = self._source(notebook_id, source_id)
            return 0, json.dumps({
                "source_id": source_id,
                "title": self.fulltext_title or row["title"],
                "content": self.fulltext_content if self.fulltext_content is not None else row["content"],
            }), ""
        raise AssertionError(f"unexpected CLI command: {args!r}")

    @staticmethod
    def assert_cli_argv(argv):
        assert argv[0] == "notebooklm"

    def _source(self, notebook_id, source_id):
        return next(row for row in self.sources[notebook_id] if row["id"] == source_id)


class NotebookLMHttpTests(unittest.TestCase):
    def sync(self, cli, data=None, *, state=None):
        events = []
        http.synchronize(data or request(), skill_root="/unused", state=state,
                         runner=cli, emit=events.append)
        return events

    def test_reuses_existing_notebook_and_adds_waits_and_verifies_fulltext(self):
        cli = FakeCLI([{"id": NOTEBOOK_ID, "title": http.TITLE.format(year=2026)}])
        events = self.sync(cli)
        self.assertEqual([event["event"] for event in events], ["notebook", "source"])
        self.assertEqual(events[0]["url"], f"https://notebook.google.com/notebook/{NOTEBOOK_ID}")
        commands = [call[1:] for call in cli.calls]
        source_list = next(command for command in commands if command[:2] == ["source", "list"])
        self.assertEqual(source_list, ["source", "list", "--json", "-n", NOTEBOOK_ID])
        self.assertIn(["source", "wait", SOURCE_ID, "-n", NOTEBOOK_ID,
                       "--timeout", "90", "--interval", "2", "--json"], commands)
        fulltext = next(command for command in commands if command[:2] == ["source", "fulltext"])
        self.assertEqual(fulltext, ["source", "fulltext", SOURCE_ID, "-n", NOTEBOOK_ID, "--json"])
        add = next(command for command in commands if command[:2] == ["source", "add"])
        self.assertEqual(add[add.index("--type") + 1], "file")
        self.assertEqual(add[add.index("--title") + 1], request()["sources"][0]["title"])
        self.assertEqual(add[add.index("-n") + 1], NOTEBOOK_ID)

    def test_creates_notebook_only_after_inventory_and_rechecks_uniqueness(self):
        cli = FakeCLI()
        events = self.sync(cli)
        names = [call[1:2] for call in cli.calls]
        self.assertEqual(names[:3], [["list"], ["create"], ["list"]])
        self.assertEqual(events[0]["url"], f"https://notebook.google.com/notebook/{OTHER_ID}")

    def test_file_upload_uses_fence_longer_than_source_backtick_runs(self):
        data = request()
        body = "Raw markdown and TeX stay literal.\n" + "`" * 5 + "\n\\frac{x}{y} $x$\n"
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        key = "daily-2026-01-p01"
        source = data["sources"][0]
        source.update({"key": key, "title": f"AL-{key}-{digest}.txt", "sha256": digest,
                       "text": f"ASTROLINEAGE_SOURCE_SHA256_{digest}\n{body}"})
        cli = FakeCLI([{"id": NOTEBOOK_ID, "title": http.TITLE.format(year=2026)}])
        self.sync(cli, data)
        fence = "`" * 6
        self.assertEqual(cli.upload_payloads, [f"{fence}text\n{source['text']}{fence}\n"])
        self.assertEqual(cli.sources[NOTEBOOK_ID][0]["content"], source["text"])
        add = next(call[1:] for call in cli.calls if call[1:3] == ["source", "add"])
        self.assertEqual(add[add.index("--type") + 1], "file")

    def test_fulltext_accepts_only_original_or_exact_google_fence_language_suffix(self):
        body = "# 2026-01\nEquation $\\frac{x}{y}$\n"
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        key = "daily-2026-01-p01"
        expected = f"ASTROLINEAGE_SOURCE_SHA256_{digest}\n{body}"
        source = {"key": key, "title": f"AL-{key}-{digest}.txt", "sha256": digest, "text": expected}

        for content in (expected, expected + "\ntext"):
            with self.subTest(content=content[-8:]):
                http._check_fulltext({"source_id": SOURCE_ID, "title": source["title"], "content": content},
                                     source, SOURCE_ID)

        for content in (
            expected.replace("\\frac", "frac"),
            expected[:-5],
            expected[len(f"ASTROLINEAGE_SOURCE_SHA256_{digest}\n"):],
            expected + "\nother",
        ):
            with self.subTest(rejected=content[-12:]):
                with self.assertRaisesRegex(http.SyncError, "NOTEBOOKLM_SOURCE_MISMATCH"):
                    http._check_fulltext({"source_id": SOURCE_ID, "title": source["title"], "content": content},
                                         source, SOURCE_ID)

    def test_duplicate_exact_annual_notebooks_fail_closed(self):
        title = http.TITLE.format(year=2026)
        cli = FakeCLI([{"id": NOTEBOOK_ID, "title": title}, {"id": OTHER_ID, "title": title}])
        with self.assertRaisesRegex(http.SyncError, "NOTEBOOKLM_DUPLICATE_ANNUAL_NOTEBOOKS"):
            self.sync(cli)
        self.assertEqual(len(cli.calls), 1)

    def test_supplied_uuid_must_resolve_to_the_expected_title(self):
        cli = FakeCLI([{"id": OTHER_ID, "title": "A different notebook"}])
        data = request(f"https://notebook.google.com/notebook/{OTHER_ID}")
        with self.assertRaisesRegex(http.SyncError, "NOTEBOOKLM_TITLE_MISMATCH"):
            self.sync(cli, data)
        self.assertEqual(len(cli.calls), 1)

    def test_existing_exact_title_with_tampered_content_or_title_fails_closed(self):
        source = request()["sources"][0]
        row = {"id": SOURCE_ID, "title": source["title"], "status": "ready", "content": source["text"]}
        for field in ("content", "title"):
            with self.subTest(field=field):
                cli = FakeCLI([{"id": NOTEBOOK_ID, "title": http.TITLE.format(year=2026)}],
                              {NOTEBOOK_ID: [row]})
                if field == "content":
                    cli.fulltext_content = source["text"] + "tampered"
                else:
                    cli.fulltext_title = "Other source title"
                with self.assertRaisesRegex(http.SyncError, "NOTEBOOKLM_SOURCE_MISMATCH"):
                    self.sync(cli)
                self.assertFalse(any(call[1:3] == ["source", "add"] for call in cli.calls))

    def test_exact_existing_source_is_reconciled_without_duplicate_add(self):
        source = request()["sources"][0]
        row = {"id": SOURCE_ID, "title": source["title"], "status": "ready", "content": source["text"]}
        cli = FakeCLI([{"id": NOTEBOOK_ID, "title": http.TITLE.format(year=2026)}],
                      {NOTEBOOK_ID: [row]})
        events = self.sync(cli)
        self.assertEqual(events[-1]["event"], "source")
        self.assertFalse(any(call[1:3] == ["source", "add"] for call in cli.calls))

    def test_existing_processing_source_is_waited_before_fulltext(self):
        source = request()["sources"][0]
        row = {"id": SOURCE_ID, "title": source["title"], "status": "processing", "content": source["text"]}
        cli = FakeCLI([{"id": NOTEBOOK_ID, "title": http.TITLE.format(year=2026)}],
                      {NOTEBOOK_ID: [row]})
        self.sync(cli)
        commands = [call[1:] for call in cli.calls]
        wait_index = next(i for i, command in enumerate(commands) if command[:2] == ["source", "wait"])
        fulltext_index = next(i for i, command in enumerate(commands) if command[:2] == ["source", "fulltext"])
        self.assertLess(wait_index, fulltext_index)

    def test_unknown_add_outcome_reconciles_on_the_next_run(self):
        cli = FakeCLI([{"id": NOTEBOOK_ID, "title": http.TITLE.format(year=2026)}], add_timeout=True)
        events = []
        with self.assertRaisesRegex(http.SyncError, "NOTEBOOKLM_UNKNOWN_OUTCOME"):
            http.synchronize(request(), skill_root="/unused", runner=cli, emit=events.append)
        self.assertEqual(events[-1]["event"], "notebook")
        self.assertEqual(sum(call[1:3] == ["source", "add"] for call in cli.calls), 1)
        retried = self.sync(cli)
        self.assertEqual(retried[-1]["event"], "source")
        self.assertEqual(sum(call[1:3] == ["source", "add"] for call in cli.calls), 1)

    def test_commands_are_http_cli_only_and_optional_storage_is_explicit(self):
        cli = FakeCLI([{"id": NOTEBOOK_ID, "title": http.TITLE.format(year=2026)}])
        self.sync(cli, state="/tmp/notebooklm-storage.json")
        for call in cli.calls:
            self.assertEqual(call[0], "notebooklm")
            self.assertEqual(call[1:3], ["--storage", "/tmp/notebooklm-storage.json"])
            self.assertFalse(any(token in {"login", "browser", "delete", "remove", "clean", "use"}
                                 for token in call))
        default_cli = FakeCLI([{"id": NOTEBOOK_ID, "title": http.TITLE.format(year=2026)}])
        self.sync(default_cli)
        self.assertTrue(all("--storage" not in call for call in default_cli.calls))

    def test_invalid_input_hash_and_url_are_rejected_before_cli(self):
        cli = FakeCLI()
        invalid = request()
        invalid["sources"][0]["text"] += "changed"
        with self.assertRaisesRegex(http.SyncError, "NOTEBOOKLM_EXPORT_INVALID"):
            self.sync(cli, invalid)
        with self.assertRaisesRegex(http.SyncError, "NOTEBOOKLM_INVALID_URL"):
            self.sync(cli, request("https://example.invalid/notebook/" + NOTEBOOK_ID))
        self.assertEqual(cli.calls, [])

    @unittest.skipUnless(os.name == "posix" and Path("/proc").is_dir(), "requires Linux process groups")
    def test_sigterm_handler_kills_the_cli_process_group(self):
        child_code = (
            "import subprocess,sys,time; "
            "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); "
            "print(child.pid,flush=True); time.sleep(60)"
        )
        process = subprocess.Popen([sys.executable, "-c", child_code], stdout=subprocess.PIPE,
                                    text=True, start_new_session=True)
        child_pid = int(process.stdout.readline())
        previous = http.ACTIVE_PROCESS
        http.ACTIVE_PROCESS = process
        try:
            with self.assertRaises(SystemExit):
                http._handle_shutdown(signal.SIGTERM, None)
        finally:
            http.ACTIVE_PROCESS = previous
            process.stdout.close()

        def child_running():
            try:
                return Path(f"/proc/{child_pid}/stat").read_text().split()[2] != "Z"
            except (FileNotFoundError, ProcessLookupError):
                return False

        for _ in range(50):
            if not child_running():
                break
            time.sleep(0.01)
        self.assertFalse(child_running())


if __name__ == "__main__":
    unittest.main()
