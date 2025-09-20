"use strict";
/**
 * Game start modal with audio unlock + initial user gesture capture.
 *
 * Responsibilities:
 *  - Display blocking overlay requiring user interaction before game begins.
 *  - Unlock Web Audio API context via user gesture (tap, click, keypress).
 *  - Apply full-page posterize effects during modal display.
 *  - Transition to in-engine visual effects after dismissal.
 *  - Initialize audio volume settings and play dismissal sound.
 *
 * Interaction Methods:
 *  - Tap/click anywhere on overlay or button.
 *  - Press Space key.
 *  - All methods trigger closeAndStart() with proper event handling.
 *
 * Visual Effects:
 *  - Full-page posterize filter (16-color / 64-color modes).
 *  - Card-based modal with pixelated styling and subtle dither patterns.
 *  - Pop-in animation for card appearance.
 *  - Radial gradient background with transparency layers.
 *
 * Accessibility Features:
 *  - Proper ARIA dialog attributes (role="dialog", aria-modal="true").
 *  - Keyboard navigation support (Space key activation).
 *  - High contrast design with clear button labeling.
 *  - Event capture for reliable dismissal across interaction types.
 *
 * Side Effects (write):
 *  - Injects CSS styles + SVG posterize filters into document.
 *  - Modifies body classList for posterize mode toggle.
 *  - Unlocks audio context and configures initial volume settings.
 *  - Updates state visual effect parameters (posterize, dither, pixelation).
 *  - Plays dismissal sound effect.
 *
 * Exported Behavior:
 *  - Auto-initializes on DOMContentLoaded or immediately if DOM ready.
 *  - No explicit exports; self-contained initialization system.
 */
