<?php
// HTTPS downgrade disabled to avoid redirect loops behind proxies/HSTS.
// Cache-bust all linked resources by appending a random version parameter per request
$v = random_int(1, PHP_INT_MAX);
function bust($path) {
    global $v;
    return $path . ((strpos($path, '?') !== false) ? '&' : '?') . 'v=' . $v;
}
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#0a0a0f" />
    <script>
      (function(){
        try {
          if (location.protocol === 'https:') {
            var target = 'http://' + location.host + location.pathname + location.search + location.hash;
            // Use replace to avoid history pollution
            window.location.replace(target);
          }
        } catch(e){}
      })();
    </script>
    <title>VRUN MZ</title>
    <link rel="preload" href="<?php echo bust('./DEGRADE.ttf'); ?>" as="font" type="font/ttf" crossorigin>
    <link rel="preload" href="<?php echo bust('./styles.css'); ?>" as="style" />
    <link rel="stylesheet" href="<?php echo bust('./styles.css'); ?>" />
  </head>
  <body>
    <noscript>This experience requires JavaScript.</noscript>
    <canvas id="app" aria-label="VRUN MZ canvas" tabindex="0"></canvas>
    <!-- Editor crosshair (center dot) -->
    <div id="editor-crosshair" aria-hidden="true"></div>
    <div id="seam" role="separator" aria-orientation="horizontal" aria-label="View seam">
      <div id="seam-handle" aria-hidden="true" data-hidden="true" style="display:none"></div>
    </div>

  <!-- Camera status label + Alt control lock button (bottom-left) -->
  <div id="camera-status" aria-hidden="true" data-hidden="true" style="display:none">Camera - Auto</div>
  <button id="alt-control-lock" type="button" aria-pressed="false" aria-hidden="true" data-hidden="true" style="display:none" title="Lock bottom controls (toggle)">⬍⬌</button>

  <!-- Top-left stats box (where settings used to be) -->
  <div id="stats-box" aria-hidden="false">
    <div class="stats-line"><span class="stats-diamond stats-orange">♦</span><span class="stats-sep"> : </span><span id="stats-materials">0</span></div>
    <div class="stats-line"><span class="stats-diamond stats-purple">♦</span><span class="stats-sep"> : </span><span id="stats-purple">0/0</span></div>
    <div class="stats-line"><span class="stats-diamond stats-teal">♦</span><span class="stats-sep"> : </span><span id="stats-rooms">0</span></div>
  </div>

  <!-- Settings (top-right) -->
  <button id="settings-button" type="button" aria-haspopup="dialog" aria-expanded="false" title="Settings">
    <!-- Cog icon will be injected via JS for consistency; fallback glyph: -->
    ⚙
  </button>

  <!-- Debug toggle -->
  <button id="debug-toggle" type="button" aria-pressed="false" title="Toggle debug HUD (on/off)">Debug: OFF</button>
  <button id="editor-toggle" type="button" aria-pressed="false" title="Enter FPS Editor (desktop only)">Editor</button>

    <!-- Lightweight debug overlay for input + stats -->
  <div id="hud" aria-hidden="true"></div>

    <!-- Swipe feedback glow -->
    <div id="swipe-glow-left" class="swipe-glow left" aria-hidden="true"></div>
    <div id="swipe-glow-right" class="swipe-glow right" aria-hidden="true"></div>

    <!-- Core foundation (Milestone 1) -->
    <script src="<?php echo bust('./js/core/constants.js'); ?>"></script>
    <script src="<?php echo bust('./js/core/state.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/dom.js'); ?>"></script>
    <script src="<?php echo bust('./js/core/gl-core.js'); ?>"></script>
    <script src="<?php echo bust('./js/core/math.js'); ?>"></script>
    <script src="<?php echo bust('./js/core/blit.js'); ?>"></script>

    <!-- Map data (Milestone 2) -->
    <script src="<?php echo bust('./js/map/builder.js'); ?>"></script>
    <script src="<?php echo bust('./js/map/map-data.js'); ?>"></script>
    <script src="<?php echo bust('./js/map/map-instances.js'); ?>"></script>
    <script src="<?php echo bust('./js/map/columns.js'); ?>"></script>

    <!-- Pipelines (Milestone 3) -->
    <script src="<?php echo bust('./js/pipelines/grid.js'); ?>"></script>
    <script src="<?php echo bust('./js/pipelines/tiles.js'); ?>"></script>
    <script src="<?php echo bust('./js/pipelines/trail.js'); ?>"></script>
    <script src="<?php echo bust('./js/pipelines/walls.js'); ?>"></script>
  <script src="<?php echo bust('./js/pipelines/remove-debug.js'); ?>"></script>
    <script src="<?php echo bust('./js/pipelines/player.js'); ?>"></script>

    <!-- UI + input (Milestone 4) -->
    <script src="<?php echo bust('./js/audio/music.js'); ?>"></script>
    <script src="<?php echo bust('./js/audio/sfx.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/resize.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/hud.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/input-pointer.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/input-keyboard.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/seam.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/toggle.js'); ?>"></script>
  <script src="<?php echo bust('./js/ui/editor.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/dom-events.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/start-modal.js'); ?>"></script>
    <script src="<?php echo bust('./js/ui/notification-modal.js'); ?>"></script>

    <!-- Gameplay logic (Milestone 5) -->
  <script src="<?php echo bust('./js/app/save.js'); ?>"></script>
    <script src="<?php echo bust('./js/gameplay/controls.js'); ?>"></script>
    <script src="<?php echo bust('./js/gameplay/physics.js'); ?>"></script>
    <script src="<?php echo bust('./js/gameplay/trail-logic.js'); ?>"></script>
    <script src="<?php echo bust('./js/gameplay/fx-lines.js'); ?>"></script>
    <script src="<?php echo bust('./js/gameplay/action-distributor.js'); ?>"></script>
    <script src="<?php echo bust('./js/gameplay/items.js'); ?>"></script>
    <script src="<?php echo bust('./js/gameplay/camera.js'); ?>"></script>
    <script src="<?php echo bust('./js/gameplay/step-loop.js'); ?>"></script>

    <!-- Existing shim (temporary) -->
    <script src="<?php echo bust('./js/gameplay.js'); ?>"></script>
  <!-- Multiplayer: use same-origin /update (proxied by update.php) to avoid mixed content on HTTPS pages -->
  <script>window.MP_SERVER = "";</script>
  <!-- Multiplayer client -->
  <script src="<?php echo bust('./js/app/multiplayer.js'); ?>"></script>
    <!-- App bootstrap (Milestone 6) -->
    <script src="<?php echo bust('./js/app/bootstrap.js'); ?>"></script>
  </body>
  </html>
