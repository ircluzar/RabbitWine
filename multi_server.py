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
import os
from pathlib import Path
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Dict, Any, Set, Optional, Tuple, List

try:
    import websockets
    from websockets.server import WebSocketServerProtocol
except Exception as e:
    raise SystemExit("Missing dependency: websockets. Install with 'pip install websockets'")

HOST = "0.0.0.0"
PORT = 42666
TTL_MS = 3000

# ---- Voice (Codec2) minimal relay configuration (Phase 2) ------------------
# v1: only carry newest ultra-low bitrate frame (codec 'c2-450') piggybacked on
# existing 'update' messages. Server stores ONLY most recent frame metadata
# per player; no history mixing. Intentionally tiny limits.
VOICE_ALLOWED_CODECS = {"c2-450"}
VOICE_MAX_B64 = 32                # Expect a few base64 chars (<= ~16 raw bytes)
VOICE_MAX_FPS = 40                # Hard upper bound accept rate (frames / second)
VOICE_MIN_INTERVAL_MS = int(1000 / VOICE_MAX_FPS)  # 25 ms
VOICE_BROADCAST_MAX_AGE_MS = 750  # Don't rebroadcast stale frames

# Simple global counters for observability (reset only on process restart)
voice_frames_accepted = 0
voice_frames_dropped = 0

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
    # --- Voice fields (defaults allow existing creation sites to omit) ---
    voice_seq: int = -1
    voice_codec: Optional[str] = None
    voice_ts: int = 0              # Client-supplied original timestamp
    voice_data_b64: Optional[str] = None
    voice_updated_ms: int = 0      # Server accept time (ms)
    voice_last_accept_ms: int = 0  # For rate limiting

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
    adds: Set[str]
    removes: Set[str]

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
    _db_conn.commit()

def db_load_all():
    if not _db_conn: return
    cur = _db_conn.execute("SELECT level, version, adds, removes FROM map_diffs")
    rows = cur.fetchall()
    for level, version, adds_json, removes_json in rows:
        try:
            adds = set(json.loads(adds_json)) if adds_json else set()
            removes = set(json.loads(removes_json)) if removes_json else set()
            level_diffs[level] = MapDiff(version=version, adds=adds, removes=removes)
            print(f"[DB] Loaded level '{level}' v{version} adds={len(adds)} removes={len(removes)}")
        except Exception as e:
            print(f"[DB] Failed to load level '{level}': {e}")

def db_persist_level(level: str, diff: MapDiff):
    if not _db_conn: return
    try:
        _db_conn.execute(
            "REPLACE INTO map_diffs(level, version, adds, removes, updated) VALUES (?,?,?,?,?)",
            (level, diff.version, json.dumps(sorted(diff.adds)), json.dumps(sorted(diff.removes)), now_ms())
        )
        _db_conn.commit()
    except Exception as e:
        print(f"[DB] Persist error for level '{level}': {e}")

def get_mapdiff(level: str) -> MapDiff:
    md = level_diffs.get(level)
    if not md:
        md = MapDiff(version=1, adds=set(), removes=set())
        level_diffs[level] = md
    return md

