(function () {
  let isEnabled = true;
  const mediaCache = new Map();

  let activeFloatingCtrl = null;
  const playerControllersByUid = new Map();
  let isUnloading = false;

  const STORAGE_PLAYBACK_KEY = "activePlayback";

  function isDirectImagePage() {
    const ct = (document.contentType || "").toLowerCase();
    if (ct.startsWith("image/")) return true;
    return /\.(gif|jpe?g|webp|png)(\?.*)?$/i.test(location.pathname);
  }

  function shouldRunOnThisPage() {
    return isDirectImagePage() || isEnabled;
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

  function savePlaybackState(ctrl, state) {
    if (isUnloading) return;
    chrome.storage.local.set({ [STORAGE_PLAYBACK_KEY]: { ...state, updatedAt: Date.now() } });
  }

  function clearPlaybackState() {
    chrome.storage.local.remove(STORAGE_PLAYBACK_KEY);
  }

  function onActivateFloating(ctrl) {
    if (activeFloatingCtrl && activeFloatingCtrl !== ctrl) {
      activeFloatingCtrl.destroyOrDismiss(true);
    }
    activeFloatingCtrl = ctrl;
  }

  function onCloseFloating(ctrl, keepActiveCheck) {
    if (activeFloatingCtrl === ctrl) activeFloatingCtrl = null;
    if (!keepActiveCheck && !ctrl.player.isConnected) {
      playerControllersByUid.delete(ctrl.uid);
    }
  }

  function createSitePlayer(originalImg, extracted, gifUrl, coverThumbOverride, directMode, restoreState) {
    const ctrl = DFXpPlayer.createPlayerController({
      originalImg,
      extracted,
      gifUrl,
      coverThumbOverride,
      directMode,
      disableFloating: directMode,
      restoreState,
      onLog: (lvl, msg) => console.log(`[Медиаза][${extracted.uid}][${lvl}] ${msg}`),
      onActivateFloating,
      onCloseFloating,
      onPersistState: savePlaybackState,
      onClearState: clearPlaybackState
    });

    if (!directMode) {
      playerControllersByUid.set(extracted.uid, ctrl);
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
      const ctrl = createSitePlayer(img, extracted, gifUrl, null, true, { playing: true });
      img.insertAdjacentElement("afterend", ctrl.player);
      return;
    }

    const slot = document.createElement("div");
    slot.className = "df-xp-slot";
    img.insertAdjacentElement("afterend", slot);

    const existingCtrl = playerControllersByUid.get(extracted.uid);
    if (existingCtrl && existingCtrl.isFloating) {
      console.log(`[Медиаза] Прикрепляем существующий плеер ID=${extracted.uid} обратно к посту.`);
      existingCtrl.attachSlot(slot, gridLayout);
      return;
    }

    console.log(`[Медиаза] Вставляем XP-плеер (${extracted.mime}) ID=${extracted.uid} для ${gifUrl}`);
    const ctrl = createSitePlayer(img, extracted, gifUrl, null, false, null);
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
    createSitePlayer(null, extracted, saved.gifUrl, saved.coverThumb, false, {
      ...saved,
      floating: true
    });
  }

  function setPlayersVisible(visible) {
    if (isDirectImagePage()) return;
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
    { enabled: true, [STORAGE_PLAYBACK_KEY]: null },
    (data) => {
      isEnabled = data.enabled;
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