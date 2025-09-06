"use strict";
// Glitchy, pixelated top notification (toast) that auto-dismisses after a few seconds.
(function(){
  if (typeof window === 'undefined') return;
  const STYLE_ID = 'mz-toast-style';
  const CONTAINER_ID = 'mz-toast-container';

  function ensureStyle(){
    if (document.getElementById(STYLE_ID)) return;
    const css = `
    :root{ --px: 4px; }
    .${CONTAINER_ID}{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:11000;display:flex;flex-direction:column;gap:10px;pointer-events:none;image-rendering: pixelated}
    .mz-toast{position:relative;min-width:min(92vw, 520px);max-width:min(92vw, 520px);padding:10px 14px;border-radius:0;background:rgba(12,14,20,0.2);border:var(--px) solid rgba(255,255,255,0.14);box-shadow:0 0 0 var(--px) rgba(0,0,0,0.85), inset 0 0 0 calc(var(--px)/2) rgba(255,255,255,0.05);color:#e9ecff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;text-align:center;line-height:1.25}
    .mz-toast::before{content:"";position:absolute;inset:0;border-radius:0;background:linear-gradient( to bottom, rgba(255,255,255,0.05), rgba(255,255,255,0) 24%), repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 var(--px), rgba(0,0,0,0) var(--px) calc(var(--px) * 2));opacity:.7;mix-blend-mode:overlay;pointer-events:none}
    .mz-toast::after{content:"";position:absolute;inset:calc(var(--px) * -1);border-radius:0;border:var(--px) solid rgba(136,255,255,0.08);box-shadow:0 0 0 var(--px) rgba(64,255,255,0.08);pointer-events:none}
    .mz-toast .t-title{position:relative;font-weight:800;letter-spacing:.3px;text-shadow:var(--px) 0 rgba(255,0,128,0.35), calc(var(--px) * -1) 0 rgba(0,255,255,0.35)}
    .mz-toast .t-title::before, .mz-toast .t-title::after{content:attr(data-text);position:absolute;left:0;right:0;top:0;opacity:.55;pointer-events:none}
    .mz-toast .t-title::before{color:#0ff;transform:translateX(calc(var(--px) * -1));mix-blend-mode:screen;animation:mz-tglitch 1.4s steps(7,end) infinite}
    .mz-toast .t-title::after{color:#f0f;transform:translateX(var(--px));mix-blend-mode:screen;animation:mz-tglitch 1.4s steps(8,end) infinite reverse}
    .mz-toast .t-body{opacity:.85;font-size:12px;margin-top:4px}
    .mz-toast .scan{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 var(--px), transparent var(--px) calc(var(--px) * 3));opacity:.5;mix-blend-mode:soft-light;pointer-events:none;animation:mz-tscan 6s steps(8,end) infinite}
    .mz-toast .bar{height:var(--px);margin-top:8px;background:repeating-linear-gradient(90deg, rgba(0,255,255,0.35) 0 calc(var(--px) * 3), rgba(255,0,255,0.35) calc(var(--px) * 3) calc(var(--px) * 6), transparent calc(var(--px) * 6) calc(var(--px) * 8));opacity:.55}
    .mz-toast.enter{animation:mz-tin .24s steps(6,end) both}
    .mz-toast.exit{animation:mz-tout .25s steps(6,end) both}
    @keyframes mz-tglitch{0%{transform:translate(0,0)}10%{transform:translate(var(--px),0)}20%{transform:translate(calc(var(--px) * -1),0)}30%{transform:translate(calc(var(--px) * 0.5),0)}40%{transform:translate(calc(var(--px) * -0.5),0)}50%{transform:translate(0,0)}60%{transform:translate(calc(var(--px) * 0.7),0)}70%{transform:translate(calc(var(--px) * -0.7),0)}80%{transform:translate(calc(var(--px) * 0.3),0)}90%{transform:translate(calc(var(--px) * -0.3),0)}100%{transform:translate(0,0)}}
    @keyframes mz-tscan{0%{opacity:.45}50%{opacity:.6}100%{opacity:.45}}
    @keyframes mz-tin{from{opacity:0;transform:translateY(calc(var(--px) * -4))}to{opacity:1;transform:translateY(0)}}
    @keyframes mz-tout{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(calc(var(--px) * -3))}}
    `;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  function ensureContainer(){
    let c = document.getElementById(CONTAINER_ID);
    if (!c){
      c = document.createElement('div');
      c.id = CONTAINER_ID;
      c.className = CONTAINER_ID;
      document.body.appendChild(c);
    }
    return c;
  }

  function showTopNotification(message, opts){
    ensureStyle();
    const ttl = (opts && opts.ttl) || 3500;
    const body = (opts && opts.body) || '';
    const c = ensureContainer();
    const t = document.createElement('div');
    t.className = 'mz-toast enter';
    const title = document.createElement('div');
    title.className = 't-title';
    title.setAttribute('data-text', String(message||''));
    title.textContent = String(message||'');
    t.appendChild(title);
    if (body){
      const desc = document.createElement('div');
      desc.className = 't-body';
      desc.textContent = String(body);
      t.appendChild(desc);
    }
    const bar = document.createElement('div'); bar.className = 'bar'; t.appendChild(bar);
    const scan = document.createElement('div'); scan.className = 'scan'; t.appendChild(scan);
    c.appendChild(t);

    const to = setTimeout(() => {
      t.classList.remove('enter');
      t.classList.add('exit');
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, ttl);

    return {
      close: () => { clearTimeout(to); t.classList.remove('enter'); t.classList.add('exit'); setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 260); }
    };
  }

  window.showTopNotification = showTopNotification;
})();