def apply_edit_ops_to_level(level: str, raw_ops: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    if not raw_ops:
        return []
    md = get_mapdiff(level)
    # Last op wins per key
    last: Dict[str, str] = {}
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
        last[key] = op
    if not last:
        return []
    net: List[Dict[str, str]] = []
    for key, op in last.items():
        if op == "add":
            if key in md.removes:
                md.removes.discard(key)
                net.append({"op": "add", "key": key})
            elif key not in md.adds:
                md.adds.add(key)
                net.append({"op": "add", "key": key})
        else:  # remove
            if key in md.adds:
                md.adds.discard(key)
                net.append({"op": "remove", "key": key})
            elif key not in md.removes:
                md.removes.add(key)
                net.append({"op": "remove", "key": key})
    if net:
        md.version += 1
        db_persist_level(level, md)
    return net

async def broadcast_map_ops(level: str, ops: List[Dict[str, str]], version: int) -> None:
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
        # Pass through optional voice payload raw (validated later)
        "_voice": data.get("voice") if isinstance(data.get("voice"), dict) else None,
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
                        full_ops = ([{"op": "add", "key": k} for k in sorted(md.adds)] +
                                    [{"op": "remove", "key": k} for k in sorted(md.removes)])
                    else:
                        full_ops = []
                    await ws.send(json.dumps({
                        "type": "map_full",
                        "version": md.version,
                        "ops": full_ops,
                        "baseVersion": 0
                    }, separators=(",", ":")))
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
                    existing = players.get(v["id"])
                    if existing:
                        # Update positional & state fields
                        existing.x = v["x"]
                        existing.y = v["y"]
                        existing.z = v["z"]
                        existing.state = v["state"]
                        existing.rotation = v["rotation"]
                        existing.frozen = v["frozen"]
                        existing.last_seen = ts
                        existing.channel = v["channel"]
                        existing.level = v["level"]
                        player_ref = existing
                    else:
                        player_ref = Player(
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
                        players[v["id"]] = player_ref
                    # update meta for this websocket (for channel/level filtering)
                    ws_meta[ws] = (v["channel"], v["level"])

                    # ---- Voice handling (minimal) ----
                    voice_in = v.get("_voice")
                    include_voice = False
                    if voice_in:
                        global voice_frames_accepted, voice_frames_dropped
                        try:
                            codec = voice_in.get("codec")
                            b64 = voice_in.get("d")
                            seq = int(voice_in.get("seq", -1)) & 0xFFFFFFFF
                            cts = int(voice_in.get("ts", ts))
                            if (
                                isinstance(codec, str) and codec in VOICE_ALLOWED_CODECS and
                                isinstance(b64, str) and 0 < len(b64) <= VOICE_MAX_B64 and
                                seq >= 0
                            ):
                                # Rate limit
                                if ts - player_ref.voice_last_accept_ms < VOICE_MIN_INTERVAL_MS:
                                    voice_frames_dropped += 1
                                else:
                                    # Sequence accept (monotonic with wrap)
                                    last_seq = player_ref.voice_seq & 0xFFFFFFFF
                                    # Accept if first or normal forward or wrap (large backward gap)
                                    forward = (player_ref.voice_seq < 0) or ( (seq > last_seq and (seq - last_seq) < (1<<31)) ) or ((last_seq - seq) > (1<<31))
                                    if forward:
                                        player_ref.voice_seq = seq
                                        player_ref.voice_codec = codec
                                        player_ref.voice_ts = cts
                                        player_ref.voice_data_b64 = b64
                                        player_ref.voice_updated_ms = ts
                                        player_ref.voice_last_accept_ms = ts
                                        include_voice = True
                                        voice_frames_accepted += 1
                                    else:
                                        voice_frames_dropped += 1
                            else:
                                voice_frames_dropped += 1
                        except Exception:
                            voice_frames_dropped += 1
                await sweep(ts)
                # Broadcast compact update using Player helper
                player = players[v["id"]]
                msg = player.to_update_message(ts)
                # Attach voice only if new and fresh
                if player.voice_data_b64 and player.voice_updated_ms == ts and (ts - player.voice_updated_ms) <= VOICE_BROADCAST_MAX_AGE_MS:
                    msg["voice"] = {
                        "seq": player.voice_seq,
                        "ts": player.voice_ts,
                        "codec": player.voice_codec,
                        "d": player.voice_data_b64,
                    }

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
                        await broadcast_map_ops(lvl, net_ops, new_ver)
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
                            full_ops = ([{"op": "add", "key": k} for k in sorted(md.adds)] +
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

            elif typ == "voice_stats":
                # Return current accept/drop counters (debug)
                try:
                    await ws.send(json.dumps({
                        "type": "voice_stats",
                        "accepted": voice_frames_accepted,
                        "dropped": voice_frames_dropped
                    }, separators=(",", ":")))
                except Exception:
                    pass

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
    parser.add_argument("--no-auto-cert", action="store_true", help="(Deprecated) No effect now; auto cert disabled by default unless --auto-cert supplied")
    parser.add_argument("--auto-cert", action="store_true", help="Enable auto self-signed certificate generation when --cert/--key not provided (restores previous default behavior)")
    parser.add_argument("--cert-hostnames", help="Comma-separated hostnames/IPs to include as SANs when auto-generating a self-signed certificate (requires --auto-cert).")
    args = parser.parse_args()

    ssl_ctx = None
    scheme = "ws"
    def _try_enable(cert_file: str, key_file: str):
        nonlocal ssl_ctx, scheme
        try:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(certfile=cert_file, keyfile=key_file)
            ssl_ctx = ctx
            scheme = "wss"
            print(f"[TLS] Enabled TLS using cert={cert_file} key={key_file}")
        except Exception as e:
            print(f"[WARN] Failed to enable TLS ({cert_file},{key_file}): {e}. Continuing without TLS.")
            ssl_ctx = None
            scheme = "ws"

    if args.cert and args.key:
        _try_enable(args.cert, args.key)
    elif args.auto_cert and not args.no_auto_cert:
        # Attempt to auto-generate a self-signed certificate (dev convenience)
        cert_path = Path("selfsigned_cert.pem")
        key_path = Path("selfsigned_key.pem")
        regenerate = False
        if cert_path.exists():
            try:
                from cryptography import x509  # type: ignore
                from cryptography.hazmat.primitives import serialization  # noqa: F401
                cert_obj = x509.load_pem_x509_certificate(cert_path.read_bytes())
                if cert_obj.not_valid_after < datetime.utcnow() + timedelta(days=1):
                    regenerate = True
            except Exception:
                regenerate = True
        else:
            regenerate = True
        if regenerate:
            try:
                from cryptography import x509  # type: ignore
                from cryptography.x509.oid import NameOID
                from cryptography.hazmat.primitives import hashes, serialization
                from cryptography.hazmat.primitives.asymmetric import rsa
                key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
                subject = issuer = x509.Name([
                    x509.NameAttribute(NameOID.COUNTRY_NAME, u"US"),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"RabbitWine"),
                    x509.NameAttribute(NameOID.COMMON_NAME, u"localhost"),
                ])
                alt_names = [x509.DNSName(u"localhost")]
                # Collect additional hostnames (from --host if specific, plus --cert-hostnames list)
                hostnames: Set[str] = set()
                if args.host and args.host not in ("0.0.0.0", "::"):
                    hostnames.add(args.host)
                # Always include primary deployment hostname for convenience
                hostnames.add("cc.r5x.cc")
                if args.cert_hostnames:
                    for h in args.cert_hostnames.split(','):
                        h = h.strip()
                        if h:
                            hostnames.add(h)
                if hostnames:
                    try:
                        import ipaddress
                        for h in sorted(hostnames):
                            try:
                                alt_names.append(x509.IPAddress(ipaddress.ip_address(h)))
                            except ValueError:
                                # Not an IP, treat as DNS
                                try:
                                    # Basic safeguard: limited charset
                                    if re.match(r"^[A-Za-z0-9_.-]{1,253}$", h):
                                        alt_names.append(x509.DNSName(h))
                                except Exception:
                                    pass
                    except Exception:
                        # ipaddress import or processing failed; ignore extras
                        pass
                cert = (
                    x509.CertificateBuilder()
                    .subject_name(subject)
                    .issuer_name(issuer)
                    .public_key(key.public_key())
                    .serial_number(x509.random_serial_number())
                    .not_valid_before(datetime.utcnow() - timedelta(minutes=1))
                    .not_valid_after(datetime.utcnow() + timedelta(days=30))
                    .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
                    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                    .sign(key, hashes.SHA256())
                )
                key_path.write_bytes(
                    key.private_bytes(
                        encoding=serialization.Encoding.PEM,
                        format=serialization.PrivateFormat.TraditionalOpenSSL,
                        encryption_algorithm=serialization.NoEncryption(),
                    )
                )
                cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
                print(f"[TLS] Generated self-signed certificate (30d) => {cert_path}, {key_path}")
            except ImportError:
                print("[TLS] 'cryptography' not installed; run 'pip install cryptography' to enable auto TLS. Serving plain WS.")
            except Exception as e:
                print(f"[TLS] Failed to generate self-signed certificate: {e}")
        if cert_path.exists() and key_path.exists():
            _try_enable(str(cert_path), str(key_path))

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
    if scheme == 'ws':
        print("[INFO] Running INSECURE (ws://). For development that's fine. To enable TLS later: use --auto-cert for self-signed or --cert / --key for real cert (wss://).")
    # Simple HTTP health endpoint so browsers can open https://host:port/health to trust cert
    async def _process_request(path, request_headers):  # type: ignore
        if path in ('/', '/health'):
            body = b'ok'
            return (200, [('Content-Type','text/plain'), ('Content-Length', str(len(body)))], body)
        return None  # continue with normal WS upgrade

    async with websockets.serve(handle_client, args.host, args.port, ssl=ssl_ctx, ping_interval=20, ping_timeout=20, process_request=_process_request):
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
