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
import os
import math
import time as _time

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
MAP_W_DEFAULT = 24
MAP_H_DEFAULT = 24
TILE_LEVELCHANGE = 8  # client uses TILE.LEVELCHANGE == 8

# ---- Music clock (server-side, silent) -------------------------------------
# We "play" vrun64.mp3 at volume 0 and loop it by tracking wall-clock time
# against the track duration. This avoids needing an audio device on the
# server while providing a consistent position reference for clients.

_MUSIC_FILE_NAME = "vrun64.mp3"
_music_duration_ms: int = 0
_music_started_mono: float = 0.0
_music_enabled: bool = False

def _detect_music_path() -> Optional[str]:
    """Return an absolute path to vrun64.mp3 if present.

    Priority:
    1) next to this script (same directory)
    2) ./mz/music/vrun64.mp3 relative to cwd (fallback for dev)
    """
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        p1 = os.path.join(here, _MUSIC_FILE_NAME)
        if os.path.isfile(p1):
            return p1
    except Exception:
        pass
    try:
        p2 = os.path.join(os.getcwd(), "mz", "music", _MUSIC_FILE_NAME)
        if os.path.isfile(p2):
            return p2
    except Exception:
        pass
    return None

def _load_mp3_duration_ms(path: str) -> int:
    """Best-effort MP3 duration probing. Tries mutagen; falls back to 0 on failure."""
    try:
        # Lazy import so mutagen is optional
        from mutagen.mp3 import MP3  # type: ignore
        audio = MP3(path)
        dur = float(getattr(audio, 'info', None).length) if getattr(audio, 'info', None) else float(audio.info.length)
        if math.isfinite(dur) and dur > 0:
            return int(round(dur * 1000.0))
    except Exception as e:
        try:
            print(f"[MUSIC] mutagen probe failed: {e}")
        except Exception:
            pass
    # Fallback: unknown duration
    return 0

def music_clock_init():
    """Initialize the silent looping music clock if the file is present."""
    global _music_duration_ms, _music_started_mono, _music_enabled
    mpath = _detect_music_path()
    if not mpath:
        print("[MUSIC] vrun64.mp3 not found; music position sync disabled")
        _music_enabled = False
        return
    _music_duration_ms = _load_mp3_duration_ms(mpath)
    if _music_duration_ms <= 0:
        print(f"[MUSIC] Could not determine duration for '{mpath}'. Position will be 0.")
        _music_duration_ms = 0
    else:
        print(f"[MUSIC] '{os.path.basename(mpath)}' duration = {_music_duration_ms} ms")
    _music_started_mono = _time.monotonic()
    _music_enabled = True
    # We don't actually output audio; this is a silent clock at volume 0 by design.

def music_current_pos_ms(now_mono: Optional[float] = None) -> int:
    """Return current looping position in ms, or 0 if disabled/unknown duration."""
    if not _music_enabled or _music_duration_ms <= 0:
        return 0
    if now_mono is None:
        now_mono = _time.monotonic()
    elapsed_ms = int((now_mono - _music_started_mono) * 1000.0)
    if _music_duration_ms > 0:
        return elapsed_ms % _music_duration_ms
    return 0

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
    # adds maps block key -> type flag
    # 0 = normal block, 1 = BAD/hazard, 2 = FENCE (rail), 3 = BADFENCE (hazard rail), 4 = HALF-SLAB marker,
    # 5 = PORTAL marker (visual, non-solid), 9 = NOCLIMB marker (solid, disables walljump)
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

# ---- Ground tile overrides (e.g., HALF) persistence -----------------------
@dataclass
class TileDiff:
    version: int
    # map of "gx,gy" -> tile value (int)
    set: Dict[str, int]

# level_id -> TileDiff
level_tiles: Dict[str, TileDiff] = {}
ws_tiles_version: Dict[WebSocketServerProtocol, int] = {}

