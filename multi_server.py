#!/usr/bin/env python3

"""
Ultra-simple multiplayer presence server for RabbitWine.

Clients POST their current state to /update and receive a snapshot of everyone else.
In-memory only, 3-second TTL, no auth.

Run: python .\\multi_server.py
Listens on 0.0.0.0:42666
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import time
import threading
import ssl
import argparse

HOST = "0.0.0.0"
PORT = 42666
TTL_MS = 3000
MAX_BODY = 4096

players: dict[str, dict] = {}
lock = threading.Lock()

ALLOWED_STATES = {"good", "ball"}


def now_ms() -> int:
    return int(time.time() * 1000)


def sweep_locked(ts: int) -> None:
    dead = [pid for pid, p in players.items() if ts - p.get("lastSeen", 0) > TTL_MS]
    for pid in dead:
        players.pop(pid, None)


class Handler(BaseHTTPRequestHandler):
    server_version = "RWMulti/1.0"

    def _send_json(self, code: int, obj: dict):
        body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        # CORS preflight
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            ts = now_ms()
            with lock:
                sweep_locked(ts)
                count = len(players)
            return self._send_json(200, {"status": "ok", "players": count, "now": ts, "ttlMs": TTL_MS})
        self._send_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/update":
            print(f"[WARN] POST {self.path} from {self.client_address[0]} -> 404", flush=True)
            return self._send_json(404, {"error": "not_found"})

        try:
            length = int(self.headers.get("Content-Length", 0))
        except Exception:
            length = 0
        if length <= 0 or length > MAX_BODY:
            print(f"[ERR] invalid_length from {self.client_address[0]} len={length}", flush=True)
            return self._send_json(400, {"error": "invalid_length"})

        try:
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
        except Exception as e:
            print(f"[ERR] invalid_json from {self.client_address[0]} len={length} err={e}", flush=True)
            return self._send_json(400, {"error": "invalid_json"})

        pid = data.get("id")
        pos = data.get("pos") or {}
        state = data.get("state")
        rotation = data.get("rotation")
        frozen = bool(data.get("frozen", False))

        # Validate
        if not isinstance(pid, str) or len(pid) < 8:
            print(f"[ERR] invalid_id from {self.client_address[0]} body={data}", flush=True)
            return self._send_json(400, {"error": "invalid_id"})
        try:
            x = float(pos.get("x"))
            y = float(pos.get("y"))
            z = float(pos.get("z", 0))
        except Exception as e:
            print(f"[ERR] invalid_pos from {self.client_address[0]} body={data} err={e}", flush=True)
            return self._send_json(400, {"error": "invalid_pos"})
        if state not in ALLOWED_STATES:
            print(f"[ERR] invalid_state from {self.client_address[0]} state={state}", flush=True)
            return self._send_json(400, {"error": "invalid_state"})
        if state == "ball":
            try:
                rotation = float(rotation) % 360.0
            except Exception as e:
                print(f"[ERR] rotation_required from {self.client_address[0]} body={data} err={e}", flush=True)
                return self._send_json(400, {"error": "rotation_required"})
        else:
            rotation = None

        ts = now_ms()
        sender_ip = self.client_address[0]

        with lock:
            players[pid] = {
                "pos": {"x": x, "y": y, "z": z},
                "state": state,
                "rotation": rotation,
                "frozen": frozen,
                "lastSeen": ts,
                "ip": sender_ip,
            }
            sweep_locked(ts)
            out = []
            for oid, p in players.items():
                if oid == pid:
                    continue
                age = max(0, ts - p.get("lastSeen", ts))
                entry = {
                    "id": oid,
                    "pos": p["pos"],
                    "state": p["state"],
                    "ageMs": age,
                }
                if p.get("frozen"):
                    entry["frozen"] = True
                if p["state"] == "ball" and p.get("rotation") is not None:
                    entry["rotation"] = p["rotation"]
                out.append(entry)

            # Console log for observability
            try:
                print(
                    f"[{ts}] UPDATE from {sender_ip} id={pid} pos=({x:.2f},{y:.2f},{z:.2f}) "
                    f"state={state} rotation={(rotation if rotation is not None else '-')} frozen={frozen} "
                    f"known={len(players)} -> responding others={len(out)}",
                    flush=True,
                )
            except Exception:
                pass

        self._send_json(200, {"now": ts, "ttlMs": TTL_MS, "players": out})

    def log_message(self, fmt, *args):
        # Quieter logs
        return


if __name__ == "__main__":
        parser = argparse.ArgumentParser(description="RabbitWine ultra-simple multiplayer server")
        parser.add_argument("--host", default=HOST, help="Bind host (default 0.0.0.0)")
        parser.add_argument("--port", type=int, default=PORT, help="Bind port (default 42666)")
        parser.add_argument("--cert", help="TLS certificate file (PEM)")
        parser.add_argument("--key", help="TLS private key file (PEM)")
        args = parser.parse_args()

        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
        scheme = "http"
        if args.cert and args.key:
            try:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                context.load_cert_chain(certfile=args.cert, keyfile=args.key)
                httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
                scheme = "https"
            except Exception as e:
                print(f"[WARN] Failed to enable TLS: {e}. Continuing without TLS.")
                scheme = "http"

        print(f"Serving on {scheme}://{args.host}:{args.port} (TTL={TTL_MS}ms)")
        try:
                httpd.serve_forever(poll_interval=0.25)
        except KeyboardInterrupt:
                print("\nShutting down...")
                httpd.shutdown()
