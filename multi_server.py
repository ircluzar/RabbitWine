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
import sqlite3
import re
from dataclasses import dataclass
from typing import Dict, Any, Set, Optional, Tuple, List

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
except Exception as e:
    raise SystemExit("Missing dependency: websockets. Install with 'pip install websockets'")

HOST = "0.0.0.0"
PORT = 42666
TTL_MS = 3000

# Toggle verbose per-position UPDATE logging (disabled to reduce console spam)
VERBOSE_UPDATES = False

ALLOWED_STATES = {"good", "ball"}
LEVEL_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
DEFAULT_DB_FILE = "rw_maps.db"

@dataclass
class Player:
    """Represents a connected player's last known state.

    Encapsulates repeated structures (pos/state/rotation/frozen/lastSeen) and
    provides helpers to format outgoing snapshot & update payloads consistently.
    """
    id: str
    x: float
    y: float
    z: float
    state: str
    rotation: Optional[float]
    frozen: bool
    last_seen: int
    ip: str
    channel: str
    level: str

    @property
    def pos(self) -> Dict[str, float]:
        return {"x": self.x, "y": self.y, "z": self.z}

    def to_update_message(self, ts: int) -> Dict[str, Any]:
        msg = {
            "type": "update",
            "now": ts,
            "id": self.id,
            "pos": self.pos,
            "state": self.state,
            "channel": self.channel,
            "level": self.level,
        }
        if self.frozen:
            msg["frozen"] = True
        if self.state == "ball" and self.rotation is not None:
            msg["rotation"] = self.rotation
        return msg

    def to_snapshot_entry(self, ts: int) -> Dict[str, Any]:
        age = max(0, ts - self.last_seen)
        entry = {
            "id": self.id,
            "pos": self.pos,
            "state": self.state,
            "ageMs": age,
            "channel": self.channel,
            "level": self.level,
        }
        if self.frozen:
            entry["frozen"] = True
        if self.state == "ball" and self.rotation is not None:
            entry["rotation"] = self.rotation
        return entry


# Shared server state (in-memory only)
players: Dict[str, Player] = {}
connections: Set[WebSocketServerProtocol] = set()
ws_to_id: Dict[WebSocketServerProtocol, str] = {}
# Map websocket -> (channel, level)
ws_meta: Dict[WebSocketServerProtocol, Tuple[str, str]] = {}
lock = asyncio.Lock()

# ---- Map diff / versioning with persistence (per-level) --------------------

@dataclass
class MapDiff:
    version: int
    # adds maps block key -> hazard flag (0 normal, 1 hazard/BAD)
    adds: Dict[str, int]
    removes: Set[str]

@dataclass
class MapItem:
    gx: int
    gy: int
    y: float
    kind: int   # 0 = payload (yellow), 1 = purple
    payload: str

# level_id -> List[MapItem]
level_items: Dict[str, List[MapItem]] = {}

# level_id -> MapDiff
level_diffs: Dict[str, MapDiff] = {}
# per-connection known version (single level at a time per connection)
ws_map_version: Dict[WebSocketServerProtocol, int] = {}

MAX_OPS_PER_BATCH = 512
KEY_MAX_LEN = 64

DB_PATH = None
_db_conn: Optional[sqlite3.Connection] = None

def db_init(path: str):
    global _db_conn
    _db_conn = sqlite3.connect(path, check_same_thread=False)
    _db_conn.execute(
        """
        CREATE TABLE IF NOT EXISTS map_diffs(
            level TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            adds TEXT NOT NULL,
            removes TEXT NOT NULL,
            updated INTEGER NOT NULL
        )
        """
    )
    _db_conn.execute(
        """
        CREATE TABLE IF NOT EXISTS map_items(
            level TEXT NOT NULL,
            gx INTEGER NOT NULL,
            gy INTEGER NOT NULL,
            y REAL NOT NULL,
            kind INTEGER NOT NULL,
            payload TEXT,
            PRIMARY KEY(level,gx,gy,kind,payload)
        )
        """
    )
    _db_conn.commit()

