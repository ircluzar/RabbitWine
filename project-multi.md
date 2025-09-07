# RabbitWine: ultra-simple multiplayer ("shout in the void")

A minimal, connectionless-feel multiplayer where clients periodically send their own state and receive everyone else back. No accounts, no persistence, in-RAM only, 3-second TTL. Intended for quick ambient presence/ghosts, not authoritative gameplay.


## Goals

- Single-file Python server listening on port 42666.
- Clients send: GUID, position, state ("good" or "ball"), and rotation when in ball mode.
- Server stores latest player state in memory for 3 seconds.
- On each update from a client, server responds with the latest states of all other players.
- Client renders others as ghost boxes (green wireframe; red in ball mode) and smoothly interpolates to new positions and rotations.


## Constraints and assumptions

- No persistence; everything is in memory; 3-second expiry based on last update time.
- No authentication; IDs are client-generated ephemeral GUIDs (v4). Treat as public/unauthenticated.
- Transport: HTTP POST with JSON for simplicity and browser compatibility (CORS enabled). UDP would be lower latency but complicates browser and ops.
- Update rate: Suggested 5–20 Hz (e.g., every 100–200 ms). Higher rates cost bandwidth and may add server load.
- Coordinate system: Generic x/y/z floats. If you’re 2D, use z=0.
- Rotation: Single angle in degrees (0–360). Interpreted as Z-axis rotation (right-handed), or the axis your game uses for "ball".
- Response excludes the sender’s own state.


## Data contract (JSON)

- Endpoint: POST http://<host>:42666/update
- Content-Type: application/json
- CORS: Access-Control-Allow-Origin: *

Request body (PlayerUpdate):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",      
  "pos": { "x": 12.34, "y": 5.6, "z": 0 },        
  "state": "good",                                   
  "rotation": 45.0                                    
}
```
Notes:
- id: required, GUID string (UUID v4 recommended per boot/session).
- pos: required floats.
- state: required; one of: "good", "ball".
- rotation: optional, but required when state=="ball"; ignored otherwise.

Response body (Snapshot):
```json
{
  "now": 1694112345678,
  "ttlMs": 3000,
  "players": [
    {
      "id": "d2f2b1f0-1111-2222-3333-444444444444",
      "pos": { "x": -2.1, "y": 0.0, "z": 0 },
      "state": "ball",
      "rotation": 123.4,
      "ageMs": 85
    }
  ]
}
```
- players: everyone except the sender whose entry is fresh (not expired).
- now: server timestamp (ms since epoch) for client-side reconciliation.
- ttlMs: server retention window (3000 ms).
- ageMs: approximate ms since the server last heard from that player.

Error responses:
- 400 with details if payload invalid (missing fields, wrong types, etc.).
- 429 if (optional) rate limits are exceeded.
- 500 for unexpected server errors.

Health endpoint:
- GET /health → 200 OK with `{"status":"ok"}`.
- CORS preflight: OPTIONS /update supported.


## Server behavior

- On POST /update:
  1. Parse/validate JSON; coerce numbers; clamp rotation to 0–360.
  2. Store/update entry in-memory: by `id` → { pos, state, rotation?, lastSeenMs, ip }.
  3. Sweep and remove any entries with `now - lastSeenMs > 3000`.
  4. Respond with all remaining entries except the sender’s `id`.
- In-memory only; a single process; no clustering.
- Concurrency: basic threaded HTTP server or asyncio; for simplicity, use Python’s `http.server` + `ThreadingHTTPServer`.
- CORS: Allow `*`; allow methods: POST, OPTIONS; allow headers: Content-Type.
- Optional:
  - Very light rate limiting per IP (e.g., max 30 req/s) to avoid abuse.
  - Payload size cap (e.g., 4 KB).

Data shape in RAM (Python):
```python
players: dict[str, dict] = {
  "id": {
    "pos": {"x": float, "y": float, "z": float},
    "state": "good"|"ball",
    "rotation": float|None,
    "lastSeen": int,   # ms epoch
    "ip": str
  },
  # ...
}
```

Expiry:
- TTL window: 3000 ms.
- Sweep happens opportunistically on each update and on GET /health (low traffic case still sweeps periodically on updates).

Port:
- Default listen on 0.0.0.0:42666


## Reference server (single-file Python)

Save as `multi_server.py` and run with Python 3.9+.

```python
#!/usr/bin/env python3

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, time, threading

