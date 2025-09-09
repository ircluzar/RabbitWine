# Item Persistence Theories (MZ) – Why yellow/purple items vanish after page refresh

Problem recap:
- Placing yellow (payload) or purple items via the FPS editor works instantly (local spawn + server logs `[ITEM] add ...`).
- Refreshing (same browser session, server still running) shows none of the newly placed items.
- Conclusion: Server received and stored them (logs + DB), but client on a fresh load never re-spawns them.

Ordered theories below (highest probability first), each with: Symptom Fit, Root Cause, How to Confirm, Fix Strategy, and Risk Notes.

---
## 1. Missing inclusion of `items-net.js` (MOST LIKELY)
**Root Cause**: The MZ page (`mz/index.php`) never loads `mz/js/app/items-net.js`. That file is the ONLY client logic that listens for `items_full` + `item_ops` messages and calls `spawnItemWorld` / `spawnPurpleItemWorld`. Without it, the WebSocket traffic containing persisted items is ignored.

**Evidence**:
- Grep shows `items-net.js` exists and implements `applyFull` / `applyOps`.
- `index.php` script list ends with `multiplayer.js` then `bootstrap.js`; no `items-net.js` tag.
- `multiplayer.js` itself has zero references to `items_full` or `item_ops` (it only handles map diffs & player updates), so no fallback path exists.

**Symptom Fit**: Items appear only in the same session because the editor locally calls `spawnItemWorld` / `spawnPurpleItemWorld`. After a reload, no network handler replays them, so arrays stay empty except for any hardcoded builder items.

**How to Confirm Quickly**:
1. Open DevTools > Network > WS; watch the multiplayer socket frames after a reload. You should see a JSON frame like `{"type":"items_full","items":[...]}`.
2. In Console run: `window.spawnItemWorld` (should exist) and then: search global `mpWS.onmessage.toString()` – it won’t contain `items_full`.
3. Manually inject the script via console: `var s=document.createElement('script'); s.src='mz/js/app/items-net.js'; document.body.appendChild(s);` then reconnect (reload or close/reopen WS). Items should now appear.

**Fix Strategy**:
Add `<script src="./js/app/items-net.js"></script>` AFTER `multiplayer.js` and BEFORE `bootstrap.js` in `mz/index.php` (order matters: script expects `mpEnsureWS` to be defined so it can wrap it, but should run before the connection is established / or before first ensure call from bootstrap loop). Then reload.

**Risk / Notes**:
- Very low risk. Ensure cache-busting (reuse existing `bust()` helper) to avoid stale loads.
- If added before `multiplayer.js`, patching fails (origEnsure undefined). So strictly after.

---
## 2. Race: Items message processed before item system registers globals
**Root Cause**: If `items_full` arrived *before* `items.js` defined `spawnItemWorld`, calls would no-op. Normally impossible because load order in `index.php` places `items.js` before networking. But if future reordering or async defer/`type=module` changes happen, it could break.

**Symptom Fit**: Would still show zero items after reload.

**How to Confirm**: Add a temporary log in `items-net.js` before calling `spawnItemWorld` to verify function exists. Or in console set a breakpoint inside `applyFull`.

**Fix**: Maintain current ordering (keep `items.js` ahead of all network listeners) or gate spawns: `if(!window.spawnItemWorld){ pendingList = list; ... }`.

**Risk**: Medium only if script order changes; current code is fine once `items-net.js` is actually included.

---
## 3. Level ID mismatch (client always sends `ROOT`, server items stored under different level)
**Root Cause**: If the editor somehow sent `item_edit` ops under one level (e.g., user changed level mid-session) but upon reload the client sent `hello` for a different level, server would respond with an empty `items_full`.

**Evidence Against**: `MP_LEVEL` constant hardcoded to `'ROOT'`; no UI for level switching implemented yet. Server prints `[ITEM] level=...` lines—verify they show `level=ROOT`.

**How to Confirm**: Inspect server log lines for `[ITEM] level=` value; ensure matches the `hello` payload (add a temp print in server `handle_client` for each `hello`).

**Fix**: If mismatch discovered, adjust client `MP_LEVEL` or ensure editor-triggered updates stay in same level.

**Risk**: Low for current codebase.

