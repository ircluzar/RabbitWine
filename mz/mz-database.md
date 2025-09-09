# MZ Database & Persistence Overview

This document explains how the MZ (Maze) module currently uses persistence, how the multiplayer Python server (`multi_server.py`) stores map edit data, and what would be required to properly support multiple levels in a single SQLite database.

## 1. Where Persistence Exists Today

Only one place uses a real on-disk database: `multi_server.py` (the multiplayer WebSocket presence + collaborative map edit server). The browser / MZ client never opens SQLite directly; it communicates via WebSocket message types:

`hello`, `snapshot`, `update`, `map_full`, `map_ops`, `map_edit`, `map_sync`, and (optionally) `list_levels`.

All durable map state lives in a single SQLite table named `map_diffs` in `rw_maps.db` (unless disabled or another file is provided with `--db`).

## 2. Current Schema

DDL (as created on startup):

```sql
CREATE TABLE IF NOT EXISTS map_diffs(
    level   TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    adds    TEXT NOT NULL,     -- JSON array of strings (see encoding below)
    removes TEXT NOT NULL,     -- JSON array of strings
    updated INTEGER NOT NULL   -- server now_ms() when last modified
);
```

### 2.1 Column Semantics

| Column  | Meaning |
|---------|---------|
| `level` | Logical level / map identifier (validated server‑side by regex `^[A-Za-z0-9_\-]{1,64}$`). One row per level, so multiple levels coexist already in the same DB. |
| `version` | Monotonically increasing integer for that level. Incremented exactly once per accepted batch of net map edit operations (`map_edit`). Starts at 1 for a newly referenced level. |
| `adds` | JSON array (sorted on persist) of voxel keys that are present (added) plus optional hazard flag encoding. Each element is a string: either `"gx,gy,y"` for a normal voxel or `"gx,gy,y#1"` for a hazard voxel. (Historic backward‑compat format.) |
| `removes` | JSON array (sorted) of voxel keys that were explicitly “carved out” / removed relative to an (implicit) original base map. Each string is `"gx,gy,y"`. |
| `updated` | Milliseconds epoch when that row was last rewritten (any successful batch). Used only for informational / potential maintenance like VACUUM heuristics. |

### 2.2 Key Format

Voxel key: `gx,gy,y`

* `gx`, `gy`: integer grid coordinates (tile / column coordinates)
* `y`: integer vertical voxel position inside that column

Hazard encoding: `#1` suffix appended ONLY in `adds` to signal the entire voxel is a hazard tile (client merges hazard voxels into spans and marks spans with `t:1` if any voxel inside was hazard). No other hazard values are currently supported.

### 2.3 In-Memory Structures (Server)

At runtime the server keeps (per process):

* `level_diffs: Dict[level, MapDiff]` where `MapDiff` = `{ version: int, adds: Dict[str,int], removes: Set[str] }`
  * `adds` maps voxel key -> hazardFlag (0 or 1)
  * `removes` is a set of removed voxel keys
* On each `map_edit` batch the net effect is computed (coalescing later operations on the same key) and if anything changes the version increments and the row is re‑persisted via `REPLACE INTO map_diffs(...)`.

### 2.4 In-Memory Structures (Client)

Client keeps a single global diff object:

```js
mpMap = { version: 0, adds: Set<string>, removes: Set<string> }
```

Adds hazard with the same `#1` suffix; removes are plain keys. The client rebuilds world column spans each time it applies a `map_full` or `map_ops` message by merging additions then applying removals.

## 3. Message Flow & Versioning

1. Client connects, sends `hello` with `{id, channel, level}`.
2. Server responds with a `snapshot` (players) and a `map_full` (if that level has any edits) containing:
   ```json
   { "type":"map_full", "version": <int>, "ops": [ {op:"add"|"remove", key:"...", t?:1 }, ... ], "baseVersion": 0 }
   ```
3. Subsequent edits: editor client sends `map_edit` with `ops` array. Server computes net ops, updates DB + in-memory diff, increments version, then broadcasts incremental `map_ops`:
   ```json
   { "type":"map_ops", "version": <newVersion>, "ops": [...] }
   ```
4. If a client detects a gap (incoming version not equal to `current+1`) it requests resync via `map_sync` (sending `have`), and server re-sends a `map_full`.
5. Optional `list_levels` returns `{ type:"levels", levels: { <levelId>: version, ... } }` (currently unused client-side).

## 4. Multi-Level Support: Current State

### 4.1 What Already Works (Server / Schema)

* Schema is keyed by `level` (PRIMARY KEY) – multiple levels can coexist in one DB file now.
* All edit / broadcast paths filter by both `(channel, level)` so players editing or viewing different levels do not cross‑pollute map diffs.
* `list_levels` message enumerates the existing `level_diffs` entries with versions.
* `hello` establishes (channel, level) context; subsequent `update` packets can change the level (server updates `ws_meta`).

### 4.2 Gaps on the Client

The current MZ client hardcodes:

```js
const MP_LEVEL = 'ROOT'; // never changes at runtime
```

And only maintains ONE `mpMap` global diff (no per-level isolation). Issues:

1. No UI or API to enumerate levels (`list_levels` response ignored).
2. No mechanism to switch levels and clear or maintain separate diffs (switching would corrupt state because `mpMap` would blend keys from both levels).
3. On changing levels mid-connection (if we ever add that), the server does NOT automatically push a `map_full` for the new level (only on `hello`). The client would need to send an explicit `map_sync` after the first `update` with the new level OR send a new `hello` (requires reconnect).
4. Ghost / player filtering already works per-level (because server side filters), but local map geometry would remain from the previous level until overwritten.
5. Hazard + diff rebuild logic (`__mp_rebuildWorldFromDiff`) rebuilds entire spans globally; it assumes the diff object corresponds to the active level only.