TTL_MS = 3000
MAX_BODY = 4096
HOST = "0.0.0.0"
PORT = 42666

players = {}
lock = threading.Lock()

ALLOWED_STATES = {"good", "ball"}


def now_ms():
    return int(time.time() * 1000)


def sweep_locked(ts):
    dead = [pid for pid, p in players.items() if ts - p["lastSeen"] > TTL_MS]
    for pid in dead:
        players.pop(pid, None)


class Handler(BaseHTTPRequestHandler):
    server_version = "RWMulti/1.0"

    def _send_json(self, code, obj):
        body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_no_content(self, code=204):
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

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
            return self._send_json(404, {"error": "not_found"})

        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY:
            return self._send_json(400, {"error": "invalid_length"})
        try:
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._send_json(400, {"error": "invalid_json"})

        # Validate
        pid = data.get("id")
        pos = data.get("pos") or {}
        state = data.get("state")
        rotation = data.get("rotation")
        if not isinstance(pid, str) or len(pid) < 8:
            return self._send_json(400, {"error": "invalid_id"})
        try:
            x = float(pos.get("x")); y = float(pos.get("y")); z = float(pos.get("z", 0))
        except Exception:
            return self._send_json(400, {"error": "invalid_pos"})
        if state not in ALLOWED_STATES:
            return self._send_json(400, {"error": "invalid_state"})
        if state == "ball":
            try:
                rotation = float(rotation)
            except Exception:
                return self._send_json(400, {"error": "rotation_required"})
            rotation = rotation % 360.0
        else:
            rotation = None

        ts = now_ms()
        sender_ip = self.client_address[0]

        with lock:
            players[pid] = {
                "pos": {"x": x, "y": y, "z": z},
                "state": state,
                "rotation": rotation,
                "lastSeen": ts,
                "ip": sender_ip,
            }
            sweep_locked(ts)
            out = []
            for oid, p in players.items():
                if oid == pid:
                    continue
                age = max(0, ts - p["lastSeen"])
                entry = {
                    "id": oid,
                    "pos": p["pos"],
                    "state": p["state"],
                    "ageMs": age,
                }
                if p["state"] == "ball" and p["rotation"] is not None:
                    entry["rotation"] = p["rotation"]
                out.append(entry)

        self._send_json(200, {"now": ts, "ttlMs": TTL_MS, "players": out})

    # Silence default logging noise
    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Serving on {HOST}:{PORT} (TTL={TTL_MS}ms)")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()
```

Run (Windows PowerShell):
```powershell
python .\multi_server.py
```
Then POST to `http://localhost:42666/update`.


## Client integration (JavaScript)

### GUID creation
- Use `crypto.randomUUID()` once per boot/session; store in-memory or in session storage.

```js
const PLAYER_ID = crypto.randomUUID();
```

### Update loop
- Send updates at ~10 Hz (every 100 ms). Adjust as needed.
- Include current position, state, and rotation (if ball).
- On response, update ghost repository.

```js
const SERVER = "http://localhost:42666"; // or your host
const TTL_MS = 3000;
const UPDATE_MS = 100; // 10 Hz

const ghosts = new Map(); // id -> { pos, state, rotation, lastSeen, targetPos, lerpT, color }

function sendUpdate(selfPos, state, rotation) {
  const body = {
    id: PLAYER_ID,
    pos: { x: selfPos.x, y: selfPos.y, z: selfPos.z ?? 0 },
    state,
  };
  if (state === "ball") body.rotation = rotation;

  return fetch(`${SERVER}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(r => r.json());
}

