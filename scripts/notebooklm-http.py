#!/usr/bin/env python3
"""Synchronize one annual AstroLineage bundle through notebooklm-py's CLI."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import tempfile
import time

TITLE = "AstroLineage｜{year} 精读日报与周报"
MAX_SOURCE_BYTES = 1_001_000
MAX_CLI_OUTPUT = 8_000_000
CLI_TIMEOUT = 90
ACTIVE_PROCESS = None
NOTEBOOK_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z")
NOTEBOOK_URL = re.compile(r"https://(?:notebook|notebooklm)\.google\.com/notebook/([0-9a-fA-F-]{36})\Z")
SOURCE_KEY = re.compile(r"(?:daily|weekly)-(\d{4})-(\d{2})-p(\d{2})\Z")


class SyncError(Exception):
    def __init__(self, code):
        self.code = code


def validate_request(data):
    if not isinstance(data, dict):
        raise SyncError("NOTEBOOKLM_EXPORT_INVALID")
    year = data.get("year")
    if isinstance(year, bool) or not isinstance(year, int) or not 1900 <= year <= 9999:
        raise SyncError("NOTEBOOKLM_EXPORT_INVALID")
    notebook_url = data.get("notebook_url")
    notebook_id = None
    if notebook_url is not None:
        match = NOTEBOOK_URL.fullmatch(notebook_url) if isinstance(notebook_url, str) else None
        if not match or not NOTEBOOK_ID.fullmatch(match.group(1)):
            raise SyncError("NOTEBOOKLM_INVALID_URL")
        notebook_id = match.group(1).lower()
    sources = data.get("sources")
    if not isinstance(sources, list) or len(sources) > 100:
        raise SyncError("NOTEBOOKLM_EXPORT_INVALID")
    seen = set()
    for source in sources:
        if not isinstance(source, dict):
            raise SyncError("NOTEBOOKLM_EXPORT_INVALID")
        key, title, digest, content = (source.get(name) for name in ("key", "title", "sha256", "text"))
        key_match = SOURCE_KEY.fullmatch(key) if isinstance(key, str) else None
        try:
            content_bytes = content.encode("utf-8") if isinstance(content, str) else b""
        except UnicodeEncodeError:
            raise SyncError("NOTEBOOKLM_EXPORT_INVALID") from None
        if (not key_match or int(key_match.group(1)) != year
                or not 1 <= int(key_match.group(2)) <= 12
                or not 1 <= int(key_match.group(3)) <= 99
                or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest)
                or title != f"AL-{key}-{digest}.txt"
                or not isinstance(content, str) or len(content_bytes) > MAX_SOURCE_BYTES):
            raise SyncError("NOTEBOOKLM_EXPORT_INVALID")
        marker = f"ASTROLINEAGE_SOURCE_SHA256_{digest}\n"
        if (not content.startswith(marker)
                or hashlib.sha256(content[len(marker):].encode("utf-8")).hexdigest() != digest
                or key in seen):
            raise SyncError("NOTEBOOKLM_EXPORT_INVALID")
        seen.add(key)
    return year, notebook_url, notebook_id, sources


def _stop_process(process):
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        pass


def run_cli(argv, *, skill_root):
    """Run the skill's maintained CLI with time and output bounds."""
    run_py = Path(skill_root) / "scripts" / "run.py"
    if not run_py.is_file():
        raise SyncError("NOTEBOOKLM_RUNTIME_UNAVAILABLE")
    previous_handler = signal.signal(signal.SIGTERM, _handle_shutdown)
    try:
        process = subprocess.Popen(
            [sys.executable, str(run_py), *argv],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=(os.name == "posix"),
        )
    except OSError:
        signal.signal(signal.SIGTERM, previous_handler)
        raise SyncError("NOTEBOOKLM_RUNTIME_UNAVAILABLE") from None
    global ACTIVE_PROCESS
    ACTIVE_PROCESS = process

    selector = selectors.DefaultSelector()
    outputs = {process.stdout: bytearray(), process.stderr: bytearray()}
    total = 0
    for stream in outputs:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)
    deadline = time.monotonic() + CLI_TIMEOUT
    try:
        while selector.get_map() or process.poll() is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _stop_process(process)
                raise SyncError("NOTEBOOKLM_TIMEOUT")
            for key, _ in selector.select(min(remaining, 0.25)):
                chunk = os.read(key.fd, 8192)
                if not chunk:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                total += len(chunk)
                if total > MAX_CLI_OUTPUT:
                    _stop_process(process)
                    raise SyncError("NOTEBOOKLM_OUTPUT_LIMIT")
                outputs[key.fileobj].extend(chunk)
        return (process.returncode,
                bytes(outputs[process.stdout]).decode("utf-8", errors="replace"),
                bytes(outputs[process.stderr]).decode("utf-8", errors="replace"))
    finally:
        selector.close()
        for stream in outputs:
            if not stream.closed:
                stream.close()
        if process.poll() is None:
            _stop_process(process)
        ACTIVE_PROCESS = None
        signal.signal(signal.SIGTERM, previous_handler)


