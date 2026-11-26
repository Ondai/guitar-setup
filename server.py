#!/usr/bin/env python3
"""Setup Bench server: serves the app and a small JSON API (toolbox, instruments, model library).

Single-user, for a home network: there's no sign-in, everyone on the Wi-Fi shares one set of data.

Usage:  python3 server.py                     http://setupbench.local:8000
        python3 server.py 80                  http://setupbench.local  (no port in the address)
        python3 server.py --name guitars      http://guitars.local:8000
        python3 server.py --no-name           don't announce a .local name

Data lives in setupbench.db next to this file. Needs only the Python standard library.
"""
import http.server
import json
import os
import re
import socket
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import mdns

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("SETUPBENCH_DB", ROOT / "setupbench.db"))
STATIC_BLOCK = re.compile(r"(^|/)\.|\.(py|db|db-journal|db-wal|txt|md)$|__pycache__")
LOCAL_USER = None  # set by init_db(); every request acts as this user


# ---------- database ----------

def db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL,
            salt BLOB NOT NULL, pw_hash BLOB NOT NULL, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS toolbox (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            tools TEXT NOT NULL, custom TEXT NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS instruments (
            id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            data TEXT NOT NULL, updated REAL NOT NULL, PRIMARY KEY (user_id, id));
        CREATE TABLE IF NOT EXISTS models (
            key TEXT PRIMARY KEY, data TEXT NOT NULL, saved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated REAL NOT NULL);
        """)
        # Adopt the account with the most data from when the app had sign-in, so nothing is lost;
        # otherwise create the one local user.
        row = c.execute("""
            SELECT u.id, u.username,
                   (SELECT COUNT(*) FROM instruments i WHERE i.user_id = u.id) +
                   (SELECT COUNT(*) FROM toolbox t WHERE t.user_id = u.id) AS n
            FROM users u ORDER BY n DESC, u.id LIMIT 1""").fetchone()
        if not row:
            c.execute("INSERT INTO users (username, salt, pw_hash, created) VALUES ('local', x'', x'', ?)", (time.time(),))
            row = c.execute("SELECT id, username FROM users WHERE username = 'local'").fetchone()
    global LOCAL_USER
    LOCAL_USER = {"id": row["id"], "username": row["username"]}


# ---------- HTTP ----------

class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".json": "application/json"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    # static files, minus anything private
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self.api("GET", path)
        if STATIC_BLOCK.search(path):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if STATIC_BLOCK.search(urlparse(self.path).path):
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        self.api("POST", urlparse(self.path).path)

    def do_PUT(self):
        self.api("PUT", urlparse(self.path).path)

    def do_DELETE(self):
        self.api("DELETE", urlparse(self.path).path)

    # ---------- api plumbing ----------

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise ApiError(413, "Request too large.")
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            raise ApiError(400, "Invalid JSON.")

    def api(self, method, path):
        try:
            # Same-origin guard for state-changing requests (stops other websites you visit from editing your data).
            if method != "GET":
                origin = self.headers.get("Origin")
                if origin and urlparse(origin).netloc != self.headers.get("Host"):
                    raise ApiError(403, "Cross-origin request refused.")
            route = ROUTES.get((method, re.sub(r"^/api/instruments/[^/]+$", "/api/instruments/:id", path)))
            if not route:
                raise ApiError(404, "Not found.")
            route(self, path)
        except ApiError as e:
            self.send_json(e.status, {"error": e.message})
        except Exception as e:  # keep the server up; show a generic error
            print("Error:", repr(e), file=sys.stderr)
            self.send_json(500, {"error": "Something went wrong on the server."})


# ---------- routes ----------

def me_payload(user):
    with db() as c:
        tb = c.execute("SELECT tools, custom FROM toolbox WHERE user_id = ?", (user["id"],)).fetchone()
    return {
        "toolbox": {"tools": json.loads(tb["tools"]), "custom": json.loads(tb["custom"]), "set": True} if tb else {"tools": [], "custom": [], "set": False},
    }


def r_me(h, _):
    h.send_json(200, me_payload(LOCAL_USER))


def r_toolbox(h, _):
    u = LOCAL_USER
    b = h.body()
    tools = [str(t)[:64] for t in b.get("tools", []) if isinstance(t, str)][:200]
    custom = [str(t).strip()[:120] for t in b.get("custom", []) if str(t).strip()][:200]
    with db() as c:
        c.execute("INSERT INTO toolbox VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET tools = excluded.tools, "
                  "custom = excluded.custom, updated = excluded.updated", (u["id"], json.dumps(tools), json.dumps(custom), time.time()))
    h.send_json(200, me_payload(u)["toolbox"])


def r_instruments(h, _):
    u = LOCAL_USER
    with db() as c:
        rows = c.execute("SELECT data FROM instruments WHERE user_id = ? ORDER BY updated DESC", (u["id"],)).fetchall()
    h.send_json(200, [json.loads(r["data"]) for r in rows])


def r_put_instrument(h, path):
    u = LOCAL_USER
    iid = path.rsplit("/", 1)[1]
    b = h.body()
    if not re.match(r"^[A-Za-z0-9_-]{4,40}$", iid) or b.get("id") != iid or b.get("type") not in ("electric", "acoustic", "bass") or not isinstance(b.get("spec"), dict):
        raise ApiError(400, "Invalid instrument.")
    with db() as c:
        c.execute("INSERT INTO instruments VALUES (?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, "
                  "updated = excluded.updated", (iid, u["id"], json.dumps(b), time.time()))
    h.send_json(200, {"ok": True})


def r_delete_instrument(h, path):
    u = LOCAL_USER
    with db() as c:
        c.execute("DELETE FROM instruments WHERE user_id = ? AND id = ?", (u["id"], path.rsplit("/", 1)[1]))
    h.send_json(200, {"ok": True})


PRIVATE_SPEC_KEYS = {"nickname", "notes", "style", "climate"}  # personal, never shared into the library
SPEC_KEY_RE = re.compile(r"^[A-Za-z]{1,32}$")


def model_key(type_, make, model):
    norm = lambda t: re.sub(r"[^a-z0-9]+", " ", str(t).lower()).strip()
    return f"{type_}:{norm(make)}:{norm(model)}"


def r_models(h, _):
    with db() as c:
        rows = c.execute("SELECT m.data, m.updated, u.username FROM models m LEFT JOIN users u ON u.id = m.saved_by "
                         "ORDER BY m.updated DESC").fetchall()
    h.send_json(200, [{**json.loads(r["data"]), "savedBy": r["username"], "updated": r["updated"]} for r in rows])


def r_put_model(h, _):
    """Save checked specs into the shared library (one entry per type + make + model, latest wins)."""
    u = LOCAL_USER
    b = h.body()
    type_, make, model = b.get("type"), str(b.get("make", "")).strip()[:60], str(b.get("model", "")).strip()[:80]
    spec = b.get("spec")
    if type_ not in ("electric", "acoustic", "bass") or not model or not isinstance(spec, dict):
        raise ApiError(400, "A library entry needs a type, a model name and specs.")
    clean = {k: v for k, v in spec.items()
             if SPEC_KEY_RE.match(k) and k not in PRIVATE_SPEC_KEYS and isinstance(v, (str, int, float)) and len(str(v)) <= 200}
    key = model_key(type_, make, model)
    entry = {"id": "lib-" + re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")[:80], "type": type_, "make": make,
             "model": model, "aliases": [], "source": "saved", "spec": clean, "verify": [], "note": ""}
    with db() as c:
        c.execute("INSERT INTO models VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, "
                  "saved_by = excluded.saved_by, updated = excluded.updated", (key, json.dumps(entry), u["id"], time.time()))
    h.send_json(200, {"ok": True, "id": entry["id"]})


ROUTES = {
    ("GET", "/api/me"): r_me,
    ("PUT", "/api/toolbox"): r_toolbox,
    ("GET", "/api/instruments"): r_instruments,
    ("PUT", "/api/instruments/:id"): r_put_instrument,
    ("DELETE", "/api/instruments/:id"): r_delete_instrument,
    ("GET", "/api/models"): r_models,
    ("PUT", "/api/models"): r_put_model,
}


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; picks the outbound interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def parse_args(argv):
    port, name = 8000, "setupbench"
    args = list(argv)
    while args:
        a = args.pop(0)
        if a == "--name" and args:
            name = args.pop(0)
        elif a == "--no-name":
            name = None
        elif a.isdigit():
            port = int(a)
        else:
            sys.exit(f"Unknown option: {a}\n{__doc__}")
    if name and not re.match(r"^[A-Za-z0-9-]{1,63}$", name):
        sys.exit("--name takes letters, numbers and dashes only, e.g. --name setupbench")
    return port, name


if __name__ == "__main__":
    port, name = parse_args(sys.argv[1:])
    init_db()
    try:
        httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    except OSError as e:
        sys.exit(f"Couldn't start on port {port}: {e}\n"
                 + ("Something else is using port 80 — try the default: py server.py" if port == 80 else "Try another port, e.g. py server.py 8080"))
    ip = lan_ip()
    suffix = "" if port == 80 else f":{port}"
    alias_note = None
    if name:
        err = mdns.Responder(name, ip).start()
        alias_note = f"http://{name.lower()}.local{suffix}" if not err else f"(couldn't announce {name}.local: {err})"
    with httpd:
        print("Setup Bench is running.")
        if alias_note:
            print(f"  On your iPad:      {alias_note}")
            print(f"  Or by address:     http://{ip}{suffix}")
        else:
            print(f"  On your iPad:      http://{ip}{suffix}   (same Wi-Fi)")
        print(f"  On this computer:  http://localhost{suffix}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
