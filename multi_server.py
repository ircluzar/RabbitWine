#!/usr/bin/env python3

"""
Ultra-simple multiplayer presence server for RabbitWine (WebSocket version).

Switches from HTTP polling to a single WebSocket per client.
Clients send periodic "update" messages; the server broadcasts to all peers
and sends an initial snapshot on connect. In-memory only, 3-second TTL, no auth.

Run: python .\multi_server.py
Listens on 0.0.0.0:42666 (ws://), optional TLS via --cert/--key for wss://
Requires: websockets (pip install websockets)
"""

import asyncio
import json
import ssl
import time
import argparse
from typing import Dict, Any, Set

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
except Exception as e:
    raise SystemExit("Missing dependency: websockets. Install with 'pip install websockets'")

HOST = "0.0.0.0"
PORT = 42666
TTL_MS = 3000

ALLOWED_STATES = {"good", "ball"}

# Shared state
players: Dict[str, Dict[str, Any]] = {}
connections: Set[WebSocketServerProtocol] = set()
ws_to_id: Dict[WebSocketServerProtocol, str] = {}
lock = asyncio.Lock()


def now_ms() -> int:
    return int(time.time() * 1000)


async def sweep(ts: int) -> None:
    async with lock:
        dead = [pid for pid, p in players.items() if ts - p.get("lastSeen", 0) > TTL_MS]
        for pid in dead:
            players.pop(pid, None)


async def broadcast(obj: Dict[str, Any]) -> None:
    if not connections:
        return
    msg = json.dumps(obj, separators=(",", ":"))
    dead: Set[WebSocketServerProtocol] = set()
    awaitables = []
    for ws in connections:
        awaitables.append(ws.send(msg))
    # Send concurrently; collect failures
    results = await asyncio.gather(*awaitables, return_exceptions=True)
    for ws, res in zip(list(connections), results):
        if isinstance(res, Exception):
            dead.add(ws)
    for ws in dead:
        try:
            connections.discard(ws)
            ws_to_id.pop(ws, None)
        except Exception:
            pass


def validate_update(data: Dict[str, Any]) -> Dict[str, Any]:
    pid = data.get("id")
    pos = data.get("pos") or {}
    state = data.get("state")
    rotation = data.get("rotation")
    frozen = bool(data.get("frozen", False))

    if not isinstance(pid, str) or len(pid) < 8:
        raise ValueError("invalid_id")
    try:
        x = float(pos.get("x"))
        y = float(pos.get("y"))
        z = float(pos.get("z", 0))
    except Exception:
        raise ValueError("invalid_pos")
    if state not in ALLOWED_STATES:
        raise ValueError("invalid_state")
    if state == "ball":
        try:
            rotation = float(rotation) % 360.0
        except Exception:
            raise ValueError("rotation_required")
    else:
        rotation = None
    return {
        "id": pid,
        "x": x,
        "y": y,
        "z": z,
        "state": state,
        "rotation": rotation,
        "frozen": frozen,
    }


async def handle_client(ws: WebSocketServerProtocol, path: str):
    # Register connection
    connections.add(ws)
    peer = ws.remote_address[0] if ws.remote_address else "?"
    pid = None
    print(f"[WS] connect from {peer}")
    try:
        # Expect messages; allow 'hello' and 'update'
        async for raw in ws:
            try:
                data = json.loads(raw)
            except Exception:
                continue
            typ = data.get("type") or "update"

            if typ == "hello":
                pid = data.get("id")
                if not isinstance(pid, str) or len(pid) < 8:
                    await ws.close(code=1002, reason="invalid_id")
                    return
                ws_to_id[ws] = pid
                # Send initial snapshot (others only)
                ts = now_ms()
                await sweep(ts)
                async with lock:
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
                snap = {"type": "snapshot", "now": ts, "ttlMs": TTL_MS, "players": out}
                await ws.send(json.dumps(snap, separators=(",", ":")))
                continue

            if typ == "update":
                try:
                    v = validate_update(data)
                except ValueError as e:
                    # Close on malformed updates
                    await ws.close(code=1003, reason=str(e))
                    return
                ts = now_ms()
                # Update shared state
                async with lock:
                    players[v["id"]] = {
                        "pos": {"x": v["x"], "y": v["y"], "z": v["z"]},
                        "state": v["state"],
                        "rotation": v["rotation"],
                        "frozen": v["frozen"],
                        "lastSeen": ts,
                        "ip": peer,
                    }
                await sweep(ts)
                # Broadcast compact update
                msg = {
                    "type": "update",
                    "now": ts,
                    "id": v["id"],
                    "pos": {"x": v["x"], "y": v["y"], "z": v["z"]},
                    "state": v["state"],
                }
                if v["frozen"]:
                    msg["frozen"] = True
                if v["state"] == "ball" and v["rotation"] is not None:
                    msg["rotation"] = v["rotation"]

                try:
                    print(
                        f"[{ts}] UPDATE from {peer} id={v['id']} pos=({v['x']:.2f},{v['y']:.2f},{v['z']:.2f}) "
                        f"state={v['state']} rotation={(v['rotation'] if v['rotation'] is not None else '-')} frozen={v['frozen']} "
                        f"known={len(players)} -> broadcast",
                        flush=True,
                    )
                except Exception:
                    pass

                await broadcast(msg)

            # Optional: handle client ping messages
            elif typ == "ping":
                ts = now_ms()
                await ws.send(json.dumps({"type": "pong", "now": ts}, separators=(",", ":")))

    except websockets.ConnectionClosed:
        pass
    finally:
        connections.discard(ws)
        ws_to_id.pop(ws, None)
        print(f"[WS] disconnect {peer}")


async def main():
    parser = argparse.ArgumentParser(description="RabbitWine ultra-simple multiplayer server (WebSocket)")
    parser.add_argument("--host", default=HOST, help="Bind host (default 0.0.0.0)")
    parser.add_argument("--port", type=int, default=PORT, help="Bind port (default 42666)")
    parser.add_argument("--cert", help="TLS certificate file (PEM)")
    parser.add_argument("--key", help="TLS private key file (PEM)")
    args = parser.parse_args()

    ssl_ctx = None
    scheme = "ws"
    if args.cert and args.key:
        try:
            ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_ctx.load_cert_chain(certfile=args.cert, keyfile=args.key)
            scheme = "wss"
        except Exception as e:
            print(f"[WARN] Failed to enable TLS: {e}. Continuing without TLS.")
            ssl_ctx = None
            scheme = "ws"

    print(f"Serving on {scheme}://{args.host}:{args.port} (TTL={TTL_MS}ms)")
    async with websockets.serve(handle_client, args.host, args.port, ssl=ssl_ctx, ping_interval=20, ping_timeout=20):
        try:
            while True:
                await asyncio.sleep(60)
                await sweep(now_ms())
        except asyncio.CancelledError:
            pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutting down...")