def _handle_shutdown(signum, _frame):
    if ACTIVE_PROCESS is not None:
        _stop_process(ACTIVE_PROCESS)
    raise SystemExit(128 + signum)


def _auth_error(stderr):
    diagnostic = stderr.lower()
    return any(token in diagnostic for token in (
        "authentication required", "not authenticated", "unauthorized", "unauthenticated",
        "login required", "401", "cookie", "authentication",
    ))


def _command(runner, argv, *, mutation=False, waiting=False):
    try:
        result = runner(argv)
    except SyncError as error:
        if mutation and error.code in ("NOTEBOOKLM_TIMEOUT", "NOTEBOOKLM_OUTPUT_LIMIT"):
            raise SyncError("NOTEBOOKLM_UNKNOWN_OUTCOME") from None
        raise
    except Exception:
        if mutation:
            raise SyncError("NOTEBOOKLM_UNKNOWN_OUTCOME") from None
        raise SyncError("NOTEBOOKLM_CLI_FAILED") from None
    if not isinstance(result, tuple) or len(result) != 3:
        raise SyncError("NOTEBOOKLM_INVALID_RESPONSE")
    code, stdout, stderr = result
    if not isinstance(stdout, str) or not isinstance(stderr, str):
        raise SyncError("NOTEBOOKLM_INVALID_RESPONSE")
    if code != 0:
        if _auth_error(stderr):
            raise SyncError("NOTEBOOKLM_AUTH_REQUIRED")
        if waiting:
            try:
                response = json.loads(stdout)
            except (TypeError, json.JSONDecodeError):
                response = None
            if isinstance(response, dict) and response.get("status") == "timeout":
                raise SyncError("NOTEBOOKLM_TIMEOUT")
            raise SyncError("NOTEBOOKLM_SOURCE_MISMATCH")
        raise SyncError("NOTEBOOKLM_UNKNOWN_OUTCOME" if mutation else "NOTEBOOKLM_CLI_FAILED")
    try:
        return json.loads(stdout)
    except (TypeError, json.JSONDecodeError):
        raise SyncError("NOTEBOOKLM_UNKNOWN_OUTCOME" if mutation else "NOTEBOOKLM_INVALID_RESPONSE") from None


def _valid_notebooks(payload):
    notebooks = payload.get("notebooks") if isinstance(payload, dict) else None
    if not isinstance(notebooks, list):
        raise SyncError("NOTEBOOKLM_INVALID_RESPONSE")
    for notebook in notebooks:
        if (not isinstance(notebook, dict) or not isinstance(notebook.get("id"), str)
                or not NOTEBOOK_ID.fullmatch(notebook["id"])
                or not isinstance(notebook.get("title"), str)):
            raise SyncError("NOTEBOOKLM_INVALID_RESPONSE")
    return notebooks


def _exact_notebook(notebooks, title):
    matches = [notebook for notebook in notebooks if notebook["title"] == title]
    if len(matches) > 1:
        raise SyncError("NOTEBOOKLM_DUPLICATE_ANNUAL_NOTEBOOKS")
    return matches[0] if matches else None


def _notebook_id(requested_id, title, runner):
    listed = _valid_notebooks(_command(runner, ["list", "--json"]))
    exact = _exact_notebook(listed, title)
    if requested_id is not None:
        match = next((notebook for notebook in listed if notebook["id"].lower() == requested_id), None)
        if match is None or match["title"] != title:
            raise SyncError("NOTEBOOKLM_TITLE_MISMATCH")
        return match["id"].lower()
    if exact is not None:
        return exact["id"].lower()

    created = _command(runner, ["create", title, "--json"], mutation=True)
    notebook = created.get("notebook") if isinstance(created, dict) else None
    if (not isinstance(notebook, dict) or not isinstance(notebook.get("id"), str)
            or not NOTEBOOK_ID.fullmatch(notebook["id"])):
        raise SyncError("NOTEBOOKLM_UNKNOWN_OUTCOME")
    if notebook.get("title") != title:
        raise SyncError("NOTEBOOKLM_TITLE_MISMATCH")
    refreshed = _valid_notebooks(_command(runner, ["list", "--json"]))
    verified = _exact_notebook(refreshed, title)
    if verified is None or verified["id"].lower() != notebook["id"].lower():
        raise SyncError("NOTEBOOKLM_TITLE_MISMATCH")
    return notebook["id"].lower()


def _source_rows(payload, notebook_id):
    rows = payload.get("sources") if isinstance(payload, dict) else None
    payload_notebook_id = payload.get("notebook_id", notebook_id) if isinstance(payload, dict) else None
    if (not isinstance(rows, list) or not isinstance(payload_notebook_id, str)
            or payload_notebook_id.lower() != notebook_id.lower()):
        raise SyncError("NOTEBOOKLM_INVALID_RESPONSE")
    for row in rows:
        if (not isinstance(row, dict) or not isinstance(row.get("id"), str)
                or not NOTEBOOK_ID.fullmatch(row["id"])
                or not isinstance(row.get("title"), str)
                or not isinstance(row.get("status"), str)):
            raise SyncError("NOTEBOOKLM_INVALID_RESPONSE")
    return rows