### 4.3 Server Adjustments Potentially Needed

Server mostly supports multi-level already, but two optional improvements would smooth client integration:

* When a connection’s `(channel, level)` changes (detected in an `update`), proactively send a `map_full` for the new level.
* Add a `change_level` message type (explicit) instead of inferring level changes from positional `update` messages.

### 4.4 Readiness Verdict

Schema & server: READY for multiple levels (already normalized by level key).

Client: NOT READY – requires architectural changes to handle per-level map diffs.

### 4.5 Required Client Work (Minimal Path)

1. Maintain a `Map<string, {version, adds:Set, removes:Set}>` keyed by level.
2. Add a level selector UI: fetch `list_levels`, populate dropdown; allow creating a new level ID (validate regex, length).
3. On user switch: 
   * Flush or hide current spans (cache them per level if desired).
   * If the new level diff not yet loaded, send `map_sync` (have=0) immediately after switching.
   * Update a global `CURRENT_LEVEL` and include it in all outgoing `update` and `map_edit` packets.
4. Modify rebuild logic to operate on the active level’s diff only.
5. Optionally reconnect with a new `hello` for clarity (simpler than overloading `update`).
6. Handle unsolicited `map_ops` only if they match the active level (if adding level metadata to messages) OR rely on per-connection filtering (as now) and just route to the active level’s diff object.

### 4.6 Optional Enhancements

* Add `level` field to `map_full` / `map_ops` payloads explicitly for forward compatibility (currently level implied by connection context).
* Provide a `base_map_hash` or `baseVersion` > 0 concept if you later store *compacted* snapshots to limit growth of the adds/removes arrays.
* Implement a periodic compaction: materialize current adds/removes into a canonical set and drop tombstoned pairs (where the same key is both added and removed over history). Right now arrays can accumulate churn until a server restart.

## 5. Hazard Encoding Discussion

Current approach encodes hazard by suffix `#1` in the string key. Pros: simple, backward compatible with plain string arrays. Cons: string parsing and risk of accidental collisions if a legitimate key ended with `#1` (unlikely since y is integer but still implicit coupling).

Potential refined schema:

```sql
CREATE TABLE map_voxels(
  level TEXT NOT NULL,
  key   TEXT NOT NULL,
  hazard INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(level, key)
);

CREATE TABLE map_removes(
  level TEXT NOT NULL,
  key   TEXT NOT NULL,
  PRIMARY KEY(level, key)
);
```

Then a `map_meta(level PRIMARY KEY, version, updated)` table. This would trade some simplicity for structured queries (e.g., count hazards, partial retrieval). Not strictly needed right now.

## 6. Example Operations

Insert (first time a level is edited):
```sql
REPLACE INTO map_diffs(level, version, adds, removes, updated)
VALUES ('LEVEL1', 2, '["0,0,0","0,0,1#1"]', '[]', 1730000000000);
```

Enumerate levels with versions:
```sql
SELECT level, version, updated FROM map_diffs ORDER BY level;
```

Count hazard voxels for a level (SQLite JSON1 helpful):
```sql
-- Approximate (counts entries ending in #1)
SELECT SUM(CASE WHEN value LIKE '%#1' THEN 1 ELSE 0 END) AS hazard_count
FROM map_diffs, json_each(map_diffs.adds)
WHERE level = 'ROOT';
```

## 7. Operational Notes

* VACUUM runs every 30 minutes (if DB enabled) inside the main event loop.
* No pruning of old diffs since full history is *implicit only* in the additive set; we store only the current state, not a log. So file size remains bounded by current map complexity.
* Concurrency: single process; writes happen synchronously per batch with `REPLACE` + `COMMIT` so no overlapping transactions.

## 8. Risks & Future Work Summary

| Area | Current Status | Risk | Suggested Action |
|------|----------------|------|------------------|
| Multi-level gameplay | Server OK; client hardcoded to `ROOT` | Users cannot explore multiple maps | Implement client level selector & per-level diff cache |
| Map diff integrity | In-memory only until persisted; crash mid-batch loses latest batch | Minor | Acceptable; optional WAL mode for durability |
| Hazard encoding | String suffix | Medium (tech debt) | Migrate to explicit column or object form later |
| Level change sync | No automatic full diff on level switch | Confusion / stale geometry | Send `map_full` after meta level change or force reconnect |
| Diff size growth | Single arrays; churn may leave add/remove oscillations | Inefficient rebuild cost | Periodic normalization / compaction routine |

## 9. Quick Checklist to Enable Multi-Level Client

1. Add UI to select/create level.
2. Add `window.MP_LEVEL` mutable & propagate changes.
3. On selection change: reconnect (send new `hello`) OR send `change_level` then `map_sync`.
4. Maintain separate diff object per level; rebuild spans from that diff only.
5. Optionally request `list_levels` at startup to populate selector.
6. (Optional) Add explicit `level` field to server `map_full` / `map_ops` messages for clarity.

---

**Summary:** The existing SQLite table already supports multiple levels simultaneously. The server logic isolates edits per `(channel, level)` correctly. The missing piece is purely on the client side: it is single-level by design today. Implementing the checklist above will make multi-level gameplay feasible without changing the database schema.
