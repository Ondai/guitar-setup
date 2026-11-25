#!/usr/bin/env python3
"""Setup Bench server: serves the app and a small JSON API (accounts, toolbox, instruments, spec lookup).

Usage:  python3 server.py            (port 8000)
        python3 server.py 8080       (another port)

Data lives in setupbench.db next to this file. Spec lookup needs ANTHROPIC_API_KEY (see README).
"""
import hashlib
import hmac
import http.server
import json
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
from http import cookies
from pathlib import Path
from urllib.parse import urlparse

import lookup

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("SETUPBENCH_DB", ROOT / "setupbench.db"))
COOKIE = "sb_session"
SESSION_DAYS = 365
STATIC_BLOCK = re.compile(r"(^|/)\.|\.(py|db|db-journal|db-wal|txt|md)$|__pycache__")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")

_db_lock = threading.Lock()


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
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS toolbox (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            tools TEXT NOT NULL, custom TEXT NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS instruments (
            id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            data TEXT NOT NULL, updated REAL NOT NULL, PRIMARY KEY (user_id, id));
        CREATE TABLE IF NOT EXISTS lookups (
            key TEXT PRIMARY KEY, result TEXT NOT NULL, created REAL NOT NULL);
        """)


def hash_pw(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


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

    def send_json(self, status, body, set_cookie=None):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if set_cookie is not None:
            self.send_header("Set-Cookie", set_cookie)
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

    def session_user(self):
        jar = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        if COOKIE not in jar:
            return None
        with db() as c:
            row = c.execute("SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
                            (token_hash(jar[COOKIE].value),)).fetchone()
        return dict(row) if row else None

    def require_user(self):
        u = self.session_user()
        if not u:
            raise ApiError(401, "Please sign in.")
        return u

    def new_session_cookie(self, user_id):
        token = secrets.token_urlsafe(32)
        with db() as c:
            c.execute("INSERT INTO sessions VALUES (?, ?, ?)", (token_hash(token), user_id, time.time()))
        return f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_DAYS * 86400}"

    def api(self, method, path):
        try:
            # Same-origin guard for state-changing requests (blocks other sites posting with your cookie).
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
        "user": {"username": user["username"]},
        "toolbox": {"tools": json.loads(tb["tools"]), "custom": json.loads(tb["custom"]), "set": True} if tb else {"tools": [], "custom": [], "set": False},
        "lookupEnabled": lookup.available(),
    }


def r_status(h, _):
    h.send_json(200, {"lookupEnabled": lookup.available()})


def r_me(h, _):
    h.send_json(200, me_payload(h.require_user()))


def r_signup(h, _):
    b = h.body()
    username, password = str(b.get("username", "")).strip(), str(b.get("password", ""))
    if not USERNAME_RE.match(username):
        raise ApiError(400, "Usernames are 3–32 letters, numbers, dots, dashes or underscores.")
    if len(password) < 8:
        raise ApiError(400, "Use a password of at least 8 characters.")
    salt = secrets.token_bytes(16)
    try:
        with _db_lock, db() as c:
            cur = c.execute("INSERT INTO users (username, salt, pw_hash, created) VALUES (?, ?, ?, ?)",
                            (username, salt, hash_pw(password, salt), time.time()))
            uid = cur.lastrowid
    except sqlite3.IntegrityError:
        raise ApiError(409, "That username is taken.")
    user = {"id": uid, "username": username}
    h.send_json(200, me_payload(user), set_cookie=h.new_session_cookie(uid))


def r_login(h, _):
    b = h.body()
    username, password = str(b.get("username", "")).strip(), str(b.get("password", ""))
    with db() as c:
        row = c.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row or not hmac.compare_digest(row["pw_hash"], hash_pw(password, row["salt"])):
        time.sleep(0.5)
        raise ApiError(401, "Wrong username or password.")
    user = {"id": row["id"], "username": row["username"]}
    h.send_json(200, me_payload(user), set_cookie=h.new_session_cookie(row["id"]))


def r_logout(h, _):
    jar = cookies.SimpleCookie(h.headers.get("Cookie", ""))
    if COOKIE in jar:
        with db() as c:
            c.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(jar[COOKIE].value),))
    h.send_json(200, {"ok": True}, set_cookie=f"{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")


def r_toolbox(h, _):
    u = h.require_user()
    b = h.body()
    tools = [str(t)[:64] for t in b.get("tools", []) if isinstance(t, str)][:200]
    custom = [str(t).strip()[:120] for t in b.get("custom", []) if str(t).strip()][:200]
    with db() as c:
        c.execute("INSERT INTO toolbox VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET tools = excluded.tools, "
                  "custom = excluded.custom, updated = excluded.updated", (u["id"], json.dumps(tools), json.dumps(custom), time.time()))
    h.send_json(200, me_payload(u)["toolbox"])


def r_instruments(h, _):
    u = h.require_user()
    with db() as c:
        rows = c.execute("SELECT data FROM instruments WHERE user_id = ? ORDER BY updated DESC", (u["id"],)).fetchall()
    h.send_json(200, [json.loads(r["data"]) for r in rows])


def r_put_instrument(h, path):
    u = h.require_user()
    iid = path.rsplit("/", 1)[1]
    b = h.body()
    if not re.match(r"^[A-Za-z0-9_-]{4,40}$", iid) or b.get("id") != iid or b.get("type") not in ("electric", "acoustic", "bass") or not isinstance(b.get("spec"), dict):
        raise ApiError(400, "Invalid instrument.")
    with db() as c:
        c.execute("INSERT INTO instruments VALUES (?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, "
                  "updated = excluded.updated", (iid, u["id"], json.dumps(b), time.time()))
    h.send_json(200, {"ok": True})


def r_delete_instrument(h, path):
    u = h.require_user()
    with db() as c:
        c.execute("DELETE FROM instruments WHERE user_id = ? AND id = ?", (u["id"], path.rsplit("/", 1)[1]))
    h.send_json(200, {"ok": True})


def r_lookup(h, _):
    h.require_user()
    b = h.body()
    type_, query = b.get("type"), " ".join(str(b.get("query", "")).split())
    key = f"{type_}:{query.lower()}"
    if not b.get("refresh"):
        with db() as c:
            row = c.execute("SELECT result FROM lookups WHERE key = ?", (key,)).fetchone()
        if row:
            return h.send_json(200, {**json.loads(row["result"]), "cached": True})
    if not lookup.available():
        raise ApiError(503, "Spec lookup isn't set up on the server. See the README to add an API key, or enter the specs yourself.")
    try:
        result = lookup.lookup(type_, query)
    except lookup.LookupError_ as e:
        raise ApiError(502, str(e))
    with db() as c:
        c.execute("INSERT OR REPLACE INTO lookups VALUES (?, ?, ?)", (key, json.dumps(result), time.time()))
    h.send_json(200, result)


ROUTES = {
    ("GET", "/api/status"): r_status,
    ("GET", "/api/me"): r_me,
    ("POST", "/api/signup"): r_signup,
    ("POST", "/api/login"): r_login,
    ("POST", "/api/logout"): r_logout,
    ("PUT", "/api/toolbox"): r_toolbox,
    ("GET", "/api/instruments"): r_instruments,
    ("PUT", "/api/instruments/:id"): r_put_instrument,
    ("DELETE", "/api/instruments/:id"): r_delete_instrument,
    ("POST", "/api/lookup"): r_lookup,
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


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    init_db()
    with http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler) as httpd:
        print("Setup Bench is running.")
        print(f"  On this computer:  http://localhost:{port}")
        print(f"  On your iPad:      http://{lan_ip()}:{port}   (same Wi-Fi)")
        print(f"  Spec lookup:       {'on' if lookup.available() else 'off (set ANTHROPIC_API_KEY to enable)'}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