def _check_fulltext(payload, source, source_id):
    fulltext = payload if isinstance(payload, dict) else {}
    marker = f"ASTROLINEAGE_SOURCE_SHA256_{source['sha256']}\n"
    content = fulltext.get("content")
    fulltext_id = fulltext.get("source_id")
    expected = source["text"]
    if content == expected + "\ntext":
        content = expected
    if (not isinstance(fulltext_id, str) or fulltext_id.lower() != source_id.lower()
            or fulltext.get("title") != source["title"]
            or not isinstance(content, str) or content != expected or not content.startswith(marker)
            or hashlib.sha256(content[len(marker):].encode("utf-8")).hexdigest() != source["sha256"]):
        raise SyncError("NOTEBOOKLM_SOURCE_MISMATCH")


def _literal_upload(content):
    longest = max((len(run.group()) for run in re.finditer(r"`+", content)), default=0)
    fence = "`" * max(3, longest + 1)
    separator = "" if content.endswith("\n") else "\n"
    return f"{fence}text\n{content}{separator}{fence}\n"


def _verified_source(source, notebook_id, runner, *, existing=None):
    if existing is None:
        with tempfile.TemporaryDirectory(prefix="astro-lineage-notebooklm-") as folder:
            path = Path(folder) / source["title"]
            path.write_text(_literal_upload(source["text"]), encoding="utf-8")
            added = _command(runner, [
                "source", "add", str(path), "--type", "file", "--title", source["title"],
                "-n", notebook_id, "--json",
            ], mutation=True)
        added_source = added.get("source") if isinstance(added, dict) else None
        source_id = added_source.get("id") if isinstance(added_source, dict) else None
        if (not isinstance(source_id, str) or not NOTEBOOK_ID.fullmatch(source_id)
                or added_source.get("title") != source["title"]):
            raise SyncError("NOTEBOOKLM_UNKNOWN_OUTCOME")
        wait = _command(runner, ["source", "wait", source_id, "-n", notebook_id,
                                 "--timeout", "90", "--interval", "2", "--json"], waiting=True)
        wait_id = wait.get("source_id") if isinstance(wait, dict) else None
        if (not isinstance(wait, dict) or wait.get("status") != "ready"
                or not isinstance(wait_id, str) or wait_id.lower() != source_id.lower()
                or wait.get("title") != source["title"]):
            raise SyncError("NOTEBOOKLM_SOURCE_MISMATCH")
    else:
        source_id = existing["id"]
        if existing["status"] != "ready":
            wait = _command(runner, ["source", "wait", source_id, "-n", notebook_id,
                                     "--timeout", "90", "--interval", "2", "--json"], waiting=True)
            wait_id = wait.get("source_id") if isinstance(wait, dict) else None
            if (not isinstance(wait, dict) or wait.get("status") != "ready"
                    or not isinstance(wait_id, str) or wait_id.lower() != source_id.lower()
                    or wait.get("title") != source["title"]):
                raise SyncError("NOTEBOOKLM_SOURCE_MISMATCH")
    fulltext = _command(runner, ["source", "fulltext", source_id, "-n", notebook_id, "--json"])
    _check_fulltext(fulltext, source, source_id)


def synchronize(data, *, skill_root, state=None, runner=None, emit=None):
    year, notebook_url, requested_id, sources = validate_request(data)
    title = TITLE.format(year=year)
    if runner is None:
        runner = lambda args: run_cli(args, skill_root=skill_root)
    if emit is None:
        emit = lambda event: None
    cli_prefix = [] if state is None else ["--storage", str(state)]

    def scoped_runner(args):
        return runner(["notebooklm", *cli_prefix, *args])

    notebook_id = _notebook_id(requested_id, title, scoped_runner)
    url = f"https://notebook.google.com/notebook/{notebook_id}"
    emit({"event": "notebook", "year": year, "url": url})

    for source in sources:
        rows = _source_rows(_command(scoped_runner, ["source", "list", "--json", "-n", notebook_id]), notebook_id)
        matches = [row for row in rows if row["title"] == source["title"]]
        if len(matches) > 1:
            raise SyncError("NOTEBOOKLM_SOURCE_MISMATCH")
        _verified_source(source, notebook_id, scoped_runner, existing=matches[0] if matches else None)
        emit({"event": "source", "year": year, "key": source["key"],
              "sha256": source["sha256"], "title": source["title"]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skill-root", type=Path, required=True)
    parser.add_argument("--state", type=Path)
    args = parser.parse_args()
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        synchronize(data, skill_root=args.skill_root, state=args.state,
                    emit=lambda event: print(json.dumps(event, ensure_ascii=False), flush=True))
    except SyncError as error:
        print(json.dumps({"event": "error", "code": error.code}), flush=True)
        sys.exit(1)
    except (UnicodeDecodeError, json.JSONDecodeError):
        print(json.dumps({"event": "error", "code": "NOTEBOOKLM_EXPORT_INVALID"}), flush=True)
        sys.exit(1)
    except Exception:
        print(json.dumps({"event": "error", "code": "NOTEBOOKLM_CLI_FAILED"}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