def db_load_all():
    if not _db_conn: return
    cur = _db_conn.execute("SELECT level, version, adds, removes FROM map_diffs")
    rows = cur.fetchall()
    for level, version, adds_json, removes_json in rows:
        try:
            raw_adds = json.loads(adds_json) if adds_json else []
            adds: Dict[str,int] = {}
            # Backward compatibility: entries either 'key' (normal) or 'key#1' (hazard)
            for ent in raw_adds:
                if not isinstance(ent, str):
                    continue
                if ent.endswith('#1'):
                    adds[ent[:-2]] = 1
                else:
                    adds[ent] = 0
            removes = set(json.loads(removes_json)) if removes_json else set()
            level_diffs[level] = MapDiff(version=version, adds=adds, removes=removes)
            print(f"[DB] Loaded level '{level}' v{version} adds={len(adds)} removes={len(removes)}")
        except Exception as e:
            print(f"[DB] Failed to load level '{level}': {e}")
    # Load items
    try:
        cur2 = _db_conn.execute("SELECT level,gx,gy,y,kind,payload FROM map_items")
        for level, gx, gy, y, kind, payload in cur2.fetchall():
            level_items.setdefault(level, []).append(MapItem(gx=gx, gy=gy, y=y, kind=int(kind or 0), payload=payload or ''))
        print(f"[DB] Loaded items for {len(level_items)} levels")
    except Exception as e:
        print(f"[DB] Failed to load items: {e}")

def db_persist_level(level: str, diff: MapDiff):
    if not _db_conn: return
    try:
        enc_adds = []
        for k, hz in diff.adds.items():
            enc_adds.append(f"{k}#1" if hz else k)
        _db_conn.execute(
            "REPLACE INTO map_diffs(level, version, adds, removes, updated) VALUES (?,?,?,?,?)",
            (level, diff.version, json.dumps(sorted(enc_adds)), json.dumps(sorted(diff.removes)), now_ms())
        )
        _db_conn.commit()
    except Exception as e:
        print(f"[DB] Persist error for level '{level}': {e}")

def db_upsert_item(level: str, item: MapItem):
    if not _db_conn: return
    try:
        _db_conn.execute(
            "REPLACE INTO map_items(level,gx,gy,y,kind,payload) VALUES (?,?,?,?,?,?)",
            (level, item.gx, item.gy, item.y, item.kind, item.payload)
        )
        _db_conn.commit()
    except Exception as e:
        print(f"[DB] item upsert fail: {e}")

def db_delete_item(level: str, gx: int, gy: int, kind: int, payload: str):
    if not _db_conn: return
    try:
        _db_conn.execute(
            "DELETE FROM map_items WHERE level=? AND gx=? AND gy=? AND kind=? AND payload=?",
            (level, gx, gy, kind, payload)
        )
        _db_conn.commit()
    except Exception as e:
        print(f"[DB] item delete fail: {e}")

def get_mapdiff(level: str) -> MapDiff:
    md = level_diffs.get(level)
    if not md:
        md = MapDiff(version=1, adds={}, removes=set())
        level_diffs[level] = md
    return md

