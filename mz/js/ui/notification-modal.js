"use strict";
// Glitchy, pixelated top notification (toast) that auto-dismisses after a few seconds.
(function(){
  if (typeof window === 'undefined') return;
  const STYLE_ID = 'mz-toast-style';
  const CONTAINER_ID = 'mz-toast-container';

  function ensureStyle(){
    if (document.getElementById(STYLE_ID)) return;
    const css = `
    :root{ --px: 3px; }
    .${CONTAINER_ID}{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:11000;display:flex;flex-direction:column;gap:10px;pointer-events:none;image-rendering: pixelated}
  .mz-toast{position:relative;min-width:min(92vw, 520px);max-width:min(92vw, 520px);padding:12px 16px;border-radius:0;border:var(--px) solid rgba(255,255,255,0.12);background:rgba(14,16,22,0.28);box-shadow:0 0 0 var(--px) rgba(0,0,0,0.85);color:#e6e9f9;font-family:'DEGRADE',system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;text-align:center;line-height:1.25;image-rendering: pixelated;}
  /* stack for crossfade between normal and bitcrushed content */
  .mz-toast .t-stack{position:relative}
  .mz-toast .layer-normal,.mz-toast .layer-crunch{position:relative}
  @media (pointer:none), (pointer:coarse){.mz-toast .t-stack{position:relative}}
  .mz-toast .layer-crunch{filter: url(#mz-posterize-16);opacity:0}
  body.mz-colors-64 .mz-toast .layer-crunch{filter: url(#mz-posterize-64);} 
  /* Animations for effect fade */
  .mz-toast.enter .layer-crunch{animation:mz-crunch-in .18s ease-out forwards}
  .mz-toast.enter .layer-normal{animation:mz-crunch-normal-out .18s ease-out forwards}
  .mz-toast.exit .layer-crunch{animation:mz-crunch-out .18s ease-in forwards}
  .mz-toast.exit .layer-normal{animation:mz-crunch-normal-in .18s ease-in forwards}
  @keyframes mz-crunch-in{from{opacity:0}to{opacity:1}}
  @keyframes mz-crunch-out{from{opacity:1}to{opacity:0}}
  @keyframes mz-crunch-normal-out{from{opacity:1}to{opacity:0}}
  @keyframes mz-crunch-normal-in{from{opacity:0}to{opacity:1}}
    /* subtle inner dither like start card */
    .mz-toast::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 2px, rgba(0,0,0,0) 2px 4px);opacity:.35;pointer-events:none;mix-blend-mode:overlay}
    /* Clean, airy title */
  .mz-toast .t-title{position:relative;font-weight:700;letter-spacing:1px;text-shadow:none}
  .mz-toast .t-body{opacity:.9;font-size:12px;margin-top:4px}
    /* Minimal bar accent */
    .mz-toast .bar{height:var(--px);margin-top:8px;background:repeating-linear-gradient(90deg, rgba(0,255,255,0.28) 0 calc(var(--px) * 3), rgba(255,0,255,0.28) calc(var(--px) * 3) calc(var(--px) * 6), transparent calc(var(--px) * 6) calc(var(--px) * 8));opacity:.5}
    /* Pop-in/out similar to start modal */
    .mz-toast.enter{animation:mz-tin .18s ease-out both}
    .mz-toast.exit{animation:mz-tout .2s ease-in both}
    @keyframes mz-tin{from{opacity:0;transform:translateY(calc(var(--px) * -3))}to{opacity:1;transform:translateY(0)}}
    @keyframes mz-tout{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(calc(var(--px) * -3))}}
    `;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  // Ensure posterize filters exist (shared IDs with start modal)
  function ensureFilters(){
    if (document.getElementById('mz-start-filters')) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('id','mz-start-filters');
    svg.setAttribute('aria-hidden','true');
    svg.setAttribute('width','0');
    svg.setAttribute('height','0');
    svg.style.position = 'fixed';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.visibility = 'hidden';
    svg.innerHTML = `
      <defs>
        <filter id="mz-posterize-16" color-interpolation-filters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0 0 0 0.333 0.333 0.333 0.333 0.333 0.666 0.666 0.666 0.666 0.666 1 1 1 1" />
            <feFuncG type="table" tableValues="0 0 0 0 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5 1 1 1 1 1" />
            <feFuncB type="table" tableValues="0 0 0 0 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5 1 1 1 1 1" />
          </feComponentTransfer>
        </filter>
        <filter id="mz-posterize-64" color-interpolation-filters="sRGB">
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0 0 0 0.333 0.333 0.333 0.333 0.333 0.666 0.666 0.666 0.666 0.666 1 1 1 1" />
            <feFuncG type="table" tableValues="0 0 0 0.333 0.333 0.333 0.333 0.333 0.666 0.666 0.666 0.666 0.666 1 1 1 1" />
            <feFuncB type="table" tableValues="0 0 0 0.333 0.333 0.333 0.333 0.333 0.666 0.666 0.666 0.666 0.666 1 1 1 1" />
          </feComponentTransfer>
        </filter>
      </defs>`;
    document.body.appendChild(svg);
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
    ensureFilters();
    const ttl = (opts && opts.ttl) || 3500;
    const body = (opts && opts.body) || '';
    const c = ensureContainer();
    const t = document.createElement('div');
    t.className = 'mz-toast enter';
    const stack = document.createElement('div');
    stack.className = 't-stack';
    const normal = document.createElement('div'); normal.className = 'layer-normal';
    const crunch = document.createElement('div'); crunch.className = 'layer-crunch';

    const makeContent = (root) => {
      const title = document.createElement('div');
      title.className = 't-title';
      title.setAttribute('data-text', String(message||''));
      title.textContent = String(message||'');
      root.appendChild(title);
      if (body){
        const desc = document.createElement('div');
        desc.className = 't-body';
        desc.textContent = String(body);
        root.appendChild(desc);
      }
      const bar = document.createElement('div'); bar.className = 'bar'; root.appendChild(bar);
      const scan = document.createElement('div'); scan.className = 'scan'; root.appendChild(scan);
    };
    makeContent(normal);
    makeContent(crunch);
    stack.appendChild(normal);
    stack.appendChild(crunch);
    t.appendChild(stack);
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