---
## 4. Items stored but DB not actually used on server startup (persistence disabled)
**Root Cause**: Server started with `--db ''` (blank path) or DB init failed, so items only live in RAM. If the server wasn’t restarted, this does NOT explain loss on browser refresh; but if you also restarted server you’d lose them.

**Evidence Against**: User reports console shows items were placed; not that they disappear after server restart. Reload alone should still get in-memory items.

**How to Confirm**: Server startup line prints `persistence=on` vs `off`. Also check for `[DB] Using SQLite file:` log. Inspect `rw_maps.db` with `sqlite3 rw_maps.db "select * from map_items;"` and verify rows.

**Fix**: Ensure `--db` argument not blank; fix any permission errors.

**Risk**: Medium only if planning restarts; unrelated to immediate symptom.

---
## 5. Client save system filtering items as already collected
**Root Cause**: `initItemsFromBuilder` skips items where `gameSave.isItemCollected(w.x, w.z)` returns true. If `gameSave` mis-identifies freshly placed items (e.g., coordinate rounding mismatch), they’re skipped.

**Evidence Against**: This filter only applies to builder-based items (static map). Network-spawned items bypass `initItemsFromBuilder` and are added directly by `spawnItemWorld`. Since network path currently never runs (missing script), this is not the primary issue.

**Confirm**: After fixing #1, place item, do NOT collect it, reload—should appear. If it disappears only after collecting once, then the save filter is working as designed.

**Fix**: If false positives occur, change save keying to higher precision or include payload/kind.

**Risk**: Low.

---
## 6. Primary key design may cause duplicate or orphaned rows (not disappearance)
**Root Cause**: DB primary key includes `(level,gx,gy,kind,payload)`. Changing payload at same location inserts a second row (new payload) and leaves old one unless removal sent. Not related to items missing; could cause duplicates later.

**Confirm**: Query DB for multiple rows same (level,gx,gy,kind) with different payloads.

**Fix**: Change PK to `(level,gx,gy,kind)` and treat payload as mutable column; or always send remove before add when editing payload.

**Risk**: Data bloat / duplicate spawns (once networking works) but not causing current absence.

---
## 7. Coordinate mismatch due to MAP_W / MAP_H default fallback
**Root Cause**: If `MAP_W`/`MAP_H` globals not set when items processed, conversion uses default 128—spawning items at wrong world coords (maybe out of camera view).

**Evidence Against**: `constants.js` loads before anything else; sizes should be ready.

**Confirm**: In console after load, check `MAP_W` and `MAP_H`; ensure match actual map. Compare one known placed item’s expected `worldX` to where it should appear.

**Fix**: Ensure constants define prior to items-net hooking.

**Risk**: Very low.

---
## 8. Rare timing: `items-net.js` wrapping delayed until after first `items_full` already processed by (future) integrated handler
Currently moot because no integrated handler exists. If in future multiplayer.js adds item handling, ensure items-net either removed or loads earlier.

---
# Immediate Recommended Action
Add the missing script include.

Example patch (conceptual – do not duplicate without verifying path):
```html
<script src="<?php echo bust('./js/app/multiplayer.js'); ?>"></script>
<script src="<?php echo bust('./js/app/items-net.js'); ?>"></script>
<script src="<?php echo bust('./js/app/bootstrap.js'); ?>"></script>
```

# Quick Verification Checklist After Fix
1. Reload page -> In WS frames see one `items_full`.
2. Console: items appear visually; `listActiveItems()` returns >0 if you placed payload items.
3. Place new item -> second tab (connected) sees it appear (tests incremental `item_ops`).
4. Reload again -> items persist.

# Optional Hardening (Post-Fix)
- Add console log in `applyFull` showing count to aid future debugging.
- Integrate item message handling directly into `multiplayer.js` (reduce monkey-patch fragility) and retire `items-net.js`.
- Normalize DB schema primary key to avoid payload duplication (if desired).
- Add a small `/health` route or periodic server log summarizing item counts per level.

---
## TL;DR
Items don’t persist after reload because the client never processes the server’s `items_full` message. The missing `items-net.js` script is almost certainly the culprit. Add it after `multiplayer.js` and before `bootstrap.js` to restore persistence on page load.