function tick(selfPos, state, rotation) {
  sendUpdate(selfPos, state, rotation).then(snapshot => {
    const now = snapshot.now ?? Date.now();
    const seen = new Set();

    for (const p of snapshot.players) {
      seen.add(p.id);
      const g = ghosts.get(p.id) ?? {
        pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
        targetPos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
        state: p.state,
        rotation: p.rotation ?? 0,
        lastSeen: now,
        lerpT: 1
      };

      // Set new targets for smoothing
      g.targetPos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      g.state = p.state;
      if (p.state === "ball" && typeof p.rotation === "number") {
        g.targetRot = p.rotation;
      }
      g.lastSeen = now;
      g.lerpT = 0; // start interpolation
      ghosts.set(p.id, g);
    }

    // Prune ghosts that were not in the latest snapshot and have exceeded TTL
    for (const [id, g] of ghosts) {
      if (now - g.lastSeen > TTL_MS) ghosts.delete(id);
    }
  }).catch(() => {/* ignore transient errors */});
}

// Interpolate every frame (~60 Hz)
function updateGhostAnimations(dt) {
  const lerpTime = 150; // ms to reach target (tune this)
  for (const g of ghosts.values()) {
    g.lerpT = Math.min(1, g.lerpT + dt / lerpTime);
    g.pos.x = g.pos.x + (g.targetPos.x - g.pos.x) * g.lerpT;
    g.pos.y = g.pos.y + (g.targetPos.y - g.pos.y) * g.lerpT;
    g.pos.z = g.pos.z + (g.targetPos.z - g.pos.z) * g.lerpT;
    if (g.state === "ball" && typeof g.targetRot === "number") {
      // shortest-arc rotation lerp (simplified)
      const a = ((g.rotation ?? 0) + 360) % 360;
      const b = (g.targetRot + 360) % 360;
      let diff = b - a; if (diff > 180) diff -= 360; if (diff < -180) diff += 360;
      g.rotation = a + diff * g.lerpT;
    }
  }
}
```

### Rendering ghosts
- Represent as wireframe boxes:
  - state=="good": green (e.g., `#00ff00`)
  - state=="ball": red (e.g., `#ff3333`), apply rotation around your game’s Z axis.
- Remove when not seen for > TTL (server already does this; client should mirror to hide smoothly if packets stop).


## Tuning and operational notes

- Update cadence vs. smoothing: If updates are ~10 Hz, client-side 100–200 ms interpolation feels smooth without rubber-banding.
- Bandwidth: Each request/response is tiny (< 1 KB typical). With 10 Hz, per client is ~10–20 KB/s worst-case.
- Scaling: One threaded process is fine for small demos (dozens of clients). For more, consider asyncio or a small FastAPI/uvicorn app.
- CORS: Server allows all origins. If you deploy publicly, consider restricting to your domains.
- Abuse: Add simple rate limits or IP allowlist if needed. The protocol is unauthenticated by design.


## Testing checklist

- Server boots and listens on 42666; GET /health returns ok.
- POST /update with valid payload returns 200 and empty players when alone.
- Two clients:
  - Client A posts; server returns B when B posts and vice versa.
  - If B stops posting for >3s, A no longer sees B in responses.
- Rotation required when state=="ball"; 400 on missing rotation.
- CORS preflight (OPTIONS) succeeds.


## Minimal integration steps

- Server
  1. Copy the Python file `multi_server.py` from above.
  2. Start it: `python .\\multi_server.py` (PowerShell).

- Client
  1. Generate `PLAYER_ID = crypto.randomUUID()` once per boot.
  2. Start a 100–200 ms interval to POST `/update` with your current pos/state/rotation.
  3. Maintain a `Map` of ghosts by `id`.
  4. On each response, update ghost targets; interpolate positions/rotation over ~150 ms.
  5. Render ghosts as wireframe green boxes; red when `state=="ball"` with rotation.
  6. Delete ghosts not seen in > 3000 ms.


## Future enhancements (optional)

- Switch to UDP (WebRTC data channels) for lower latency; requires signaling and more complexity.
- Include velocity for better dead reckoning between packets.
- Add namespaces/rooms or map/region IDs to partition players.
- Compress JSON (br) or use a compact binary schema when scaling.
- Add simple signature (HMAC) to reduce spoofing (still not true auth).