def apply_edit_ops_to_level(level: str, raw_ops: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Apply edit ops; supports hazard flag via 't':1 on add ops.

    Returns net ops (with 't':1 where applicable) to broadcast.
    """
    if not raw_ops:
        return []
    md = get_mapdiff(level)
    last: Dict[str, Tuple[str,int]] = {}
    for entry in raw_ops:
        if not isinstance(entry, dict):
            continue
        op = entry.get("op")
        key = entry.get("key")
        if op not in ("add", "remove"):
            continue
        if not isinstance(key, str):
            continue
        if len(key) == 0 or len(key) > KEY_MAX_LEN:
            continue
        if op == 'add':
            hz = 1 if entry.get('t') in (1, '1', True) else 0
            last[key] = ('add', hz)
        else:
            last[key] = ('remove', 0)
    if not last:
        return []
    net: List[Dict[str, Any]] = []
    for key, (op, hz) in last.items():
        if op == 'add':
            prev = md.adds.get(key)
            if prev is None:
                if key in md.removes:
                    md.removes.discard(key)
                md.adds[key] = hz
                net.append({ 'op':'add', 'key': key, **({'t':1} if hz else {}) })
            else:
                if prev != hz:
                    md.adds[key] = hz
                    net.append({ 'op':'add', 'key': key, **({'t':1} if hz else {}) })
        else:  # remove
            changed = False
            if key in md.adds:
                md.adds.pop(key, None)
                changed = True
            if key not in md.removes:
                md.removes.add(key)
                changed = True
            if changed:
                net.append({ 'op':'remove', 'key': key })
    if net:
        md.version += 1
        db_persist_level(level, md)
    return net

async def broadcast_map_ops(level: str, ops: List[Dict[str, Any]], version: int) -> None:
    if not ops:
        return
    payload = json.dumps({
        "type": "map_ops",
        "version": version,
        "ops": ops,
    }, separators=(",", ":"))
    dead: Set[WebSocketServerProtocol] = set()
    awaitables = []
    for ws in list(connections):
        meta = ws_meta.get(ws)
        if not meta:  # not yet identified; skip until hello
            continue
        _channel, _level = meta
        if _level != level:
            continue
        awaitables.append(ws.send(payload))
    results = await asyncio.gather(*awaitables, return_exceptions=True)
    idx = 0
    for ws in list(connections):
        meta = ws_meta.get(ws)
        if not meta:
            continue
        if meta[1] != level:
            continue
        if idx >= len(results):
            break
        res = results[idx]; idx += 1
        if isinstance(res, Exception):
            dead.add(ws)
        else:
            ws_map_version[ws] = version
    for ws in dead:
        connections.discard(ws)
        ws_to_id.pop(ws, None)
        ws_meta.pop(ws, None)
        ws_map_version.pop(ws, None)

async def broadcast_item_ops(level: str, ops: List[Dict[str, Any]]) -> None:
    if not ops:
        return
    payload = json.dumps({"type":"item_ops","ops":ops}, separators=(",",":"))
    awaitables = []
    for ws in list(connections):
        meta = ws_meta.get(ws)
        if not meta: continue
        _channel, _level = meta
        if _level != level: continue
        awaitables.append(ws.send(payload))
    await asyncio.gather(*awaitables, return_exceptions=True)


def now_ms() -> int:
    return int(time.time() * 1000)


async def sweep(ts: int) -> None:
    async with lock:
        dead = [pid for pid, p in players.items() if ts - p.last_seen > TTL_MS]
        for pid in dead:
            players.pop(pid, None)


async def broadcast_filtered(obj: Dict[str, Any], channel: str, level: str) -> None:
    """Broadcast an update only to clients in the same channel & level."""
    if not connections:
        return
    msg = json.dumps(obj, separators=(",", ":"))
    dead: Set[WebSocketServerProtocol] = set()
    awaitables = []
    targets: Set[WebSocketServerProtocol] = set()
    for ws in connections:
        meta = ws_meta.get(ws)
        if not meta:
            # If we don't yet know the meta (pre-update client), allow sending so it can at least see others when it joins.
            targets.add(ws)
        else:
            c, l = meta
            if c == channel and l == level:
                targets.add(ws)
    for ws in targets:
        awaitables.append(ws.send(msg))
    results = await asyncio.gather(*awaitables, return_exceptions=True)
    for ws, res in zip(list(targets), results):
        if isinstance(res, Exception):
            dead.add(ws)
    for ws in dead:
        connections.discard(ws)
        ws_to_id.pop(ws, None)
        ws_meta.pop(ws, None)


def validate_update(data: Dict[str, Any]) -> Dict[str, Any]:
    pid = data.get("id")
    pos = data.get("pos") or {}
    state = data.get("state")
    rotation = data.get("rotation")
    frozen = bool(data.get("frozen", False))
    channel = data.get("channel") or "DEFAULT"
    level = data.get("level") or "ROOT"

    if not isinstance(pid, str) or len(pid) < 8:
        raise ValueError("invalid_id")
    if not isinstance(channel, str) or len(channel) == 0 or len(channel) > 32:
        raise ValueError("invalid_channel")
    if not isinstance(level, str) or len(level) == 0 or len(level) > 64 or not LEVEL_NAME_RE.match(level):
        raise ValueError("invalid_level")
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
        "channel": channel,
        "level": level,
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
                channel = data.get("channel") or "DEFAULT"
                level = data.get("level") or "ROOT"
                if not isinstance(channel, str) or not channel or len(channel) > 32:
                    channel = "DEFAULT"
                if not isinstance(level, str) or not level or len(level) > 64 or not LEVEL_NAME_RE.match(level):
                    level = "ROOT"
                ws_to_id[ws] = pid
                ws_meta[ws] = (channel, level)
                # Track map version for this connection (per level)
                md = get_mapdiff(level)
                ws_map_version[ws] = md.version
                # Send initial snapshot (others only) filtered by channel & level
                ts = now_ms()
                await sweep(ts)
                async with lock:
                    out = [
                        p.to_snapshot_entry(ts)
                        for oid, p in players.items()
                        if oid != pid and p.channel == channel and p.level == level
                    ]
                snap = {"type": "snapshot", "now": ts, "ttlMs": TTL_MS, "players": out}
                await ws.send(json.dumps(snap, separators=(",", ":")))
                # Send current map version + full ops (diff) if any, relative to base (version 0)
                try:
                    md = get_mapdiff(level)
                    if md.adds or md.removes:
                        full_ops = ([{"op": "add", "key": k, **({'t':1} if hz else {})} for k, hz in sorted(md.adds.items())] +
                                    [{"op": "remove", "key": k} for k in sorted(md.removes)])
                    else:
                        full_ops = []
                    await ws.send(json.dumps({
                        "type": "map_full",
                        "version": md.version,
                        "ops": full_ops,
                        "baseVersion": 0
                    }, separators=(",", ":")))
                    # Send full items for this level
                    try:
                        items_list = [
                            {"gx": it.gx, "gy": it.gy, "y": it.y, "kind": it.kind, **({"payload": it.payload} if (it.kind==0 and it.payload) else {})}
                            for it in level_items.get(level, [])
                        ]
                        await ws.send(json.dumps({"type":"items_full","items": items_list}, separators=(",",":")))
                    except Exception as e:
                        print(f"[WS] failed send items_full: {e}")
                except Exception:
                    pass
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
                    players[v["id"]] = Player(
                        id=v["id"],
                        x=v["x"],
                        y=v["y"],
                        z=v["z"],
                        state=v["state"],
                        rotation=v["rotation"],
                        frozen=v["frozen"],
                        last_seen=ts,
                        ip=peer,
                        channel=v["channel"],
                        level=v["level"],
                    )
                    # update meta for this websocket
                    ws_meta[ws] = (v["channel"], v["level"])
                await sweep(ts)
                # Broadcast compact update using Player helper
                player = players[v["id"]]
                msg = player.to_update_message(ts)
                if VERBOSE_UPDATES:
                    try:
                        print(
                            f"[{ts}] UPDATE from {peer} id={player.id} pos=({player.x:.2f},{player.y:.2f},{player.z:.2f}) "
                            f"state={player.state} rotation={(player.rotation if player.rotation is not None else '-')} frozen={player.frozen} "
                            f"known={len(players)} -> broadcast",
                            flush=True,
                        )
                    except Exception:
                        pass

                await broadcast_filtered(msg, player.channel, player.level)

            # Map incremental ops from an editor client
            elif typ == "map_edit":
                # Expect { type:'map_edit', ops:[{op:'add'|'remove', key:'...'}] }
                ops_in = data.get("ops")
                if isinstance(ops_in, list):
                    if len(ops_in) > MAX_OPS_PER_BATCH:
                        ops_in = ops_in[:MAX_OPS_PER_BATCH]
                    # Determine current level from meta (may have changed in updates)
                    meta = ws_meta.get(ws)
                    if not meta:
                        continue
                    _channel, lvl = meta
                    async with lock:
                        net_ops = apply_edit_ops_to_level(lvl, ops_in)
                        new_ver = get_mapdiff(lvl).version
                    if net_ops:
                        # Log each block add/remove (map diff)
                        try:
                            for op in net_ops:
                                if op.get('op') == 'add':
                                    hz = 1 if op.get('t') == 1 else 0
                                    print(f"[MAP] level={lvl} add key={op.get('key')} hazard={hz} v{new_ver}", flush=True)
                                elif op.get('op') == 'remove':
                                    print(f"[MAP] level={lvl} remove key={op.get('key')} v{new_ver}", flush=True)
                        except Exception:
                            pass
                        await broadcast_map_ops(lvl, net_ops, new_ver)
                continue

            elif typ == "item_edit":
                # { type:'item_edit', ops:[{op:'add'|'remove', gx,gy,y,kind,payload?}] }
                ops_in = data.get("ops")
                if isinstance(ops_in, list):
                    meta = ws_meta.get(ws)
                    if not meta: continue
                    _channel, lvl = meta
                    valid_ops: List[Dict[str, Any]] = []
                    async with lock:
                        for entry in ops_in[:MAX_OPS_PER_BATCH]:
                            if not isinstance(entry, dict): continue
                            op = entry.get('op')
                            if op not in ('add','remove'): continue
                            try:
                                gx = int(entry.get('gx'))
                                gy = int(entry.get('gy'))
                                y = float(entry.get('y') or 0.75)
                                kind = int(entry.get('kind') or 0)
                            except Exception:
                                continue
                            if gx < 0 or gy < 0 or gx > 8192 or gy > 8192: continue
                            payload = entry.get('payload') if kind == 0 else ''
                            # Normalize payload
                            if payload is None: payload = ''
                            # Apply
                            lst = level_items.setdefault(lvl, [])
                            if op == 'add':
                                # replace existing same signature
                                replaced = False
                                for i,it in enumerate(lst):
                                    if it.gx==gx and it.gy==gy and it.kind==kind and ((kind==0 and it.payload==payload) or kind==1):
                                        lst[i] = MapItem(gx=gx, gy=gy, y=y, kind=kind, payload=payload)
                                        replaced = True
                                        break
                                if not replaced:
                                    lst.append(MapItem(gx=gx, gy=gy, y=y, kind=kind, payload=payload))
                                db_upsert_item(lvl, MapItem(gx=gx, gy=gy, y=y, kind=kind, payload=payload))
                                valid_ops.append({'op':'add','gx':gx,'gy':gy,'y':y,'kind':kind, **({'payload':payload} if (kind==0 and payload) else {})})
                            else:  # remove
                                new_list = []
                                removed_any = False
                                for it in lst:
                                    if it.gx==gx and it.gy==gy and it.kind==kind and (kind==1 or it.payload==payload):
                                        db_delete_item(lvl, it.gx, it.gy, it.kind, it.payload)
                                        removed_any = True
                                    else:
                                        new_list.append(it)
                                if removed_any:
                                    level_items[lvl] = new_list
                                    valid_ops.append({'op':'remove','gx':gx,'gy':gy,'kind':kind, **({'payload':payload} if kind==0 and payload else {})})
                    if valid_ops:
                        # Log item add/remove operations (treated as block placements/removals)
                        try:
                            for op in valid_ops:
                                if op.get('op') == 'add':
                                    print(f"[ITEM] level={lvl} add gx={op.get('gx')} gy={op.get('gy')} kind={op.get('kind')} payload={op.get('payload','')}", flush=True)
                                elif op.get('op') == 'remove':
                                    print(f"[ITEM] level={lvl} remove gx={op.get('gx')} gy={op.get('gy')} kind={op.get('kind')} payload={op.get('payload','')}", flush=True)
                        except Exception:
                            pass
                        await broadcast_item_ops(lvl, valid_ops)
                continue

            # Client explicitly requesting map sync if behind
            elif typ == "map_sync":
                have = data.get("have")
                try:
                    have = int(have)
                except Exception:
                    have = -1
                try:
                    meta = ws_meta.get(ws)
                    if not meta:
                        continue
                    _channel, lvl = meta
                    md = get_mapdiff(lvl)
                    if have != md.version:
                        if md.adds or md.removes:
                            full_ops = ([{"op": "add", "key": k, **({'t':1} if hz else {})} for k, hz in sorted(md.adds.items())] +
                                        [{"op": "remove", "key": k} for k in sorted(md.removes)])
                        else:
                            full_ops = []
                        await ws.send(json.dumps({
                            "type": "map_full",
                            "version": md.version,
                            "ops": full_ops,
                            "baseVersion": 0
                        }, separators=(",", ":")))
                        ws_map_version[ws] = md.version
                except Exception:
                    pass
                continue

            elif typ == "list_levels":
                # Respond with list of known level IDs & versions
                try:
                    listing = { lvl: md.version for (lvl, md) in level_diffs.items() }
                    await ws.send(json.dumps({"type":"levels","levels":listing}, separators=(",",":")))
                except Exception:
                    pass
                continue

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
    ws_meta.pop(ws, None)


async def main():
    parser = argparse.ArgumentParser(description="RabbitWine ultra-simple multiplayer server (WebSocket)")
    parser.add_argument("--host", default=HOST, help="Bind host (default 0.0.0.0)")
    parser.add_argument("--port", type=int, default=PORT, help="Bind port (default 42666)")
    parser.add_argument("--cert", help="TLS certificate file (PEM)")
    parser.add_argument("--key", help="TLS private key file (PEM)")
    parser.add_argument("--db", help="SQLite DB file for persistent map diffs (optional). If omitted, uses rw_maps.db (auto-created). Use --db '' to disable.")
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

    # Determine DB path: if argument omitted -> default file; if empty string -> disabled
    use_db = True
    db_file = args.db
    if db_file is None:
        db_file = DEFAULT_DB_FILE
    elif db_file == '':
        use_db = False
    if use_db:
        try:
            db_init(db_file)
            db_load_all()
            print(f"[DB] Using SQLite file: {db_file}")
        except Exception as e:
            print(f"[DB] Failed to init DB '{args.db}': {e}")
            use_db = False
    print(f"Serving on {scheme}://{args.host}:{args.port} (TTL={TTL_MS}ms) persistence={'on' if use_db else 'off'}")
    async with websockets.serve(handle_client, args.host, args.port, ssl=ssl_ctx, ping_interval=20, ping_timeout=20):
        try:
            # Periodic tasks: player sweep (60s) & DB vacuum (every 30 min)
            last_vac = time.time()
            while True:
                await asyncio.sleep(60)
                await sweep(now_ms())
                if use_db and (time.time() - last_vac) > 1800:
                    try:
                        print('[DB] VACUUM start')
                        _db_conn.execute('VACUUM')
                        _db_conn.commit()
                        last_vac = time.time()
                        print('[DB] VACUUM complete')
                    except Exception as e:
                        print(f"[DB] VACUUM failed: {e}")
        except asyncio.CancelledError:
            pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutting down...")
