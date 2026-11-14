const sandboxFrame = document.getElementById("sandboxFrame");
const pendingJobs = new Map();

const sandboxReadyPromise = new Promise((resolve) => {
  if (sandboxFrame.contentWindow && sandboxFrame.contentDocument?.readyState === "complete") {
    resolve();
  } else {
    sandboxFrame.addEventListener("load", resolve, { once: true });
  }
});

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || !msg.jobId) return;
  const job = pendingJobs.get(msg.jobId);
  if (!job) return;

  if (msg.type === "progress") {
    chrome.runtime.sendMessage({
      target: "background",
      type: "CONVERT_PROGRESS",
      jobId: msg.jobId,
      stage: "encoding",
      pct: msg.pct
    });
  } else if (msg.type === "done") {
    pendingJobs.delete(msg.jobId);
    const outBase64 = arrayBufferToBase64(msg.outputBuffer);
    job.resolve({ ok: true, outBase64, outMime: job.outMime, filename: job.filename });
  } else if (msg.type === "error") {
    pendingJobs.delete(msg.jobId);
    job.reject(new Error(msg.error));
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen" || msg.type !== "RUN_CONVERT") return;

  (async () => {
    try {
      await sandboxReadyPromise;

      const bundle = await DFFmpegLoader.ensureDownloaded((p) => {
        if (p.phase === "downloading") {
          chrome.runtime.sendMessage({
            target: "background",
            type: "CONVERT_PROGRESS",
            jobId: msg.jobId,
            stage: "ffmpeg_download",
            pct: p.pct
          });
        }
      });

      const inputBuffer = base64ToArrayBuffer(msg.inputBase64);
      // Клонируем буферы из кэша, так как postMessage передаёт владение
      const coreJsBuf = bundle.coreJs.slice(0);
      const coreWasmBuf = bundle.coreWasm.slice(0);

      const result = await new Promise((resolve, reject) => {
        pendingJobs.set(msg.jobId, { resolve, reject, outMime: msg.outMime, filename: msg.filename });
        sandboxFrame.contentWindow.postMessage(
          {
            cmd: "RUN_FFMPEG",
            jobId: msg.jobId,
            coreJsBuf,
            coreWasmBuf,
            inputName: msg.inputName,
            outputName: msg.outputName,
            inputBuffer,
            args: msg.args
          },
          "*",
          [coreJsBuf, coreWasmBuf, inputBuffer]
        );
      });

      sendResponse(result);
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});