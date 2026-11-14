function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

  let activeWorker = null;

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "START_CONVERT") return;

    try {
      const bundle = await DFFmpegLoader.ensureDownloaded((p) => {
        if (p.phase === "downloading") {
          try {
            port.postMessage({ type: "progress", stage: "ffmpeg_download", pct: p.pct });
          } catch (_) {}
        }
      });

      const coreWasmBuf = bundle.coreWasm.slice(0);
      const inputBuffer = base64ToArrayBuffer(msg.inputBase64);

      activeWorker = new Worker(chrome.runtime.getURL("ffmpeg_worker.js"));

      activeWorker.onmessage = (we) => {
        const wmsg = we.data;
        if (wmsg.type === "progress") {
          try {
            port.postMessage({ type: "progress", stage: "encoding", pct: wmsg.pct });
          } catch (_) {}
        } else if (wmsg.type === "done") {
          const outBlob = new Blob([wmsg.outputBuffer], { type: msg.outMime });
          const blobUrl = URL.createObjectURL(outBlob);
          chrome.downloads.download({ url: blobUrl, filename: msg.filename, saveAs: false }, () => {
            try {
              port.postMessage({ type: "done", filename: msg.filename });
            } catch (_) {}
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          });
          activeWorker?.terminate();
          activeWorker = null;
        } else if (wmsg.type === "error") {
          try {
            port.postMessage({ type: "error", error: wmsg.error });
          } catch (_) {}
          activeWorker?.terminate();
          activeWorker = null;
        }
      };

      activeWorker.onerror = (err) => {
        try {
          port.postMessage({ type: "error", error: err.message || "Worker error" });
        } catch (_) {}
        activeWorker?.terminate();
        activeWorker = null;
      };

      activeWorker.postMessage(
        {
          coreWasmBuf,
          inputName: msg.inputName,
          outputName: msg.outputName,
          inputBytes: inputBuffer,
          args: msg.args
        },
        [coreWasmBuf, inputBuffer]
      );
    } catch (err) {
      try {
        port.postMessage({ type: "error", error: err.message });
      } catch (_) {}
    }
  });

  port.onDisconnect.addListener(() => {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
  });
});