"""The clip engine's front door: the website sends a job here, and each job runs in its own process.

  GET  /health            is it up, and how many jobs are running
  POST /jobs              start a job (Authorization: Bearer ENGINE_SECRET), body described in runner.py

Settings: ENGINE_SECRET (required), PORT (8080), ENGINE_MAX_JOBS (2), ENGINE_ONE_SHOT=1 to exit when the
last job finishes (used on Cloudflare, where one container is started per job and stops when it is done).
"""
import hmac
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SECRET = os.environ.get("ENGINE_SECRET", "")
MAX_JOBS = int(os.environ.get("ENGINE_MAX_JOBS", "2"))
ONE_SHOT = os.environ.get("ENGINE_ONE_SHOT") == "1"

_running: dict = {}
_lock = threading.Lock()
_started = time.time()


def _alive() -> int:
    with _lock:
        for jid in [j for j, p in _running.items() if p.poll() is not None]:
            _running.pop(jid)
        return len(_running)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "running": _alive()})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/jobs":
            return self._send(404, {"error": "not found"})
        given = self.headers.get("authorization", "")
        if not SECRET or not hmac.compare_digest(given, "Bearer " + SECRET):
            return self._send(401, {"error": "unauthorized"})
        try:
            spec = json.loads(self.rfile.read(min(int(self.headers.get("content-length", "0")), 1_000_000)))
            for k in ("id", "url", "callback", "token"):   # an edit also carries "job" and "clip"; the runner checks those
                if not isinstance(spec.get(k), str) or not spec[k]:
                    raise ValueError(k)
        except (ValueError, TypeError):
            return self._send(400, {"error": "bad job"})
        if _alive() >= MAX_JOBS:
            return self._send(429, {"error": "busy"})
        fd, path = tempfile.mkstemp(prefix="job-", suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:      # 0600: it holds an AI key until the runner reads it
            json.dump(spec, f)
        proc = subprocess.Popen([sys.executable, str(HERE / "runner.py"), path], cwd=str(HERE))
        with _lock:
            _running[spec["id"]] = proc
        self._send(202, {"ok": True})

    def log_message(self, *a):   # quiet: jobs print their own errors
        pass


def _stop_when_idle(server):
    """One container per job: once it has had a job and none is left, stop, so nothing is billed for idling."""
    had = False
    while True:
        time.sleep(5)
        n = _alive()
        had = had or n > 0
        if (had and n == 0) or (not had and time.time() - _started > 600):
            server.shutdown()
            return


if __name__ == "__main__":
    if not SECRET:
        sys.exit("ENGINE_SECRET is not set")
    srv = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler)
    if ONE_SHOT:
        threading.Thread(target=_stop_when_idle, args=(srv,), daemon=True).start()
    print(f"clip engine on :{srv.server_address[1]}", flush=True)
    srv.serve_forever()