// Start modal: shows a blocking overlay until user interacts. Dismissal grants initial forward movement.
(function(){
  if (typeof window === 'undefined') return;
  let dismissed = false;
  // Always show start modal to ensure a user gesture unlocks audio
  // Inject stylesheet once for glitch/scanline aesthetics
  function ensureStyle(){
    if (document.getElementById('start-modal-style')) return;
    const css = `
  :root{ --px: 2px; }
  /* Overlay */
  .mz-start-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:10000;pointer-events:auto;background:radial-gradient(120% 120% at 50% 10%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.4) 100%);} 
  .mz-start-overlay{image-rendering: pixelated;}
  .mz-start-overlay::before{content:"";position:absolute;inset:0;background:rgba(0,0,0,0.25);pointer-events:none;}

  /* Apply posterize to the whole page while modal is visible */
  body.mz-posterize{filter: url(#mz-posterize-16);} 
  body.mz-posterize.mz-colors-64{filter: url(#mz-posterize-64);} 
    /* very subtle pixel dither vibe */
    .mz-start-overlay::after{content:"";position:absolute;inset:0;background:
      repeating-conic-gradient(from 45deg, rgba(255,255,255,0.03) 0 25%, transparent 0 50%);
      background-size: 4px 4px;opacity:0.35;pointer-events:none;mix-blend-mode:soft-light;}

    /* Card */
  .mz-start-card{position:relative;max-width:min(92vw,480px);padding:28px 24px 24px;border-radius:0;border:2px solid #ffffff;background:rgba(0,0,0,0.69);box-shadow:none;}
  .mz-start-card{color:#ffffff;text-align:center;font-family:'DEGRADE',system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;image-rendering: pixelated;font-size:14px;}
  /* card inherits overlay filter; ensure no extra filtering */
  .mz-start-card{filter:none;} 
    /* subtle inner dither */
    .mz-start-card::before{content:"";position:absolute;inset:0;background:
      repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 2px, rgba(0,0,0,0) 2px 4px);
      opacity:.35;pointer-events:none;mix-blend-mode:overlay;}

    /* Title: clean, airy */
  .mz-start-title{position:relative;font-size:20px;font-weight:700;letter-spacing:1px;margin:0 0 12px;text-shadow:none;}

    .mz-start-desc{opacity:0.85;font-size:13px;margin:0 0 16px;}

    /* Button */
  .mz-start-btn{font:inherit;font-weight:800;color:#ffffff;background:rgba(0,0,0,0.69);border:2px solid #ffffff;border-radius:0;padding:12px 16px;min-height:44px;cursor:pointer;box-shadow:none;font-size:14px;} 
  .mz-start-btn:hover{filter:brightness(1.05);} 
  .mz-start-btn:active{filter:brightness(0.95);} 

    /* Remove decorative corners from the layout (kept for DOM simplicity) */
    .mz-start-card .corners{display:none;}

    /* Pop-in animation */
    .mz-start-card{animation:mz-pop .18s ease-out;}
    @keyframes mz-pop{ 0%{transform:scale(0.98);opacity:0} 100%{transform:scale(1);opacity:1} }
    `;
    const st = document.createElement('style');
    st.id = 'start-modal-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // Inject lightweight SVG filters to posterize colors (approx. low-color look)
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
    // Define 16-color and 64-color posterize filters with nearest-level mapping
    svg.innerHTML = `
      <defs>
        <!-- 16-ish colors: 4 levels R, 3 levels G/B; nearest mapping via step tables -->
        <filter id="mz-posterize-16" color-interpolation-filters="sRGB">
          <feComponentTransfer>
            <!-- 4-level nearest (3-5-5-4) at ~0.166/0.5/0.833 -->
            <feFuncR type="table" tableValues="0 0 0 0.333 0.333 0.333 0.333 0.333 0.666 0.666 0.666 0.666 0.666 1 1 1 1" />
            <!-- 3-level nearest (4-8-4) at 0.25/0.75 -->
            <feFuncG type="table" tableValues="0 0 0 0 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5 1 1 1 1 1" />
            <feFuncB type="table" tableValues="0 0 0 0 0.5 0.5 0.5 0.5 0.5 0.5 0.5 0.5 1 1 1 1 1" />
          </feComponentTransfer>
        </filter>
        <!-- 64 colors: 4 levels per channel; nearest mapping -->
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

  function closeAndStart(ev){
    if (dismissed) return;
    dismissed = true;
    try {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    } catch(_){}
    // Remove listeners
    window.removeEventListener('pointerdown', closeAndStart, true);
    window.removeEventListener('keydown', onKeyDown, true);
    // Remove overlay
    const ov = document.getElementById('start-modal-overlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  // Unlock SFX and then play close sound (35%)
  try { if (window.sfx) { if (!sfx.isUnlocked) sfx.unlock(); sfx.play('./sfx/Menu_Action.mp3', { volume: 0.35 }); } } catch(_){}
    // Remove global posterize immediately since in-engine effect is already active
    try {
      document.body.classList.remove('mz-posterize');
      document.body.classList.remove('mz-colors-64');
      
      // Ensure in-engine effect is at maximum strength
      if (window.state) {
        state.topPosterizeMix = 1.0;
        state.topPosterizeLevels = 4.0; // crushed but not extreme
        state.topDitherAmt = 0.6; // moderate dithering
        state.topPixelSize = 3.0; // moderate pixelation
      }
    } catch(_){ }
    // Initialize audio volumes but don't auto-start movement - let user initiate
    try {
      if (window.sfx) {
        // Respect persisted volume if already applied; only set default if volume appears uninitialized (~exact defaults)
        const persisted = (function(){ try { return localStorage.getItem('mz_sfx_vol'); } catch(_){ return null; }})();
        if (!persisted) { sfx.volume = 0.5; }
      }
      // Music and movement will start when user actually moves via controls
    } catch(_){ }
  }

  function onKeyDown(e){
    const k = e.key || e.code || '';
    if (k === ' ' || k === 'Space' || k === 'Spacebar' || k === 'Space'){
      closeAndStart(e);
    }
  }

  function showModal(){
  ensureStyle();
  ensureFilters();
  const ov = document.createElement('div');
  ov.id = 'start-modal-overlay';
  ov.className = 'mz-start-overlay';
  ov.setAttribute('role','dialog');
  ov.setAttribute('aria-modal','true');

  const card = document.createElement('div');
  card.className = 'mz-start-card';

  const corners = document.createElement('div');
  corners.className = 'corners';

  const h = document.createElement('div');
  h.className = 'mz-start-title';
  h.setAttribute('data-text','JANK WARNING');
  h.textContent = 'JANK WARNING';

  const p = document.createElement('div');
  p.className = 'mz-start-desc';
  p.textContent = 'Tap anywhere, press Space, or use the button to begin.';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mz-start-btn';
  btn.textContent = 'Move';
  btn.setAttribute('aria-label','Move');
  btn.onpointerdown = closeAndStart;

  card.appendChild(h);
  card.appendChild(p);
  card.appendChild(btn);
  card.appendChild(corners);
  ov.appendChild(card);
  document.body.appendChild(ov);
  // Enable global posterize while modal is open
  try {
    document.body.classList.add('mz-posterize');
    document.body.classList.add('mz-colors-64');
    // The in-engine effect is already active from state initialization
  } catch(_){}

  // Global listeners to dismiss
  window.addEventListener('pointerdown', closeAndStart, true);
  window.addEventListener('keydown', onKeyDown, true);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', showModal, { once: true });
  } else {
    showModal();
  }
})();
