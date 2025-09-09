"use strict";
// Multiplayer item replication client: receives full and incremental item ops from server.
(function(){
  if (typeof window === 'undefined') return;
  // Hook into existing mp websocket by monkey-patching mpWS onmessage dispatch if present.
  // We intercept messages in multiplayer.js by wrapping its onmessage after it sets it.
  const pending = [];
  let shadowItems = []; // {gx,gy,y,kind,payload}
  function clearRuntime(){
    try {
      // Remove all currently active items by iterating shadow store
      if (typeof window.removeItemsAtWorld === 'function'){
        for (const it of shadowItems){
          const wx = (it.gx + 0.5) - (window.MAP_W||128)*0.5;
          const wz = (it.gy + 0.5) - (window.MAP_H||128)*0.5;
          window.removeItemsAtWorld(wx, wz);
        }
      }
    } catch(_){ }
  }
  function applyFull(list){
    try {
      if (!Array.isArray(list)) return;
      clearRuntime();
      shadowItems = [];
      for (const it of list){
        if (!it || typeof it.gx!=='number' || typeof it.gy!=='number') continue;
        const gx = it.gx|0, gy = it.gy|0;
        const y = (typeof it.y==='number') ? it.y : 0.75;
        const kind = (it.kind===1)?1:0;
        const payload = (kind===0 && typeof it.payload==='string') ? it.payload : '';
        const wx = (gx + 0.5) - (window.MAP_W||128)*0.5;
        const wz = (gy + 0.5) - (window.MAP_H||128)*0.5;
        if (kind===1){
          if (typeof window.spawnPurpleItemWorld === 'function') window.spawnPurpleItemWorld(wx, y, wz);
        } else {
          if (typeof window.spawnItemWorld === 'function') window.spawnItemWorld(wx, y, wz, payload);
        }
        shadowItems.push({ gx, gy, y, kind, payload });
      }
    } catch(_){ }
  }
  function applyOps(ops){
    try {
      if (!Array.isArray(ops)) return;
      for (const op of ops){
        if (!op || typeof op.op !== 'string') continue;
        const kind = op.kind|0;
        if (op.op === 'add'){
          const gx = op.gx|0, gy = op.gy|0; const y = (typeof op.y==='number')? op.y : 0.75;
          const wx = (gx + 0.5) - (window.MAP_W||128)*0.5;
          const wz = (gy + 0.5) - (window.MAP_H||128)*0.5;
          if (kind === 1){
            if (typeof window.spawnPurpleItemWorld === 'function') window.spawnPurpleItemWorld(wx, y, wz);
            shadowItems.push({ gx, gy, y, kind:1, payload:'' });
          } else {
            const payload = (typeof op.payload === 'string') ? op.payload : '';
            if (typeof window.spawnItemWorld === 'function') window.spawnItemWorld(wx, y, wz, payload);
            shadowItems.push({ gx, gy, y, kind:0, payload });
          }
        } else if (op.op === 'remove'){
          const gx = op.gx|0, gy = op.gy|0;
          const wx = (gx + 0.5) - (window.MAP_W||128)*0.5;
          const wz = (gy + 0.5) - (window.MAP_H||128)*0.5;
          if (typeof window.removeItemsAtWorld === 'function') window.removeItemsAtWorld(wx, wz);
          shadowItems = shadowItems.filter(it=> !(it.gx===gx && it.gy===gy && (op.kind==null || it.kind === (op.kind|0))));
        }
      }
    } catch(_){ }
  }
  function intercept(){
    if (!window.__mp_injectMessageHandler){
      // Provide a hook used below to chain handlers.
      window.__mp_injectMessageHandler = function(handler){
        // multiplayer.js sets mpWS.onmessage inline; poll for it
        const origSetter = window.__mp_installHandler;
      };
    }
  }
  // Instead of complex hooking, we patch WebSocket prototype send to capture items already handled by multiplayer.js.
  // Simpler: attach global handler that multiplayer.js will call when processing messages.
  const oldParse = window.JSON && window.JSON.parse;
  // Fallback: monkey-patch mpEnsureWS to wrap ws.onmessage after connection.
  const origEnsure = window.mpEnsureWS;
  if (typeof origEnsure === 'function'){
    window.mpEnsureWS = function(now){
      origEnsure(now);
      try {
        setTimeout(()=>{
          if (window.mpWS && !window.mpWS.__itemsWrapped){
            const ws = window.mpWS;
            const prev = ws.onmessage;
            ws.onmessage = function(ev){
              let handled = false;
              try { const msg = JSON.parse(ev.data); if (msg && msg.type === 'items_full'){ applyFull(msg.items||[]); handled=true; } else if (msg && msg.type==='item_ops'){ applyOps(msg.ops||[]); handled=true; } } catch(_){ }
              if (prev) prev.call(this, ev);
            };
            ws.__itemsWrapped = true;
          }
        }, 50);
      } catch(_){ }
    };
  }
})();
