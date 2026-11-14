importScripts("gif.js", "codec.js");

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

let offscreenCreating = null;
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) return;
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }
  offscreenCreating = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "FFmpeg WebAssembly conversion inside sandboxed worker"
  });
  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

const activePorts = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === "background" && msg.type === "CONVERT_PROGRESS") {
    const port = activePorts.get(msg.jobId);
    if (port) {
      try {
        port.postMessage({ type: "progress", stage: msg.stage, pct: msg.pct });
      } catch (_) {}
    }
    return;
  }

  if (msg.type === "FETCH_AND_EXTRACT" && msg.url) {
    fetch(msg.url)
      .then(async (res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        const buf = await res.arrayBuffer();
        const extracted = DFCodec.extractFromBuffer(buf);
        if (!extracted.found || extracted.corrupted) {
          sendResponse({
            found: extracted.found,
            corrupted: extracted.corrupted,
            fileSize: buf.byteLength,
            reason: extracted.reason
          });
        } else {
          sendResponse({
            found: true,
            corrupted: false,
            uid: extracted.uid,
            mime: extracted.mime,
            fileSize: buf.byteLength,
            base64: uint8ToBase64(extracted.videoBytes),
            coverMime: extracted.coverMime || null,
            coverBase64: extracted.coverBytes ? uint8ToBase64(extracted.coverBytes) : null
          });
        }
      })
      .catch((err) => {
        sendResponse({ found: false, error: err.message });
      });
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "df-convert") return;

  let jobId = null;
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "START_CONVERT") return;
    jobId = msg.jobId;
    activePorts.set(jobId, port);

    try {
      await ensureOffscreen();
      const resp = await chrome.runtime.sendMessage({
        target: "offscreen",
        type: "RUN_CONVERT",
        jobId,
        inputName: msg.inputName,
        outputName: msg.outputName,
        inputBase64: msg.inputBase64,
        args: msg.args,
        outMime: msg.outMime,
        filename: msg.filename
      });

      if (!resp || !resp.ok) {
        port.postMessage({ type: "error", error: resp?.error || "Ошибка конвертации" });
      } else {
        const dataUrl = `data:${resp.outMime};base64,${resp.outBase64}`;
        chrome.downloads.download({ url: dataUrl, filename: resp.filename, saveAs: false }, () => {
          port.postMessage({ type: "done", filename: resp.filename });
        });
      }
    } catch (err) {
      port.postMessage({ type: "error", error: err.message });
    } finally {
      activePorts.delete(jobId);
    }
  });

  port.onDisconnect.addListener(() => {
    if (jobId) activePorts.delete(jobId);
  });
});