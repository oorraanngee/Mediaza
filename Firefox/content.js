(function () {
  let isEnabled = true;
  const mediaCache = new Map();

  let currentVisMode = "bars";
  let currentVisSens = "standard";
  const activeVisualizers = new Set();
  let openMenuEl = null;

  let activeFloatingCtrl = null;
  const playerControllersByUid = new Map();
  let isUnloading = false;

  const STORAGE_PLAYBACK_KEY = "activePlayback";

  const VISUALIZERS = [
    { id: "bars", label: "Столбики" },
    { id: "wave", label: "Волна (Осциллограф)" },
    { id: "mirror", label: "Зеркальный спектр" },
    { id: "matrix", label: "LED-матрица" }
  ];

  const SENSITIVITIES = [
    { id: "standard", label: "Стандартная" },
    { id: "tartini", label: "Виртуальный основной тон (Тартини)" },
    { id: "high", label: "Высокий тон" },
    { id: "low", label: "Низкий тон" }
  ];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createSvgIcon(kind) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    if (kind === "play") {
      svg.setAttribute("width", "13");
      svg.setAttribute("height", "14");
      svg.setAttribute("viewBox", "0 0 13 14");
      svg.setAttribute("fill", "#fff");
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", "M2 1.5v11l9.5-5.5z");
      svg.appendChild(p);
    } else if (kind === "pause") {
      svg.setAttribute("width", "12");
      svg.setAttribute("height", "12");
      svg.setAttribute("viewBox", "0 0 12 12");
      svg.setAttribute("fill", "#fff");
      const r1 = document.createElementNS(ns, "rect");
      r1.setAttribute("x", "2"); r1.setAttribute("y", "1.5");
      r1.setAttribute("width", "3"); r1.setAttribute("height", "9"); r1.setAttribute("rx", "0.5");
      const r2 = document.createElementNS(ns, "rect");
      r2.setAttribute("x", "7"); r2.setAttribute("y", "1.5");
      r2.setAttribute("width", "3"); r2.setAttribute("height", "9"); r2.setAttribute("rx", "0.5");
      svg.append(r1, r2);
    } else if (kind === "bigPlay") {
      svg.setAttribute("width", "20");
      svg.setAttribute("height", "22");
      svg.setAttribute("viewBox", "0 0 20 22");
      svg.setAttribute("fill", "#fff");
      svg.style.marginLeft = "3px";
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", "M3 2v18l15-9z");
      svg.appendChild(p);
    } else if (kind === "volOn") {
      svg.setAttribute("width", "13");
      svg.setAttribute("height", "13");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "currentColor");
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", "M2 6v4h3l4 3V3L5 6H2zm9.5 2a3.5 3.5 0 0 0-1.5-2.9v5.8A3.5 3.5 0 0 0 11.5 8z");
      svg.appendChild(p);
    } else if (kind === "volOff") {
      svg.setAttribute("width", "13");
      svg.setAttribute("height", "13");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "currentColor");
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", "M2 6v4h3l4 3V3L5 6H2zm11.3-.7L12 6.6l-1.3-1.3-.9.9L11.1 7.5l-1.3 1.3.9.9L12 8.4l1.3 1.3.9-.9-1.3-1.3 1.3-1.3-.9-.9z");
      svg.appendChild(p);
    }
    return svg;
  }

  function setBtnIcon(btn, kind) {
    btn.replaceChildren(createSvgIcon(kind));
  }

  function getVideoDownloadFormats() {
    return [
      { id: "original", label: "Оригинал (.webm)", ext: "webm" },
      { id: "mp4", label: "MP4 (.mp4) — H.264 / AAC", ext: "mp4", outMime: "video/mp4", args: (i, o) => ["-i", i, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "96k", o] },
      { id: "3gp", label: "3GP (.3gp) — кнопочные телефоны", ext: "3gp", outMime: "video/3gpp", args: (i, o) => ["-i", i, "-c:v", "mpeg4", "-q:v", "6", "-r", "15", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:a", "aac", "-ar", "22050", "-ac", "1", "-b:a", "32k", o] },
      { id: "avi", label: "AVI (.avi) — Xvid / MP3", ext: "avi", outMime: "video/x-msvideo", args: (i, o) => ["-i", i, "-c:v", "mpeg4", "-q:v", "5", "-vtag", "XVID", "-c:a", "libmp3lame", "-b:a", "128k", o] },
      { id: "mkv", label: "MKV (.mkv) — без перекодирования", ext: "mkv", outMime: "video/x-matroska", args: (i, o) => ["-i", i, "-c", "copy", o] },
      { id: "mov", label: "MOV (.mov) — QuickTime", ext: "mov", outMime: "video/quicktime", args: (i, o) => ["-i", i, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", o] },
      { id: "mp3", label: "Только звук: MP3 (.mp3)", ext: "mp3", outMime: "audio/mpeg", args: (i, o) => ["-i", i, "-vn", "-c:a", "libmp3lame", "-b:a", "160k", o] },
      { id: "wav", label: "Только звук: WAV (.wav)", ext: "wav", outMime: "audio/wav", args: (i, o) => ["-i", i, "-vn", "-c:a", "pcm_s16le", o] }
    ];
  }

  function getAudioDownloadFormats(origMime) {
    const extMap = { "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/opus": "opus", "audio/wav": "wav", "audio/mp4": "m4a", "audio/aac": "aac", "audio/flac": "flac" };
    const origExt = extMap[(origMime || "").split(";")[0]] || "webm";
    return [
      { id: "original", label: `Оригинал (.${origExt})`, ext: origExt },
      { id: "mp3", label: "MP3 (.mp3)", ext: "mp3", outMime: "audio/mpeg", args: (i, o) => ["-i", i, "-vn", "-c:a", "libmp3lame", "-b:a", "160k", o] },
      { id: "wav", label: "WAV (.wav)", ext: "wav", outMime: "audio/wav", args: (i, o) => ["-i", i, "-vn", "-c:a", "pcm_s16le", o] },
      { id: "ogg", label: "OGG (.ogg)", ext: "ogg", outMime: "audio/ogg", args: (i, o) => ["-i", i, "-vn", "-c:a", "libvorbis", "-q:a", "4", o] },
      { id: "m4a", label: "M4A / AAC (.m4a)", ext: "m4a", outMime: "audio/mp4", args: (i, o) => ["-i", i, "-vn", "-c:a", "aac", "-b:a", "128k", o] },
      { id: "flac", label: "FLAC (.flac)", ext: "flac", outMime: "audio/flac", args: (i, o) => ["-i", i, "-vn", "-c:a", "flac", o] }
    ];
  }

  function injectStyles() {
    if (document.getElementById("df-xp-player-styles")) return;
    const style = document.createElement("style");
    style.id = "df-xp-player-styles";
    style.textContent = `
      .df-xp-slot {
        display: block;
        width: 100%;
        max-width: 460px;
        margin: auto;
        box-sizing: border-box;
      }
      .post-photos-grid .df-xp-slot {
        width: 100%;
        max-width: 420px;
        margin: 0;
        align-self: start !important;
      }
      .df-xp-slot-placeholder {
        border: 1px dashed #7f9db9;
        background: rgba(236, 233, 216, 0.55);
        color: #24406e;
        font-family: Tahoma, sans-serif;
        font-size: 11px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px;
        box-sizing: border-box;
        width: 100%;
      }
      .df-xp-player {
        width: 380px;
        max-width: 100%;
        height: auto !important;
        align-self: center !important;
        flex: 0 0 auto !important;
        display: flex !important;
        flex-direction: column !important;
        background: #ece9d8;
        border: 2px solid #0054e3;
        border-radius: 6px 6px 3px 3px;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
        overflow: hidden;
        font-family: Tahoma, "Segoe UI", sans-serif !important;
        user-select: none;
        box-sizing: border-box;
        text-align: left;
        margin: auto !important;
      }
      .post-photos-grid.df-has-players {
        height: auto !important;
        max-height: none !important;
        grid-template-rows: auto !important;
        grid-auto-rows: auto !important;
        overflow: visible !important;
        align-items: start !important;
        gap: 8px !important;
      }
      .post-photos-grid .df-xp-player {
        width: 100% !important;
        min-width: 0 !important;
        max-width: 420px;
        align-self: start !important;
        margin: 0 !important;
      }
      .df-xp-player.df-xp-floating {
        position: fixed !important;
        left: 14px !important;
        bottom: 14px !important;
        top: auto !important;
        right: auto !important;
        transform: none !important;
        width: 320px !important;
        max-width: calc(100vw - 28px) !important;
        z-index: 2147483640 !important;
        margin: 0 !important;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5) !important;
      }
      .df-xp-player.df-xp-floating .df-xp-screen video.df-media-player {
        max-height: 190px;
      }
      .df-xp-player .df-btn-close-float {
        display: none;
        background: linear-gradient(180deg, #ff8b73 0%, #d93616 100%) !important;
      }
      .df-xp-player.df-xp-floating .df-btn-close-float {
        display: inline-block !important;
      }
      .df-xp-player:fullscreen {
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        border-radius: 0;
        border: none;
        display: flex !important;
        flex-direction: column !important;
        background: #000;
        position: static !important;
      }
      .df-xp-player:fullscreen .df-xp-screen {
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .df-xp-player:fullscreen video.df-media-player {
        max-height: 100%;
        max-width: 100%;
        height: 100%;
      }
      .df-xp-titlebar {
        height: 22px;
        padding: 0 6px;
        background: linear-gradient(180deg, #0997ff 0%, #0053ee 8%, #0050ee 45%, #0066ff 100%);
        color: #fff;
        font-size: 11px;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: space-between;
        text-shadow: 1px 1px 1px rgba(0, 0, 0, 0.55);
        flex-shrink: 0;
      }
      .df-xp-title-left {
        display: flex;
        align-items: center;
        gap: 5px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .df-xp-title-btns {
        display: flex;
        gap: 3px;
      }
      .df-xp-winbtn {
        width: 16px;
        height: 16px;
        border: 1px solid #fff;
        border-radius: 2px;
        background: linear-gradient(180deg, #5ca7ff 0%, #1762db 100%);
        color: #fff;
        font-size: 10px;
        line-height: 14px;
        text-align: center;
        cursor: pointer;
        padding: 0;
        font-weight: bold;
      }
      .df-xp-winbtn:hover { filter: brightness(1.15); }
      .df-xp-screen {
        position: relative;
        background: #030816;
        line-height: 0;
        overflow: hidden;
        flex: 0 0 auto;
      }
      .df-xp-screen video.df-media-player {
        width: 100%;
        max-height: 360px;
        height: auto;
        display: block;
        background: #000;
        object-fit: contain;
      }
      .df-xp-video-poster,
      .post-photos-grid img.df-xp-video-poster {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        object-fit: contain !important;
        background: #000 !important;
        z-index: 1 !important;
        margin: 0 !important;
        border: none !important;
        pointer-events: none !important;
        display: block !important;
      }
      .df-xp-video-poster.hidden,
      .post-photos-grid img.df-xp-video-poster.hidden {
        display: none !important;
      }
      .df-xp-overlay {
        position: absolute;
        inset: 0;
        z-index: 2;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .df-xp-center-play {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #6cb8ff, #175ad4 70%, #0b3488);
        border: 2px solid rgba(255, 255, 255, 0.85);
        box-shadow: 0 3px 12px rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.12s, opacity 0.15s;
      }
      .df-xp-overlay:hover .df-xp-center-play { transform: scale(1.08); }
      .df-xp-center-play.hidden { opacity: 0; pointer-events: none; }

      .df-xp-audio-stage {
        background: linear-gradient(180deg, #061026 0%, #0b1c40 100%);
        padding: 10px;
        display: flex;
        align-items: center;
        gap: 10px;
        border-bottom: 1px solid #163066;
        cursor: pointer;
      }
      .df-xp-audio-art,
      .post-photos-grid img.df-xp-audio-art {
        width: 64px !important;
        height: 64px !important;
        min-width: 64px !important;
        max-width: 64px !important;
        max-height: 64px !important;
        border: 1px solid #2e56a6 !important;
        background: #030816 !important;
        flex-shrink: 0 !important;
        object-fit: cover !important;
        margin: 0 !important;
        display: block !important;
        cursor: pointer !important;
      }
      .df-xp-audio-vis {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .df-xp-audio-badge {
        font-size: 11px;
        font-weight: bold;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: flex;
        justify-content: space-between;
        gap: 6px;
      }
      .df-xp-audio-sub {
        font-weight: normal;
        font-size: 10px;
        color: #7eb6ff;
      }
      canvas.df-xp-vis-canvas {
        width: 100%;
        height: 38px;
        display: block;
        background: #040b1c;
        border: 1px solid #1b3878;
        box-sizing: border-box;
      }

      .df-xp-lcd {
        background: linear-gradient(180deg, #061026 0%, #0b1c40 100%);
        padding: 6px 10px 5px;
        border-top: 1px solid #1e3b7a;
        border-bottom: 1px solid #040a17;
        flex-shrink: 0;
      }
      .df-xp-seek-wrap {
        position: relative;
        height: 14px;
        display: flex;
        align-items: center;
        cursor: pointer;
      }
      .df-xp-seek-track {
        width: 100%;
        height: 5px;
        background: #102552;
        border: 1px solid #264a92;
        border-radius: 3px;
        position: relative;
      }
      .df-xp-seek-fill {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #1d6ee0, #66b8ff);
        border-radius: 2px;
      }
      .df-xp-seek-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #ffffff, #7bc0ff 55%, #1b65d6);
        border: 1px solid #cbe6ff;
        box-shadow: 0 0 6px rgba(90, 175, 255, 0.9);
        position: absolute;
        top: 50%;
        left: 0%;
        transform: translate(-50%, -50%);
        pointer-events: none;
      }
      .df-xp-lcd-info {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #8cbcff;
        margin-top: 2px;
        gap: 8px;
      }
      .df-xp-status {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .df-xp-controls {
        background: linear-gradient(180deg, #ffffff 0%, #eef2fa 50%, #d8e0ef 100%);
        border-top: 1px solid #ffffff;
        padding: 6px 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      .df-xp-btn-play {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1px solid #0e439c;
        background: radial-gradient(circle at 35% 28%, #7fc3ff 0%, #2673e8 55%, #1249a8 100%);
        box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.75), 0 1px 3px rgba(0, 0, 0, 0.3);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        flex-shrink: 0;
      }
      .df-xp-btn-play:hover { filter: brightness(1.08); }
      .df-xp-btn-play:active { transform: translateY(1px); }
      .df-xp-btn-round {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid #7f9db9;
        background: linear-gradient(180deg, #ffffff 0%, #e4e9f2 60%, #cfd6e4 100%);
        box-shadow: inset 0 1px 0 #fff, 0 1px 2px rgba(0, 0, 0, 0.15);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        color: #1f3d7a;
        font-size: 12px;
        flex-shrink: 0;
      }
      .df-xp-btn-round:hover {
        border-color: #2f69c4;
        background: linear-gradient(180deg, #ffffff 0%, #dcebff 100%);
      }
      .df-xp-btn-round.active {
        border-color: #1d6b26;
        background: radial-gradient(circle at 35% 30%, #96f08c, #279c2e);
        color: #fff;
      }
      .df-xp-vol-wrap {
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 1;
        min-width: 45px;
      }
      input[type="range"].df-xp-vol {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        background: #a5b5d1;
        border: 1px solid #7d8fa8;
        border-radius: 2px;
        outline: none;
        cursor: pointer;
      }
      input[type="range"].df-xp-vol::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #ffffff, #63aeff 60%, #1c5fc9);
        border: 1px solid #0e439c;
        cursor: pointer;
      }
      input[type="range"].df-xp-vol::-moz-range-track {
        height: 4px;
        background: #a5b5d1;
        border: 1px solid #7d8fa8;
        border-radius: 2px;
      }
      input[type="range"].df-xp-vol::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: radial-gradient(circle at 35% 30%, #ffffff, #63aeff 60%, #1c5fc9);
        border: 1px solid #0e439c;
        cursor: pointer;
      }

      .df-xp-menu, .df-xp-submenu {
        position: fixed;
        z-index: 2147483647;
        background: #ffffff;
        border: 1px solid #808080;
        box-shadow: 2px 3px 8px rgba(0, 0, 0, 0.35);
        padding: 2px;
        font-family: Tahoma, "Segoe UI", sans-serif !important;
        font-size: 12px;
        color: #000;
        min-width: 195px;
        user-select: none;
      }
      .df-xp-menu-title {
        background: #ece9d8;
        color: #444;
        font-size: 10px;
        font-weight: bold;
        padding: 3px 8px;
        border-bottom: 1px solid #d4d0c8;
        margin-bottom: 2px;
      }
      .df-xp-menu-item {
        position: relative;
        padding: 5px 10px 5px 22px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        white-space: nowrap;
      }
      .df-xp-menu-item:hover,
      .df-xp-menu-item.open {
        background: #316ac5;
        color: #ffffff;
      }
      .df-xp-menu-check {
        position: absolute;
        left: 6px;
        font-weight: bold;
      }
      .df-xp-menu-arrow {
        font-size: 9px;
        opacity: 0.8;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function closeOpenMenu() {
    if (openMenuEl) {
      openMenuEl.remove();
      openMenuEl = null;
    }
  }

  document.addEventListener("pointerdown", (e) => {
    if (!openMenuEl) return;
    if (openMenuEl.contains(e.target) || e.target.closest?.(".df-btn-settings") || e.target.closest?.(".df-btn-download")) return;
    closeOpenMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOpenMenu();
  });

  window.addEventListener("scroll", () => closeOpenMenu(), { passive: true });

  function positionMenuNearButton(menu, anchorBtn) {
    const btnRect = anchorBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let left = btnRect.right - menuRect.width;
    if (left < 6) left = btnRect.left;
    if (left + menuRect.width > window.innerWidth - 6) {
      left = window.innerWidth - menuRect.width - 6;
    }

    let top = btnRect.top - menuRect.height - 4;
    if (top < 6) top = btnRect.bottom + 4;

    menu.style.left = Math.max(6, left) + "px";
    menu.style.top = Math.max(6, top) + "px";
  }

  function applyVisualizerSettings(visMode, visSens) {
    currentVisMode = visMode;
    currentVisSens = visSens;
    chrome.storage.local.set({ visMode, visSens });
    for (const cb of activeVisualizers) cb();
  }

  function openVisMenu(anchorBtn) {
    if (openMenuEl && openMenuEl._anchor === anchorBtn) {
      closeOpenMenu();
      return;
    }
    closeOpenMenu();

    const menu = el("div", "df-xp-menu");
    menu._anchor = anchorBtn;

    menu.appendChild(el("div", "df-xp-menu-title", "Визуализатор и тон"));

    let activeSubmenu = null;
    let activeParentItem = null;

    function clearSubmenu() {
      if (activeSubmenu) {
        activeSubmenu.remove();
        activeSubmenu = null;
      }
      if (activeParentItem) {
        activeParentItem.classList.remove("open");
        activeParentItem = null;
      }
    }

    function showSubmenuFor(itemEl, visObj) {
      if (activeParentItem === itemEl && activeSubmenu) return;
      clearSubmenu();
      activeParentItem = itemEl;
      itemEl.classList.add("open");

      const sub = el("div", "df-xp-submenu");
      sub.appendChild(el("div", "df-xp-menu-title", "Чувствительность"));

      for (const sens of SENSITIVITIES) {
        const sItem = el("div", "df-xp-menu-item");
        const isCurrent = currentVisMode === visObj.id && currentVisSens === sens.id;
        sItem.append(
          el("span", "df-xp-menu-check", isCurrent ? "✓" : ""),
          el("span", null, sens.label)
        );
        sItem.addEventListener("click", (e) => {
          e.stopPropagation();
          applyVisualizerSettings(visObj.id, sens.id);
          closeOpenMenu();
        });
        sub.appendChild(sItem);
      }

      menu.appendChild(sub);
      activeSubmenu = sub;

      const itemRect = itemEl.getBoundingClientRect();
      const subRect = sub.getBoundingClientRect();

      let left = itemRect.right - 2;
      if (left + subRect.width > window.innerWidth - 6) {
        left = itemRect.left - subRect.width + 2;
      }
      let top = itemRect.top - 2;
      if (top + subRect.height > window.innerHeight - 6) {
        top = Math.max(6, window.innerHeight - subRect.height - 6);
      }
      sub.style.left = Math.max(6, left) + "px";
      sub.style.top = top + "px";
    }

    for (const vis of VISUALIZERS) {
      const item = el("div", "df-xp-menu-item");
      const isSelected = currentVisMode === vis.id;
      item.append(
        el("span", "df-xp-menu-check", isSelected ? "✓" : ""),
        el("span", null, vis.label),
        el("span", "df-xp-menu-arrow", "▶")
      );

      item.addEventListener("mouseenter", () => showSubmenuFor(item, vis));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        showSubmenuFor(item, vis);
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    openMenuEl = menu;
    positionMenuNearButton(menu, anchorBtn);
  }

  function uint8ToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function runDownloadFormat(fmt, extracted, statusLabel) {
    const filename = `mediaza_${extracted.uid}.${fmt.ext}`;
    if (fmt.id === "original") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(extracted.videoBlob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      statusLabel.textContent = `Скачано: ${filename}`;
      return;
    }

    statusLabel.textContent = `Подготовка .${fmt.ext}...`;
    const inputBytes = new Uint8Array(await extracted.videoBlob.arrayBuffer());
    const inputExt = (extracted.mime || "").includes("mp4") ? "m4a"
      : (extracted.mime || "").includes("mpeg") ? "mp3"
      : (extracted.mime || "").includes("ogg") ? "ogg"
      : (extracted.mime || "").includes("wav") ? "wav"
      : "webm";

    const inputName = `in_${extracted.uid}.${inputExt}`;
    const outputName = `out_${extracted.uid}.${fmt.ext}`;
    const jobId = extracted.uid + "_" + Date.now();

    const port = chrome.runtime.connect({ name: "df-convert" });
    port.onMessage.addListener((msg) => {
      if (msg.type === "progress") {
        if (msg.stage === "ffmpeg_download") {
          statusLabel.textContent = `Загрузка FFmpeg: ${msg.pct}%`;
        } else {
          statusLabel.textContent = `Конвертация .${fmt.ext}: ${msg.pct}%`;
        }
      } else if (msg.type === "done") {
        statusLabel.textContent = `Скачано: ${msg.filename}`;
        port.disconnect();
      } else if (msg.type === "error") {
        statusLabel.textContent = `Ошибка: ${msg.error}`;
        port.disconnect();
      }
    });

    port.postMessage({
      type: "START_CONVERT",
      jobId,
      inputName,
      outputName,
      inputBase64: uint8ToBase64(inputBytes),
      args: fmt.args(inputName, outputName),
      outMime: fmt.outMime,
      filename
    });
  }

  function openDownloadMenu(anchorBtn, extracted, isAudio, statusLabel) {
    if (openMenuEl && openMenuEl._anchor === anchorBtn) {
      closeOpenMenu();
      return;
    }
    closeOpenMenu();

    const menu = el("div", "df-xp-menu");
    menu._anchor = anchorBtn;

    menu.appendChild(el("div", "df-xp-menu-title", "Скачать в формате"));

    const formats = isAudio ? getAudioDownloadFormats(extracted.mime) : getVideoDownloadFormats();
    for (const fmt of formats) {
      const item = el("div", "df-xp-menu-item");
      item.append(
        el("span", "df-xp-menu-check", "⬇"),
        el("span", null, fmt.label)
      );
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        closeOpenMenu();
        runDownloadFormat(fmt, extracted, statusLabel);
      });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    openMenuEl = menu;
    positionMenuNearButton(menu, anchorBtn);
  }

  function isDirectImagePage() {
    const ct = (document.contentType || "").toLowerCase();
    if (ct.startsWith("image/")) return true;
    return /\.(gif|jpe?g|webp|png)(\?.*)?$/i.test(location.pathname);
  }

  function shouldRunOnThisPage() {
    return isDirectImagePage() || isEnabled;
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? "0" : ""}${rem}`;
  }

  function base64ToBlob(base64, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  function resolveUrl(raw) {
    if (!raw) return null;
    try {
      return new URL(raw, location.href).href;
    } catch (_) {
      return null;
    }
  }

  function extractGifUrl(img) {
    const dataGif = img.getAttribute("data-gif");
    if (dataGif && /\.gif(\?.*)?$/i.test(dataGif)) return resolveUrl(dataGif);

    const src = img.currentSrc || img.src;
    if (src && /\.gif(\?.*)?$/i.test(src)) return resolveUrl(src);

    const onclick = img.getAttribute("onclick") || "";
    const m = onclick.match(/['"]((?:https?:\/\/|\/)[^'"]+\.gif(?:\?[^'"]*)?)['"]/i);
    if (m && m[1]) return resolveUrl(m[1]);

    return null;
  }

  async function inspectUrl(url) {
    if (mediaCache.has(url)) return mediaCache.get(url);

    const task = (async () => {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          return DFCodec.extractFromBuffer(buf);
        }
      } catch (_) {}

      if (url.startsWith("http://") || url.startsWith("https://")) {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "FETCH_AND_EXTRACT", url }, (resp) => {
            if (chrome.runtime.lastError || !resp) {
              resolve({ found: false });
            } else if (resp.found && !resp.corrupted && resp.base64) {
              resolve({
                found: true,
                corrupted: false,
                uid: resp.uid,
                mime: resp.mime,
                videoBytes: new Uint8Array(0),
                videoBlob: base64ToBlob(resp.base64, resp.mime),
                coverBlob: resp.coverBase64 ? base64ToBlob(resp.coverBase64, resp.coverMime || "image/webp") : null
              });
            } else {
              resolve(resp);
            }
          });
        });
      }
      return { found: false };
    })();

    mediaCache.set(url, task);
    return task;
  }

  function savePlaybackState(state) {
    if (isUnloading) return;
    chrome.storage.local.set({ [STORAGE_PLAYBACK_KEY]: { ...state, updatedAt: Date.now() } });
  }

  function clearPlaybackState() {
    chrome.storage.local.remove(STORAGE_PLAYBACK_KEY);
  }

  function createPlayerController(originalImg, extracted, gifUrl, coverThumbOverride, directMode, gridLayout, restoreState) {
    injectStyles();
    const mediaUrl = URL.createObjectURL(extracted.videoBlob);
    const cleanCoverUrl = extracted.coverBlob ? URL.createObjectURL(extracted.coverBlob) : null;
    const isAudio = (extracted.mime || "").startsWith("audio/");

    const player = el("div", "df-xp-player");
    if (directMode) {
      player.style.position = "fixed";
      player.style.top = "50%";
      player.style.left = "50%";
      player.style.transform = "translate(-50%, -50%)";
      player.style.width = isAudio ? "360px" : "480px";
      player.style.maxWidth = "95vw";
      player.style.maxHeight = "95vh";
    } else if (!isAudio && (!originalImg || !originalImg.closest(".post-photos-grid"))) {
      player.style.width = "460px";
    }

    const hasLightbox = !directMode && originalImg && Boolean(originalImg.getAttribute("onclick"));
    const audioCoverThumb = cleanCoverUrl || coverThumbOverride || (originalImg ? resolveUrl(originalImg.getAttribute("data-still")) : null) || gifUrl;

    // 1. Заголовок XP
    const titlebar = el("div", "df-xp-titlebar");
    const titleLeft = el("div", "df-xp-title-left");
    titleLeft.append(
      el("span", null, isAudio ? "♫" : "▶"),
      el("span", null, `Медиаза ${isAudio ? "Аудио" : "Видео"} • ${extracted.uid}`)
    );

    const titleBtns = el("div", "df-xp-title-btns");
    let lbBtn = null;
    if (hasLightbox) {
      lbBtn = el("button", "df-xp-winbtn df-btn-lightbox", "↗");
      lbBtn.type = "button";
      lbBtn.title = "Открыть в окне сайта";
      titleBtns.appendChild(lbBtn);
    }
    let fsBtn = null;
    if (!isAudio) {
      fsBtn = el("button", "df-xp-winbtn df-btn-fs", "⛶");
      fsBtn.type = "button";
      fsBtn.title = "На весь экран";
      titleBtns.appendChild(fsBtn);
    }
    const closeFloatBtn = el("button", "df-xp-winbtn df-btn-close-float", "✕");
    closeFloatBtn.type = "button";
    closeFloatBtn.title = "Закрыть мини-плеер";
    titleBtns.appendChild(closeFloatBtn);
    titlebar.append(titleLeft, titleBtns);

    // 2. Экран (аудио или видео)
    let media = null;
    let videoPoster = null;
    let overlay = null;
    let centerPlay = null;
    let audioStage = null;
    let visCanvas = null;
    let visSubLabel = null;

    if (isAudio) {
      media = el("audio", "df-media-player");
      media.preload = "auto";
      media.src = mediaUrl;

      audioStage = el("div", "df-xp-audio-stage");
      audioStage.title = "Клик — пауза/воспроизведение";

      const artImg = el("img", "df-xp-audio-art");
      artImg.dataset.dfIgnore = "1";
      artImg.src = audioCoverThumb;
      artImg.alt = "";

      const visWrap = el("div", "df-xp-audio-vis");
      const badge = el("div", "df-xp-audio-badge");
      visSubLabel = el("span", "df-xp-audio-sub");
      badge.append(el("span", null, `Медиаза Аудио • ${extracted.uid}`), visSubLabel);

      visCanvas = el("canvas", "df-xp-vis-canvas");
      visCanvas.width = 260;
      visCanvas.height = 38;

      visWrap.append(badge, visCanvas);
      audioStage.append(artImg, visWrap);
      player.append(titlebar, media, audioStage);
    } else {
      const screen = el("div", "df-xp-screen");
      media = el("video", "df-media-player");
      media.playsInline = true;
      media.preload = "auto";
      media.src = mediaUrl;
      screen.appendChild(media);

      if (cleanCoverUrl) {
        videoPoster = el("img", "df-xp-video-poster");
        videoPoster.dataset.dfIgnore = "1";
        videoPoster.src = cleanCoverUrl;
        videoPoster.alt = "";
        screen.appendChild(videoPoster);
      }

      overlay = el("div", "df-xp-overlay");
      overlay.title = "Клик — пауза/воспроизведение, 2x клик — полный экран";
      centerPlay = el("div", "df-xp-center-play");
      centerPlay.appendChild(createSvgIcon("bigPlay"));
      overlay.appendChild(centerPlay);
      screen.appendChild(overlay);
      player.append(titlebar, screen);
    }

    // 3. LCD-полоса и перемотка
    const lcd = el("div", "df-xp-lcd");
    const seekWrap = el("div", "df-xp-seek-wrap");
    const seekTrack = el("div", "df-xp-seek-track");
    const seekFill = el("div", "df-xp-seek-fill");
    const seekThumb = el("div", "df-xp-seek-thumb");
    seekTrack.appendChild(seekFill);
    seekWrap.append(seekTrack, seekThumb);

    const lcdInfo = el("div", "df-xp-lcd-info");
    const timeLabel = el("span", "df-xp-time", "0:00 / 0:00");
    const statusLabel = el("span", "df-xp-status", "Загрузка...");
    lcdInfo.append(timeLabel, statusLabel);
    lcd.append(seekWrap, lcdInfo);

    // 4. Панель кнопок
    const controls = el("div", "df-xp-controls");
    const playBtn = el("button", "df-xp-btn-play");
    playBtn.type = "button";
    playBtn.title = "Воспроизвести / Пауза";
    setBtnIcon(playBtn, "play");

    const muteBtn = el("button", "df-xp-btn-round df-btn-mute");
    muteBtn.type = "button";
    muteBtn.title = "Звук";
    setBtnIcon(muteBtn, "volOn");

    const volWrap = el("div", "df-xp-vol-wrap");
    const volRange = el("input", "df-xp-vol");
    volRange.type = "range";
    volRange.min = "0";
    volRange.max = "1";
    volRange.step = "0.02";
    volRange.value = "1";
    volWrap.appendChild(volRange);

    const loopBtn = el("button", "df-xp-btn-round df-btn-loop", "↻");
    loopBtn.type = "button";
    loopBtn.title = "Повтор";

    controls.append(playBtn, muteBtn, volWrap, loopBtn);

    let settingsBtn = null;
    if (isAudio) {
      settingsBtn = el("button", "df-xp-btn-round df-btn-settings", "⚙");
      settingsBtn.type = "button";
      settingsBtn.title = "Визуализатор и чувствительность";
      controls.appendChild(settingsBtn);
    }

    const downloadBtn = el("button", "df-xp-btn-round df-btn-download", "⬇");
    downloadBtn.type = "button";
    downloadBtn.title = "Скачать в нужном формате";
    controls.appendChild(downloadBtn);

    player.append(lcd, controls);

    let slotEl = null;
    let slotPlaceholder = null;
    let slotObserver = null;
    let isFloating = false;
    let userDismissed = false;
    let slotVisible = true;
    let lastPersistAt = 0;

    let isDraggingSeek = false;
    let indexingState = "init";
    let pendingPlay = Boolean(restoreState?.playing);
    let pendingSeekTime = restoreState?.currentTime > 0 ? restoreState.currentTime : 0;
    let indexSafetyTimer = null;

    if (restoreState) {
      media.volume = typeof restoreState.volume === "number" ? restoreState.volume : 1;
      volRange.value = String(media.volume);
      media.muted = Boolean(restoreState.muted);
      setBtnIcon(muteBtn, (media.muted || media.volume === 0) ? "volOff" : "volOn");
      media.loop = Boolean(restoreState.loop);
      loopBtn.classList.toggle("active", media.loop);
    }

    const ctrl = {
      uid: extracted.uid,
      player,
      media,
      get isFloating() { return isFloating; },
      attachSlot,
      floatToCorner,
      dockToSlot,
      destroyOrDismiss
    };

    if (!directMode) {
      playerControllersByUid.set(extracted.uid, ctrl);
    }

    function hidePoster() {
      if (videoPoster) videoPoster.classList.add("hidden");
    }

    function persistStateNow(forcePlayingFlag) {
      if (directMode) return;
      const isPlaying = typeof forcePlayingFlag === "boolean" ? forcePlayingFlag : (!media.paused && !media.ended);
      if (isPlaying || isFloating) {
        savePlaybackState({
          uid: extracted.uid,
          gifUrl,
          coverThumb: audioCoverThumb,
          currentTime: isFinite(media.currentTime) ? media.currentTime : 0,
          playing: isPlaying,
          floating: isFloating,
          volume: media.volume,
          muted: media.muted,
          loop: media.loop
        });
      } else if (activeFloatingCtrl === ctrl) {
        clearPlaybackState();
      }
    }

    function updateSlotPlaceholderSize() {
      if (!slotPlaceholder) return;
      const rect = player.getBoundingClientRect();
      slotPlaceholder.style.minHeight = Math.max(120, Math.round(rect.height || 180)) + "px";
    }

    function floatToCorner() {
      if (directMode || isFloating) return;
      if (activeFloatingCtrl && activeFloatingCtrl !== ctrl) {
        activeFloatingCtrl.destroyOrDismiss(true);
      }
      if (slotEl && slotEl.isConnected) {
        updateSlotPlaceholderSize();
        slotPlaceholder.style.display = "flex";
      }
      isFloating = true;
      activeFloatingCtrl = ctrl;
      player.classList.add("df-xp-floating");
      document.body.appendChild(player);
      persistStateNow();
    }

    function dockToSlot() {
      if (!isFloating || !slotEl || !slotEl.isConnected) return;
      isFloating = false;
      if (activeFloatingCtrl === ctrl) activeFloatingCtrl = null;
      player.classList.remove("df-xp-floating");
      if (slotPlaceholder) slotPlaceholder.style.display = "none";
      slotEl.appendChild(player);
      persistStateNow();
    }

    function destroyOrDismiss(keepActiveCheck) {
      media.pause();
      isFloating = false;
      userDismissed = true;
      if (activeFloatingCtrl === ctrl) activeFloatingCtrl = null;
      if (!keepActiveCheck) clearPlaybackState();
      player.classList.remove("df-xp-floating");

      if (slotEl && slotEl.isConnected) {
        if (slotPlaceholder) slotPlaceholder.style.display = "none";
        slotEl.appendChild(player);
      } else {
        player.remove();
        if (playerControllersByUid.get(extracted.uid) === ctrl) {
          playerControllersByUid.delete(extracted.uid);
        }
      }
    }

    function attachSlot(newSlotEl, newGridLayout) {
      if (slotObserver) {
        slotObserver.disconnect();
        slotObserver = null;
      }
      slotEl = newSlotEl;
      if (newGridLayout) {
        if (newGridLayout.gridRow && newGridLayout.gridRow !== "auto / auto" && newGridLayout.gridRow !== "auto") {
          slotEl.style.gridRow = newGridLayout.gridRow;
        }
        if (newGridLayout.gridColumn && newGridLayout.gridColumn !== "auto / auto" && newGridLayout.gridColumn !== "auto") {
          slotEl.style.gridColumn = newGridLayout.gridColumn;
        }
      }

      slotPlaceholder = slotEl.querySelector(".df-xp-slot-placeholder");
      if (!slotPlaceholder) {
        slotPlaceholder = el("div", "df-xp-slot-placeholder", `Медиаза (${extracted.uid}) воспроизводится в мини-окне`);
        slotPlaceholder.style.display = "none";
        slotEl.appendChild(slotPlaceholder);
      }

      if (!isFloating) {
        slotEl.appendChild(player);
      } else {
        updateSlotPlaceholderSize();
        slotPlaceholder.style.display = "flex";
      }

      slotObserver = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        slotVisible = entry.isIntersecting;
        if (slotVisible) {
          if (isFloating) dockToSlot();
        } else {
          if (!isFloating && !userDismissed && !media.paused && !media.ended) {
            floatToCorner();
          }
        }
      }, { threshold: 0.12 });
      slotObserver.observe(slotEl);
    }

    function finishIndexing() {
      if (indexingState === "ready") return;
      indexingState = "ready";
      clearTimeout(indexSafetyTimer);
      if (pendingSeekTime > 0 && isFinite(media.duration) && pendingSeekTime < media.duration) {
        media.currentTime = pendingSeekTime;
        hidePoster();
      }
      pendingSeekTime = 0;

      const pct = (isFinite(media.duration) && media.duration > 0) ? (media.currentTime / media.duration) * 100 : 0;
      timeLabel.textContent = `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;
      updateProgressUI(pct);
      statusLabel.textContent = "Готов к воспроизведению";

      if (pendingPlay) {
        pendingPlay = false;
        hidePoster();
        ensureAnalyser().then(() => {
          media.play().catch(() => {
            statusLabel.textContent = "Кликните Play для продолжения";
          });
        });
      }
    }

    media.addEventListener("loadedmetadata", () => {
      if (isFinite(media.duration) && media.duration > 0) {
        finishIndexing();
      } else {
        indexingState = "seekingEnd";
        statusLabel.textContent = "Прогрузка...";
        media.currentTime = 1e101;
        indexSafetyTimer = setTimeout(() => {
          if (indexingState !== "ready") {
            media.currentTime = 0;
            finishIndexing();
          }
        }, 1500);
      }
    });

    media.addEventListener("durationchange", () => {
      if (indexingState === "ready") {
        timeLabel.textContent = `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;
      }
    });

    media.addEventListener("seeked", () => {
      if (indexingState === "seekingEnd") {
        indexingState = "rewinding";
        media.currentTime = 0;
      } else if (indexingState === "rewinding") {
        finishIndexing();
      } else if (indexingState === "ready") {
        persistStateNow();
      }
    });

    let audioCtx = null;
    let analyser = null;
    let freqData = null;
    let timeData = null;
    let eqRafId = null;

    const BAR_COUNT = 16;
    const peaks = new Float32Array(BAR_COUNT);
    const visCtx = visCanvas ? visCanvas.getContext("2d") : null;

    function updateVisLabel() {
      if (!visSubLabel) return;
      const sMap = { standard: "", tartini: "Тартини", high: "ВЧ", low: "НЧ" };
      visSubLabel.textContent = sMap[currentVisSens] || "";
    }
    updateVisLabel();
    activeVisualizers.add(() => {
      updateVisLabel();
      if (isAudio && (media.paused || media.ended)) drawIdleVis();
    });

    async function ensureAnalyser() {
      if (!isAudio) return;
      if (analyser) {
        if (audioCtx && audioCtx.state === "suspended") {
          await audioCtx.resume().catch(() => {});
        }
        return;
      }
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        if (ctx.state === "running") {
          const src = ctx.createMediaElementSource(media);
          const an = ctx.createAnalyser();
          an.fftSize = 1024;
          an.smoothingTimeConstant = 0.72;
          src.connect(an);
          an.connect(ctx.destination);
          audioCtx = ctx;
          analyser = an;
          freqData = new Uint8Array(an.frequencyBinCount);
          timeData = new Uint8Array(an.fftSize);
        } else {
          ctx.close().catch(() => {});
        }
      } catch (_) {}
    }

    function computeBands(count) {
      const out = new Float32Array(count);
      if (!freqData) return out;

      if (currentVisSens === "low") {
        for (let i = 0; i < count; i++) {
          const idx = 1 + Math.floor((i / count) * 13);
          out[i] = Math.min(1, (freqData[idx] / 255) * 1.15);
        }
      } else if (currentVisSens === "high") {
        for (let i = 0; i < count; i++) {
          const start = 55 + Math.floor((i / count) * 260);
          const end = 55 + Math.floor(((i + 1) / count) * 260);
          let maxV = 0;
          for (let b = start; b <= end && b < freqData.length; b++) {
            if (freqData[b] > maxV) maxV = freqData[b];
          }
          out[i] = Math.min(1, (maxV / 255) * 2.1);
        }
      } else if (currentVisSens === "tartini") {
        for (let i = 0; i < count; i++) {
          const f0 = 2 + i * 2;
          const h1 = freqData[f0] || 0;
          const h2 = freqData[f0 * 2] || 0;
          const h3 = freqData[f0 * 3] || 0;
          const h4 = freqData[f0 * 4] || 0;
          const beat12 = Math.sqrt((h1 / 255) * (h2 / 255));
          const beat23 = Math.sqrt((h2 / 255) * (h3 / 255));
          const beat34 = Math.sqrt((h3 / 255) * (h4 / 255));
          const val = beat12 * 0.65 + beat23 * 0.55 + beat34 * 0.45 + (h1 / 255) * 0.25;
          out[i] = Math.min(1, val * 1.25);
        }
      } else {
        for (let i = 0; i < count; i++) {
          const t0 = Math.pow(i / count, 1.85);
          const t1 = Math.pow((i + 1) / count, 1.85);
          const b0 = Math.max(1, Math.floor(1 + t0 * 210));
          const b1 = Math.max(b0, Math.floor(1 + t1 * 210));
          let sum = 0;
          for (let b = b0; b <= b1 && b < freqData.length; b++) sum += freqData[b];
          const avg = sum / (b1 - b0 + 1);
          out[i] = Math.min(1, (avg / 255) * (1.05 + i * 0.03));
        }
      }
      return out;
    }

    function computeFilteredWave(samplesCount) {
      const out = new Float32Array(samplesCount);
      if (!timeData) return out;
      const step = Math.floor(timeData.length / samplesCount);
      let lp = 0;
      let prev = 0;
      for (let i = 0; i < samplesCount; i++) {
        const raw = (timeData[i * step] - 128) / 128;
        if (currentVisSens === "low") {
          lp = lp * 0.82 + raw * 0.18;
          out[i] = Math.max(-1, Math.min(1, lp * 2.2));
        } else if (currentVisSens === "high") {
          const hp = raw - 0.9 * prev;
          prev = raw;
          out[i] = Math.max(-1, Math.min(1, hp * 2.4));
        } else if (currentVisSens === "tartini") {
          const prod = raw * prev * 3.5;
          prev = raw;
          out[i] = Math.max(-1, Math.min(1, raw * 0.55 + prod));
        } else {
          out[i] = raw;
        }
      }
      return out;
    }

    function drawIdleVis() {
      if (!visCtx || !visCanvas) return;
      const w = visCanvas.width;
      const h = visCanvas.height;
      visCtx.fillStyle = "#040b1c";
      visCtx.fillRect(0, 0, w, h);

      if (currentVisMode === "wave" || currentVisMode === "mirror") {
        visCtx.strokeStyle = "#1d4b9e";
        visCtx.lineWidth = 1;
        visCtx.beginPath();
        visCtx.moveTo(0, h / 2);
        visCtx.lineTo(w, h / 2);
        visCtx.stroke();
      } else {
        const gap = 2;
        const barW = (w - gap * (BAR_COUNT + 1)) / BAR_COUNT;
        visCtx.fillStyle = "#133375";
        for (let i = 0; i < BAR_COUNT; i++) {
          const x = gap + i * (barW + gap);
          visCtx.fillRect(x, h - 3, barW, 2);
        }
      }
    }

    function drawVisFrame() {
      if (!isAudio || !visCtx) return;
      const w = visCanvas.width;
      const h = visCanvas.height;
      visCtx.fillStyle = "#040b1c";
      visCtx.fillRect(0, 0, w, h);

      if (currentVisMode === "wave") {
        if (analyser && timeData) analyser.getByteTimeDomainData(timeData);
        const pts = 96;
        const wave = computeFilteredWave(pts);

        visCtx.strokeStyle = "rgba(56, 152, 255, 0.35)";
        visCtx.lineWidth = 4;
        visCtx.beginPath();
        for (let i = 0; i < pts; i++) {
          const x = (i / (pts - 1)) * w;
          const y = h / 2 + wave[i] * (h * 0.44);
          if (i === 0) visCtx.moveTo(x, y);
          else visCtx.lineTo(x, y);
        }
        visCtx.stroke();

        visCtx.strokeStyle = "#aee0ff";
        visCtx.lineWidth = 1.5;
        visCtx.stroke();
      } else {
        if (analyser && freqData) analyser.getByteFrequencyData(freqData);
        const bands = computeBands(currentVisMode === "mirror" ? 24 : BAR_COUNT);

        if (currentVisMode === "mirror") {
          const count = bands.length;
          const gap = 2;
          const barW = (w - gap * (count + 1)) / count;
          const mid = h / 2;

          visCtx.fillStyle = "#163b82";
          visCtx.fillRect(0, mid - 0.5, w, 1);

          for (let i = 0; i < count; i++) {
            const x = gap + i * (barW + gap);
            const halfH = Math.max(1, bands[i] * (mid - 2));
            const grad = visCtx.createLinearGradient(0, mid - halfH, 0, mid + halfH);
            grad.addColorStop(0, "#aee0ff");
            grad.addColorStop(0.5, "#2b82f6");
            grad.addColorStop(1, "#aee0ff");
            visCtx.fillStyle = grad;
            visCtx.fillRect(x, mid - halfH, barW, halfH * 2);
          }
        } else if (currentVisMode === "matrix") {
          const rows = 7;
          const gapX = 2;
          const gapY = 2;
          const cellW = (w - gapX * (BAR_COUNT + 1)) / BAR_COUNT;
          const cellH = (h - gapY * (rows + 1)) / rows;

          for (let i = 0; i < BAR_COUNT; i++) {
            const litRows = Math.round(bands[i] * rows);
            const x = gapX + i * (cellW + gapX);
            for (let r = 0; r < rows; r++) {
              const y = h - gapY - (r + 1) * cellH - r * gapY;
              if (r < litRows) {
                visCtx.fillStyle = r >= rows - 1 ? "#ffffff" : (r >= rows - 3 ? "#6cc0ff" : "#226fe0");
              } else {
                visCtx.fillStyle = "#0b1a3d";
              }
              visCtx.fillRect(x, y, cellW, cellH);
            }
          }
        } else {
          const gap = 2;
          const barW = (w - gap * (BAR_COUNT + 1)) / BAR_COUNT;
          for (let i = 0; i < BAR_COUNT; i++) {
            const val = bands[i];
            if (val > peaks[i]) peaks[i] = val;
            else peaks[i] = Math.max(0, peaks[i] - 0.018);

            const x = gap + i * (barW + gap);
            const barH = Math.max(2, val * (h - 3));
            const grad = visCtx.createLinearGradient(0, h - barH, 0, h);
            grad.addColorStop(0, "#aee0ff");
            grad.addColorStop(0.45, "#2b82f6");
            grad.addColorStop(1, "#11439e");
            visCtx.fillStyle = grad;
            visCtx.fillRect(x, h - barH, barW, barH);

            const peakY = Math.max(1, h - peaks[i] * (h - 3) - 2);
            visCtx.fillStyle = "#ffffff";
            visCtx.fillRect(x, peakY, barW, 1.5);
          }
        }
      }
    }

    function drawEqLoop() {
      if (!isAudio || media.paused || media.ended) {
        eqRafId = null;
        peaks.fill(0);
        drawIdleVis();
        return;
      }
      drawVisFrame();
      eqRafId = requestAnimationFrame(drawEqLoop);
    }

    if (isAudio) drawIdleVis();

    async function syncPlayState() {
      if (indexingState !== "ready") return;
      const playing = !media.paused && !media.ended;
      if (playing) {
        hidePoster();
        userDismissed = false;
        if (activeFloatingCtrl && activeFloatingCtrl !== ctrl) {
          activeFloatingCtrl.destroyOrDismiss(true);
        }
        if (!directMode && (!slotEl || !slotEl.isConnected || !slotVisible) && !isFloating) {
          floatToCorner();
        }
      }
      setBtnIcon(playBtn, playing ? "pause" : "play");
      if (centerPlay) centerPlay.classList.toggle("hidden", playing);
      statusLabel.textContent = playing ? "Воспроизведение" : (media.ended ? "Завершено" : "Пауза");

      persistStateNow(playing);

      if (isAudio) {
        if (playing) {
          await ensureAnalyser();
          if (!eqRafId) drawEqLoop();
        } else {
          if (eqRafId) {
            cancelAnimationFrame(eqRafId);
            eqRafId = null;
          }
          peaks.fill(0);
          drawIdleVis();
        }
      }
    }

    async function togglePlay() {
      if (indexingState !== "ready") {
        pendingPlay = true;
        statusLabel.textContent = "Прогрузка...";
        return;
      }
      if (media.paused || media.ended) {
        userDismissed = false;
        hidePoster();
        await ensureAnalyser();
        media.play().catch(() => {});
      } else {
        media.pause();
      }
    }

    function updateProgressUI(pct) {
      const clamped = Math.max(0, Math.min(100, pct));
      seekFill.style.width = clamped + "%";
      seekThumb.style.left = clamped + "%";
    }

    function seekFromPointer(clientX) {
      if (indexingState !== "ready") return;
      hidePoster();
      const rect = seekWrap.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      updateProgressUI(ratio * 100);
      if (isFinite(media.duration) && media.duration > 0) {
        media.currentTime = ratio * media.duration;
        timeLabel.textContent = `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;
      }
    }

    if (overlay) {
      overlay.addEventListener("click", () => togglePlay());
      overlay.addEventListener("dblclick", () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else player.requestFullscreen?.();
      });
    }

    if (audioStage) {
      audioStage.addEventListener("click", () => togglePlay());
    }

    playBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); });

    muteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      media.muted = !media.muted;
      setBtnIcon(muteBtn, (media.muted || media.volume === 0) ? "volOff" : "volOn");
      persistStateNow();
    });

    volRange.addEventListener("input", (e) => {
      e.stopPropagation();
      media.volume = Number(volRange.value);
      media.muted = media.volume === 0;
      setBtnIcon(muteBtn, media.muted ? "volOff" : "volOn");
      persistStateNow();
    });

    loopBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      media.loop = !media.loop;
      loopBtn.classList.toggle("active", media.loop);
      persistStateNow();
    });

    if (settingsBtn) {
      settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openVisMenu(settingsBtn);
      });
    }

    downloadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDownloadMenu(downloadBtn, extracted, isAudio, statusLabel);
    });

    if (fsBtn) {
      fsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (document.fullscreenElement) document.exitFullscreen();
        else player.requestFullscreen?.();
      });
    }

    if (lbBtn) {
      lbBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        media.pause();
        originalImg?.click();
      });
    }

    closeFloatBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      destroyOrDismiss(false);
    });

    seekWrap.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (indexingState !== "ready") return;
      isDraggingSeek = true;
      seekWrap.setPointerCapture(e.pointerId);
      seekFromPointer(e.clientX);
    });
    seekWrap.addEventListener("pointermove", (e) => {
      if (!isDraggingSeek) return;
      seekFromPointer(e.clientX);
    });
    seekWrap.addEventListener("pointerup", (e) => {
      if (!isDraggingSeek) return;
      isDraggingSeek = false;
      seekWrap.releasePointerCapture(e.pointerId);
      persistStateNow();
    });

    media.addEventListener("timeupdate", () => {
      if (isDraggingSeek || indexingState !== "ready") return;
      const pct = (isFinite(media.duration) && media.duration > 0) ? (media.currentTime / media.duration) * 100 : 0;
      updateProgressUI(pct);
      timeLabel.textContent = `${formatTime(media.currentTime)} / ${formatTime(media.duration)}`;

      const now = Date.now();
      if (!media.paused && now - lastPersistAt > 450) {
        lastPersistAt = now;
        persistStateNow(true);
      }
    });
    media.addEventListener("play", syncPlayState);
    media.addEventListener("pause", syncPlayState);
    media.addEventListener("ended", syncPlayState);

    if (restoreState?.floating && !directMode) {
      floatToCorner();
    }

    return ctrl;
  }

  async function processImage(img) {
    if (!shouldRunOnThisPage()) return;
    if (!img || img.dataset.dfIgnore === "1" || img.classList.contains("df-xp-audio-art") || img.classList.contains("df-xp-video-poster") || img.closest(".df-xp-player")) {
      return;
    }
    if (img.dataset.dfReplaced === "1") return;

    const gifUrl = extractGifUrl(img);
    if (!gifUrl) return;

    if (img.dataset.dfChecked === gifUrl) return;
    img.dataset.dfChecked = gifUrl;

    const extracted = await inspectUrl(gifUrl);
    if (!extracted || !extracted.found) return;

    if (extracted.corrupted) {
      console.log(`[Медиаза] Повреждённые данные в ${gifUrl}: ${extracted.reason}`);
      return;
    }

    if (!shouldRunOnThisPage() || img.dataset.dfReplaced === "1") return;

    const grid = img.closest(".post-photos-grid");
    let gridLayout = null;
    if (grid) {
      const cs = getComputedStyle(img);
      gridLayout = { gridRow: cs.gridRow, gridColumn: cs.gridColumn };
      grid.classList.add("df-has-players");
    }

    img.dataset.dfReplaced = "1";
    img.style.setProperty("display", "none", "important");

    if (isDirectImagePage()) {
      const ctrl = createPlayerController(img, extracted, gifUrl, null, true, null, { playing: true });
      img.insertAdjacentElement("afterend", ctrl.player);
      return;
    }

    const slot = el("div", "df-xp-slot");
    img.insertAdjacentElement("afterend", slot);

    const existingCtrl = playerControllersByUid.get(extracted.uid);
    if (existingCtrl && existingCtrl.isFloating) {
      console.log(`[Медиаза] Прикрепляем существующий плеер ID=${extracted.uid} обратно к посту.`);
      existingCtrl.attachSlot(slot, gridLayout);
      return;
    }

    console.log(`[Медиаза] Вставляем XP-плеер (${extracted.mime}) ID=${extracted.uid} для ${gifUrl}`);
    const ctrl = createPlayerController(img, extracted, gifUrl, null, false, gridLayout, null);
    ctrl.attachSlot(slot, gridLayout);
  }

  async function restoreCrossPagePlayer(saved) {
    if (!saved || !saved.gifUrl || !saved.uid) return;
    if (Date.now() - (saved.updatedAt || 0) > 2 * 60 * 60 * 1000) {
      clearPlaybackState();
      return;
    }
    if (!saved.playing && !saved.floating) return;

    await new Promise((r) => setTimeout(r, 150));
    if (playerControllersByUid.has(saved.uid)) {
      const existing = playerControllersByUid.get(saved.uid);
      if (saved.currentTime > 0 && isFinite(existing.media.duration)) {
        existing.media.currentTime = saved.currentTime;
      }
      if (saved.playing) existing.media.play().catch(() => {});
      return;
    }

    const extracted = await inspectUrl(saved.gifUrl);
    if (!extracted || !extracted.found || extracted.corrupted) return;
    if (playerControllersByUid.has(extracted.uid)) return;

    console.log(`[Медиаза] Восстанавливаем межстраничный плеер ID=${extracted.uid} в левом нижнем углу.`);
    createPlayerController(null, extracted, saved.gifUrl, saved.coverThumb, false, null, {
      ...saved,
      floating: true
    });
  }

  function setPlayersVisible(visible) {
    if (isDirectImagePage()) return;
    closeOpenMenu();
    document.querySelectorAll(".post-photos-grid").forEach((grid) => {
      if (visible && grid.querySelector(".df-xp-slot")) {
        grid.classList.add("df-has-players");
      } else {
        grid.classList.remove("df-has-players");
      }
    });
    document.querySelectorAll("img[data-df-replaced='1']").forEach((img) => {
      if (visible) {
        img.style.setProperty("display", "none", "important");
      } else {
        img.style.removeProperty("display");
      }
    });
    document.querySelectorAll(".df-xp-slot").forEach((slot) => {
      slot.style.display = visible ? "block" : "none";
    });
    document.querySelectorAll(".df-xp-player").forEach((player) => {
      if (player.classList.contains("df-xp-floating")) return;
      const media = player.querySelector(".df-media-player");
      if (visible) {
        player.style.removeProperty("display");
      } else {
        media?.pause();
        player.style.setProperty("display", "none", "important");
      }
    });
  }

  function scanAll() {
    if (!shouldRunOnThisPage()) return;
    document.querySelectorAll("img").forEach(processImage);
  }

  window.addEventListener("pagehide", () => {
    if (activeFloatingCtrl && !activeFloatingCtrl.media.paused) {
      const m = activeFloatingCtrl.media;
      chrome.storage.local.get(STORAGE_PLAYBACK_KEY, (d) => {
        if (d[STORAGE_PLAYBACK_KEY]) {
          chrome.storage.local.set({
            [STORAGE_PLAYBACK_KEY]: {
              ...d[STORAGE_PLAYBACK_KEY],
              currentTime: isFinite(m.currentTime) ? m.currentTime : 0,
              updatedAt: Date.now()
            }
          });
        }
      });
    }
    isUnloading = true;
  });

  chrome.storage.local.get(
    { enabled: true, visMode: "bars", visSens: "standard", [STORAGE_PLAYBACK_KEY]: null },
    (data) => {
      isEnabled = data.enabled;
      currentVisMode = data.visMode || "bars";
      currentVisSens = data.visSens || "standard";
      if (shouldRunOnThisPage()) scanAll();
      if (!isDirectImagePage() && isEnabled && data[STORAGE_PLAYBACK_KEY]) {
        restoreCrossPagePlayer(data[STORAGE_PLAYBACK_KEY]);
      }
    }
  );

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      isEnabled = changes.enabled.newValue;
      if (!isDirectImagePage()) {
        setPlayersVisible(isEnabled);
        if (isEnabled) scanAll();
      }
    }
  });

  const observer = new MutationObserver((mutations) => {
    if (!shouldRunOnThisPage()) return;
    for (const m of mutations) {
      if (m.target?.closest?.(".df-xp-player")) continue;
      if (m.type === "attributes" && m.target.tagName === "IMG") {
        processImage(m.target);
      } else if (m.type === "childList") {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.classList?.contains("df-xp-player") || node.closest?.(".df-xp-player")) return;
          if (node.tagName === "IMG") processImage(node);
          else node.querySelectorAll?.("img").forEach(processImage);
        });
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "data-gif"]
  });
})();