# ---- Portal metadata (destinations) persistence ---------------------------
# level_id -> { 'gx,gy': 'DEST_LEVEL' }
level_portals: Dict[str, Dict[str, str]] = {}

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
    _db_conn.execute(
        """
        CREATE TABLE IF NOT EXISTS map_tiles(
            level TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            tiles TEXT NOT NULL,
            updated INTEGER NOT NULL
        )
        """
    )
    _db_conn.execute(
        """
        CREATE TABLE IF NOT EXISTS map_portals(
            level TEXT NOT NULL,
            k TEXT NOT NULL,
            dest TEXT NOT NULL,
            PRIMARY KEY(level, k)
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
            # Backward compatibility: entries either 'key' (normal) or 'key#N' where N in {1,2,3,4,5,9}
            for ent in raw_adds:
                if not isinstance(ent, str):
                    continue
                if ent.endswith('#1'):
                    adds[ent[:-2]] = 1
                elif ent.endswith('#2'):
                    adds[ent[:-2]] = 2
                elif ent.endswith('#3'):
                    adds[ent[:-2]] = 3
                elif ent.endswith('#4'):
                    adds[ent[:-2]] = 4
                elif ent.endswith('#5'):
                    adds[ent[:-2]] = 5
                elif ent.endswith('#9'):
                    adds[ent[:-2]] = 9
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
    # Load tiles
    try:
        cur3 = _db_conn.execute("SELECT level,version,tiles FROM map_tiles")
        for level, version, tiles_json in cur3.fetchall():
            d = json.loads(tiles_json) if tiles_json else []
            mapping: Dict[str,int] = {}
            if isinstance(d, list):
                for rec in d:
                    if isinstance(rec, dict):
                        k = rec.get('k'); v = rec.get('v')
                        if isinstance(k, str) and isinstance(v, int):
                            mapping[k] = v
            level_tiles[level] = TileDiff(version=int(version or 1), set=mapping)
        print(f"[DB] Loaded tiles for {len(level_tiles)} levels")
    except Exception as e:
        print(f"[DB] Failed to load tiles: {e}")
    # Load portals
    try:
        cur4 = _db_conn.execute("SELECT level,k,dest FROM map_portals")
        for level, k, dest in cur4.fetchall():
            if not isinstance(level, str) or not isinstance(k, str) or not isinstance(dest, str):
                continue
            level_portals.setdefault(level, {})[k] = dest
        print(f"[DB] Loaded portals for {len(level_portals)} levels")
    except Exception as e:
        print(f"[DB] Failed to load portals: {e}")

def db_persist_level(level: str, diff: MapDiff):
    if not _db_conn: return
    try:
        enc_adds = []
        for k, tt in diff.adds.items():
            # Persist as 'key' or 'key#N' (N in {1,2,3,4,5,9}) for backward compatibility
            if tt in (1, 2, 3, 4, 5, 9):
                enc_adds.append(f"{k}#{tt}")
            else:
                enc_adds.append(k)
        _db_conn.execute(
            "REPLACE INTO map_diffs(level, version, adds, removes, updated) VALUES (?,?,?,?,?)",
            (level, diff.version, json.dumps(sorted(enc_adds)), json.dumps(sorted(diff.removes)), now_ms())
        )
        _db_conn.commit()
    except Exception as e:
        print(f"[DB] Persist error for level '{level}': {e}")

def db_persist_tiles(level: str, tiles: TileDiff):
    if not _db_conn: return
    try:
        enc = [{ 'k': k, 'v': int(v) } for k,v in tiles.set.items()]
        _db_conn.execute(
            "REPLACE INTO map_tiles(level, version, tiles, updated) VALUES (?,?,?,?)",
            (level, tiles.version, json.dumps(enc), now_ms())
        )
        _db_conn.commit()
    except Exception as e:
        print(f"[DB] Persist tiles error for level '{level}': {e}")

def db_portal_set(level: str, k: str, dest: str):
    if not _db_conn:
        return
    try:
        _db_conn.execute(
            "REPLACE INTO map_portals(level,k,dest) VALUES (?,?,?)",
            (level, k, dest)
        )
        _db_conn.commit()
    except Exception as e:
        print(f"[DB] portal set fail: {e}")

def db_portal_remove(level: str, k: str):
    if not _db_conn:
        return
    try:
        _db_conn.execute(
            "DELETE FROM map_portals WHERE level=? AND k=?",
            (level, k)
        )
        _db_conn.commit()
    except Exception as e:
        print(f"[DB] portal remove fail: {e}")

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

def get_tilediff(level: str) -> TileDiff:
    td = level_tiles.get(level)
    if not td:
        td = TileDiff(version=1, set={})
        level_tiles[level] = td
    return td

def apply_edit_ops_to_level(level: str, raw_ops: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Apply edit ops; supports type flag via 't' on add ops.

    t semantics:
        0 = normal block, 1 = BAD/hazard, 2 = FENCE (rail), 3 = BADFENCE (hazard rail),
        4 = HALF-SLAB marker, 5 = PORTAL marker (visual trigger span), 9 = NOCLIMB solid marker

    Returns net ops (with 't' where applicable) to broadcast.
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
            tval_raw = entry.get('t')
            # Normalize t to one of {0,1,2,3,4,5,9}
            try:
                tval = int(tval_raw)
            except Exception:
                tval = 0
            if tval not in (1,2,3,4,5,9):
                tval = 0
            last[key] = ('add', tval)
        else:
            last[key] = ('remove', 0)
    if not last:
        return []
    net: List[Dict[str, Any]] = []
    for key, (op, tt) in last.items():
        if op == 'add':
            prev = md.adds.get(key)
            if prev is None:
                if key in md.removes:
                    md.removes.discard(key)
                md.adds[key] = tt
                net.append({ 'op':'add', 'key': key, **({'t':tt} if tt in (1,2,3,4,5,9) else {}) })
            else:
                if prev != tt:
                    md.adds[key] = tt
                    net.append({ 'op':'add', 'key': key, **({'t':tt} if tt in (1,2,3,4,5,9) else {}) })
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

async def broadcast_tile_ops(level: str, ops: List[Dict[str, Any]], version: int) -> None:
    if not ops:
        return
    payload = json.dumps({ "type":"tile_ops", "version": version, "ops": ops }, separators=(",",":"))
    dead: Set[WebSocketServerProtocol] = set()
    awaitables = []
    for ws in list(connections):
        meta = ws_meta.get(ws)
        if not meta:
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
            ws_tiles_version[ws] = version
    for ws in dead:
        connections.discard(ws)
        ws_to_id.pop(ws, None)
        ws_meta.pop(ws, None)
        ws_tiles_version.pop(ws, None)

async def broadcast_item_ops(level: str, ops: List[Dict[str, Any]]) -> None:
    if not ops:
        return
    payload = json.dumps({"type":"item_ops","ops":ops}, separators=(",",":"))
    targets = []
    for ws in list(connections):
        meta = ws_meta.get(ws)
        if not meta:
            continue
        _channel, _level = meta
        if _level != level:
            continue
        targets.append(ws)
    try:
        print(f"[ITEM] broadcasting {len(ops)} ops to {len(targets)} client(s) level={level}")
    except Exception:
        pass
    awaitables = [ws.send(payload) for ws in targets]
    results = await asyncio.gather(*awaitables, return_exceptions=True)
    # Log failures if any
    for ws, res in zip(targets, results):
        if isinstance(res, Exception):
            try:
                print(f"[ITEM] broadcast send failure: {res}")
            except Exception:
                pass


def _parse_key_xy(k: str) -> Optional[Tuple[int,int]]:
    try:
        parts = k.split(',')
        if len(parts) != 2:
            return None
        gx = int(parts[0]); gy = int(parts[1])
        return (gx, gy)
    except Exception:
        return None

def _is_border_cell(gx: int, gy: int, W: int, H: int) -> bool:
    return gx == 0 or gy == 0 or gx == (W - 1) or gy == (H - 1)

def _opposite_wall_cell(gx: int, gy: int, W: int, H: int) -> Optional[Tuple[int,int]]:
    """Return (dx,dy) mirrored to the opposite border given a border cell (gx,gy)."""
    if gx == 0:
        return (W - 1, max(0, min(H - 1, gy)))
    if gx == W - 1:
        return (0, max(0, min(H - 1, gy)))
    if gy == 0:
        return (max(0, min(W - 1, gx)), H - 1)
    if gy == H - 1:
        return (max(0, min(W - 1, gx)), 0)
    return None

def _find_portal_span_height(level: str, gx: int, gy: int) -> Optional[int]:
    """Inspect current MapDiff for a portal marker (t==5) at this cell and return its integer base Y if found."""
    try:
        md = level_diffs.get(level)
        if not md or not md.adds:
            return None
        prefix = f"{gx},{gy},"
        y_found: Optional[int] = None
        for key, tflag in md.adds.items():
            if tflag != 5:
                continue
            if not key.startswith(prefix):
                continue
            # key format gx,gy,y -> parse y
            parts = key.split(',')
            if len(parts) != 3:
                continue
            try:
                y = int(parts[2])
            except Exception:
                continue
            # If multiple, choose the highest (most visible) span
            if y_found is None or y > y_found:
                y_found = y
        return y_found
    except Exception:
        return None


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
                # Track tiles version too
                td = get_tilediff(level)
                ws_tiles_version[ws] = td.version
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
                        full_ops = ([{"op": "add", "key": k, **({'t':t} if t in (1,2,3,4,5,9) else {})} for k, t in sorted(md.adds.items())] +
                                    [{"op": "remove", "key": k} for k in sorted(md.removes)])
                    else:
                        full_ops = []
                    await ws.send(json.dumps({
                        "type": "map_full",
                        "version": md.version,
                        "ops": full_ops,
                        "baseVersion": 0
                    }, separators=(",", ":")))
                    # Send full tiles
                    try:
                        td = get_tilediff(level)
                        tiles_list = [{ 'k': k, 'v': v } for (k,v) in td.set.items()]
                        await ws.send(json.dumps({ "type":"tiles_full", "version": td.version, "tiles": tiles_list }, separators=(",",":")))
                    except Exception as e:
                        print(f"[WS] failed send tiles_full: {e}")
                    # Send full portal metadata for this level
                    try:
                        plist = [{ 'k': k, 'dest': dest } for (k, dest) in (level_portals.get(level) or {}).items()]
                        await ws.send(json.dumps({ 'type': 'portal_full', 'portals': plist }, separators=(",",":")))
                    except Exception as e:
                        print(f"[WS] failed send portal_full: {e}")
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

            elif typ == "music_pos":
                # Respond with the current music clock position and duration.
                try:
                    pos = music_current_pos_ms()
                    await ws.send(json.dumps({
                        "type": "music_pos",
                        "posMs": int(pos),
                        "durationMs": int(_music_duration_ms),
                        "now": now_ms(),
                        "enabled": bool(_music_enabled),
                    }, separators=(",", ":")))
                except Exception:
                    pass

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
                        # Cross-mirror elevated portal spans (t:5) at border cells when a portal mapping exists for this cell
                        cross_map_ops2: List[Tuple[str, List[Dict[str, Any]], int]] = []
                        if net_ops:
                            for op in net_ops:
                                try:
                                    if not isinstance(op, dict):
                                        continue
                                    k = op.get('key'); o = op.get('op')
                                    if not k or o not in ('add','remove'):
                                        continue
                                    parts = k.split(',')
                                    if len(parts) != 3:
                                        continue
                                    gx = int(parts[0]); gy = int(parts[1]); y = int(parts[2])
                                    W = MAP_W_DEFAULT; H = MAP_H_DEFAULT
                                    if not _is_border_cell(gx, gy, W, H):
                                        continue
                                    # Require existing portal metadata for this source cell
                                    srcKey = f"{gx},{gy}"
                                    dest = (level_portals.get(lvl) or {}).get(srcKey)
                                    if not isinstance(dest, str) or not dest:
                                        continue
                                    opp = _opposite_wall_cell(gx, gy, W, H)
                                    if not opp:
                                        continue
                                    dx, dy = opp
                                    dest_key = f"{dx},{dy},{y}"
                                    if o == 'add':
                                        # Mirror only portal marker adds (t:5)
                                        if (op.get('t')|0) != 5:
                                            continue
                                        mops = apply_edit_ops_to_level(dest, [{ 'op':'add', 'key': dest_key, 't': 5 }])
                                    else:
                                        # Mirror removal at same y from dest cell
                                        mops = apply_edit_ops_to_level(dest, [{ 'op':'remove', 'key': dest_key }])
                                    if mops:
                                        cross_map_ops2.append((dest, mops, get_mapdiff(dest).version))
                                except Exception:
                                    continue
                    if net_ops:
                        # Log each block add/remove (map diff)
                        try:
                            for op in net_ops:
                                if op.get('op') == 'add':
                                    tt = op.get('t')
                                    print(f"[MAP] level={lvl} add key={op.get('key')} t={tt if tt is not None else 0} v{new_ver}", flush=True)
                                elif op.get('op') == 'remove':
                                    print(f"[MAP] level={lvl} remove key={op.get('key')} v{new_ver}", flush=True)
                        except Exception:
                            pass
                        await broadcast_map_ops(lvl, net_ops, new_ver)
                        # Broadcast any mirrored portal span ops to destination level clients
                        if cross_map_ops2:
                            try:
                                by_level: Dict[str, Tuple[int, List[Dict[str, Any]]]] = {}
                                for lev, ops2, ver2 in cross_map_ops2:
                                    rec = by_level.get(lev)
                                    if not rec:
                                        by_level[lev] = (ver2, list(ops2))
                                    else:
                                        by_level[lev] = (ver2, rec[1] + list(ops2))
                                for lev, (ver2, ops2) in by_level.items():
                                    await broadcast_map_ops(lev, ops2, ver2)
                                    try: print(f"[PORTAL] mirrored span ops in level='{lev}' count={len(ops2)} v{ver2}")
                                    except Exception: pass
                            except Exception as e:
                                try: print(f"[PORTAL] mirror broadcast fail: {e}")
                                except Exception: pass
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
                        # Extra debug summary
                        try:
                            print(f"[ITEM] processed batch size={len(valid_ops)} (level={lvl})", flush=True)
                        except Exception:
                            pass
                        await broadcast_item_ops(lvl, valid_ops)
                continue

            elif typ == "items_sync":
                # Client requests a resend of full items list for its current level
                try:
                    meta = ws_meta.get(ws)
                    if meta:
                        _channel, lvl = meta
                        items_list = [
                            {"gx": it.gx, "gy": it.gy, "y": it.y, "kind": it.kind, **({"payload": it.payload} if (it.kind==0 and it.payload) else {})}
                            for it in level_items.get(lvl, [])
                        ]
                        await ws.send(json.dumps({"type":"items_full","items": items_list}, separators=(",",":")))
                        print(f"[ITEM] items_sync responded count={len(items_list)} level={lvl}")
                except Exception as e:
                    print(f"[ITEM] items_sync failed: {e}")
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
                            full_ops = ([{"op": "add", "key": k, **({'t':t} if t in (1,2,3,4,5,9) else {})} for k, t in sorted(md.adds.items())] +
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

            elif typ == "portal_edit":
                # { type:'portal_edit', ops:[ { op:'set'|'remove', k:'gx,gy', dest? } ] }
                ops_in = data.get('ops')
                if isinstance(ops_in, list):
                    meta = ws_meta.get(ws)
                    if not meta:
                        continue
                    _channel, lvl = meta
                    valid_ops: List[Dict[str, Any]] = []
                    # ops to also broadcast into destination levels (for auto return portals)
                    cross_portal_ops: List[Tuple[str, Dict[str, Any]]] = []  # list of (level, op) for portal metadata
                    cross_tile_sets: List[Tuple[str, Dict[str, Any]]] = []   # list of (level, tile_op) for ground tiles
                    cross_map_ops: List[Tuple[str, List[Dict[str, Any]], int]] = []  # list of (level, ops, version) for map diff (t:5 spans)
                    async with lock:
                        store = level_portals.setdefault(lvl, {})
                        for e in ops_in[:MAX_OPS_PER_BATCH]:
                            if not isinstance(e, dict):
                                continue
                            op = e.get('op')
                            k = e.get('k')
                            if op not in ('set','remove') or not isinstance(k, str) or len(k)==0 or len(k)>KEY_MAX_LEN:
                                continue
                            if op == 'set':
                                dest = e.get('dest')
                                if not isinstance(dest, str) or len(dest)==0 or len(dest) > 64:
                                    continue
                                prev = store.get(k)
                                if prev != dest:
                                    store[k] = dest
                                    valid_ops.append({ 'op':'set', 'k': k, 'dest': dest })
                                    db_portal_set(lvl, k, dest)
                                    # If portal placed at border, auto-create a return portal at the opposite wall in the dest level
                                    xy = _parse_key_xy(k)
                                    if xy:
                                        gx, gy = xy
                                        W = MAP_W_DEFAULT; H = MAP_H_DEFAULT
                                        if _is_border_cell(gx, gy, W, H):
                                            opp = _opposite_wall_cell(gx, gy, W, H)
                                            if opp:
                                                dx, dy = opp
                                                dk = f"{dx},{dy}"
                                                # Wire return portal to point back to current level
                                                dstore = level_portals.setdefault(dest, {})
                                                if dstore.get(dk) != lvl:
                                                    dstore[dk] = lvl
                                                    db_portal_set(dest, dk, lvl)
                                                    cross_portal_ops.append((dest, { 'op':'set', 'k': dk, 'dest': lvl }))
                                                # Mirror portal form: if source has an elevated portal span (t:5) at gx,gy, replicate same Y at destination;
                                                # otherwise ensure ground portal tile in destination.
                                                src_y = _find_portal_span_height(lvl, gx, gy)
                                                if src_y is not None:
                                                    # create/add a portal span marker at (dx,dy,src_y) with t:5
                                                    add_key = f"{dx},{dy},{src_y}"
                                                    # Apply via map diff API so versioning/broadcast works consistently
                                                    net_ops = apply_edit_ops_to_level(dest, [{ 'op':'add', 'key': add_key, 't': 5 }])
                                                    if net_ops:
                                                        new_ver = get_mapdiff(dest).version
                                                        cross_map_ops.append((dest, net_ops, new_ver))
                                                else:
                                                    # Ensure a ground portal tile exists at destination cell
                                                    td = get_tilediff(dest)
                                                    curv = td.set.get(dk)
                                                    if curv != TILE_LEVELCHANGE:
                                                        td.set[dk] = TILE_LEVELCHANGE
                                                        td.version += 1
                                                        db_persist_tiles(dest, td)
                                                        cross_tile_sets.append((dest, { 'op':'set', 'k': dk, 'v': TILE_LEVELCHANGE }))
                            else:
                                if k in store:
                                    store.pop(k, None)
                                    valid_ops.append({ 'op':'remove', 'k': k })
                                    db_portal_remove(lvl, k)
                    if valid_ops:
                        # Fan-out to all clients in level
                        try:
                            payload = json.dumps({ 'type': 'portal_ops', 'ops': valid_ops }, separators=(",",":"))
                            targets = [w for w in list(connections) if (ws_meta.get(w) or (None, None))[1] == lvl]
                            await asyncio.gather(*[w.send(payload) for w in targets], return_exceptions=True)
                        except Exception as e:
                            try: print(f"[PORTAL] broadcast fail: {e}")
                            except Exception: pass
                    # Cross-level broadcasts for auto-created return portal and tile and any mirrored portal spans
                    if cross_portal_ops:
                        try:
                            # group by level
                            per_level: Dict[str,List[Dict[str,Any]]] = {}
                            for entry in cross_portal_ops:
                                # cross_portal_ops entries may be (lev, op) for metadata or (lev,) sentinel for map diff already applied
                                lev = entry[0]
                                op = (entry[1] if len(entry) > 1 else None)
                                if op:
                                    per_level.setdefault(lev, []).append(op)
                            for lev, ops in per_level.items():
                                payload = json.dumps({ 'type': 'portal_ops', 'ops': ops }, separators=(",",":"))
                                targets = [w for w in list(connections) if (ws_meta.get(w) or (None, None))[1] == lev]
                                await asyncio.gather(*[w.send(payload) for w in targets], return_exceptions=True)
                                try: print(f"[PORTAL] auto return portal created in level='{lev}' ops={len(ops)}")
                                except Exception: pass
                        except Exception as e:
                            try: print(f"[PORTAL] cross-level broadcast fail: {e}")
                            except Exception: pass
                    # Broadcast any map_ops produced by mirroring portal spans (t:5)
                    if cross_map_ops:
                        try:
                            # group by level; versions already computed per dest
                            per_level_map: Dict[str, Tuple[int, List[Dict[str, Any]]]] = {}
                            for lev, ops, ver in cross_map_ops:
                                rec = per_level_map.get(lev)
                                if not rec:
                                    per_level_map[lev] = (ver, list(ops))
                                else:
                                    per_level_map[lev] = (ver, rec[1] + list(ops))
                            for lev, (ver, ops) in per_level_map.items():
                                await broadcast_map_ops(lev, ops, ver)
                                try: print(f"[PORTAL] mirrored elevated portal span in level='{lev}' count={len(ops)} v{ver}")
                                except Exception: pass
                        except Exception as e:
                            try: print(f"[PORTAL] cross-level map broadcast fail: {e}")
                            except Exception: pass
                    if cross_tile_sets:
                        try:
                            # group by level and bump version already done above; just broadcast ops
                            per_level_tiles: Dict[str, Tuple[int, List[Dict[str, Any]]]] = {}
                            for lev, op in cross_tile_sets:
                                tdv = get_tilediff(lev).version
                                rec = per_level_tiles.get(lev)
                                if not rec:
                                    per_level_tiles[lev] = (tdv, [op])
                                else:
                                    per_level_tiles[lev] = (tdv, rec[1] + [op])
                            for lev, (ver, ops) in per_level_tiles.items():
                                await broadcast_tile_ops(lev, ops, ver)
                                try: print(f"[PORTAL] auto set LEVELCHANGE tile in level='{lev}' count={len(ops)} v{ver}")
                                except Exception: pass
                        except Exception as e:
                            try: print(f"[PORTAL] cross-level tile broadcast fail: {e}")
                            except Exception: pass
                continue

            elif typ == "level_change":
                # Client is switching levels; update meta and send full state for the requested level
                # { type:'level_change', level: 'LEVEL_NAME' }
                try:
                    new_level = data.get("level") or "ROOT"
                    if not isinstance(new_level, str) or len(new_level) == 0 or len(new_level) > 64 or not LEVEL_NAME_RE.match(new_level):
                        new_level = "ROOT"
                    # Preserve current channel; default if unknown
                    cur_meta = ws_meta.get(ws)
                    cur_channel = (cur_meta[0] if cur_meta and isinstance(cur_meta, tuple) else "DEFAULT")
                    ws_meta[ws] = (cur_channel, new_level)
                    # Update known map/tiles version trackers for this connection
                    md = get_mapdiff(new_level)
                    ws_map_version[ws] = md.version
                    td = get_tilediff(new_level)
                    ws_tiles_version[ws] = td.version
                    # Send full map/tiles/portals/items for the new level
                    try:
                        if md.adds or md.removes:
                            full_ops = ([{"op": "add", "key": k, **({'t':t} if t in (1,2,3,4,5,9) else {})} for k, t in sorted(md.adds.items())] +
                                        [{"op": "remove", "key": k} for k in sorted(md.removes)])
                        else:
                            full_ops = []
                        await ws.send(json.dumps({
                            "type": "map_full",
                            "version": md.version,
                            "ops": full_ops,
                            "baseVersion": 0
                        }, separators=(",", ":")))
                    except Exception as e:
                        try: print(f"[WS] failed send map_full on level_change: {e}")
                        except Exception: pass
                    try:
                        tiles_list = [{ 'k': k, 'v': v } for (k,v) in td.set.items()]
                        await ws.send(json.dumps({ "type":"tiles_full", "version": td.version, "tiles": tiles_list }, separators=(",",":")))
                    except Exception as e:
                        try: print(f"[WS] failed send tiles_full on level_change: {e}")
                        except Exception: pass
                    try:
                        plist = [{ 'k': k, 'dest': dest } for (k, dest) in (level_portals.get(new_level) or {}).items()]
                        await ws.send(json.dumps({ 'type': 'portal_full', 'portals': plist }, separators=(",",":")))
                    except Exception as e:
                        try: print(f"[WS] failed send portal_full on level_change: {e}")
                        except Exception: pass
                    try:
                        items_list = [
                            {"gx": it.gx, "gy": it.gy, "y": it.y, "kind": it.kind, **({"payload": it.payload} if (it.kind==0 and it.payload) else {})}
                            for it in level_items.get(new_level, [])
                        ]
                        await ws.send(json.dumps({"type":"items_full","items": items_list}, separators=(",",":")))
                    except Exception as e:
                        try: print(f"[WS] failed send items_full on level_change: {e}")
                        except Exception: pass
                    # Optionally, send a fresh snapshot of other players in this channel+level
                    try:
                        ts = now_ms()
                        await sweep(ts)
                        async with lock:
                            out = [
                                p.to_snapshot_entry(ts)
                                for oid, p in players.items()
                                if p.channel == cur_channel and p.level == new_level and ws_to_id.get(ws) != oid
                            ]
                        await ws.send(json.dumps({"type": "snapshot", "now": ts, "ttlMs": TTL_MS, "players": out}, separators=(",", ":")))
                    except Exception:
                        pass
                except Exception as e:
                    try: print(f"[WS] level_change handling error: {e}")
                    except Exception: pass
                continue

            elif typ == "tiles_sync":
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
                    td = get_tilediff(lvl)
                    if have != td.version:
                        tiles_list = [{ 'k': k, 'v': v } for (k,v) in td.set.items()]
                        await ws.send(json.dumps({ "type":"tiles_full", "version": td.version, "tiles": tiles_list }, separators=(",",":")))
                        ws_tiles_version[ws] = td.version
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

            elif typ == "tile_edit":
                # { type:'tile_edit', ops:[{op:'set', k:'gx,gy', v:int}] }
                ops_in = data.get("ops")
                if isinstance(ops_in, list):
                    meta = ws_meta.get(ws)
                    if not meta:
                        continue
                    _channel, lvl = meta
                    valid_ops: List[Dict[str, Any]] = []
                    async with lock:
                        td = get_tilediff(lvl)
                        last: Dict[str, int] = {}
                        for e in ops_in[:MAX_OPS_PER_BATCH]:
                            if not isinstance(e, dict):
                                continue
                            if e.get('op') != 'set':
                                continue
                            k = e.get('k')
                            v = e.get('v')
                            if not isinstance(k, str) or not isinstance(v, int) or len(k)==0 or len(k)>KEY_MAX_LEN:
                                continue
                            last[k] = int(v)
                        if last:
                            for k, v in last.items():
                                prev = td.set.get(k)
                                if prev != v:
                                    td.set[k] = v
                                    valid_ops.append({ 'op':'set', 'k': k, 'v': v })
                            if valid_ops:
                                td.version += 1
                                db_persist_tiles(lvl, td)
                    if valid_ops:
                        try:
                            for op in valid_ops:
                                print(f"[TILE] level={lvl} set {op.get('k')} -> {op.get('v')} v{get_tilediff(lvl).version}")
                        except Exception:
                            pass
                        await broadcast_tile_ops(lvl, valid_ops, get_tilediff(lvl).version)
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
    # Start silent music clock
    try:
        music_clock_init()
    except Exception as e:
        try: print(f"[MUSIC] init failed: {e}")
        except Exception: pass
    print(f"Serving on {scheme}://{args.host}:{args.port} (TTL={TTL_MS}ms) persistence={'on' if use_db else 'off'} music={'on' if _music_enabled else 'off'}")
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
