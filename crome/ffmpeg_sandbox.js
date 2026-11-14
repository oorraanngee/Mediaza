const WORKER_CODE = `
self.onmessage = async function (e) {
  const { coreJsBuf, coreWasmBuf, inputName, outputName, inputBytes, args } = e.data;
  let coreUrl = null;
  let wasmUrl = null;
  try {
    coreUrl = URL.createObjectURL(new Blob([coreJsBuf], { type: "text/javascript" }));
    wasmUrl = URL.createObjectURL(new Blob([coreWasmBuf], { type: "application/wasm" }));

    importScripts(coreUrl);
    if (typeof self.createFFmpegCore !== "function") {
      throw new Error("createFFmpegCore не найден в ffmpeg-core.js");
    }

    const mainScriptUrlOrBlob = coreUrl + "#" + btoa(JSON.stringify({ wasmURL: wasmUrl, workerURL: wasmUrl }));
    const core = await self.createFFmpegCore({
      mainScriptUrlOrBlob,
      locateFile: (p) => (p.endsWith(".wasm") ? wasmUrl : p)
    });

    core.setProgress(({ progress }) => {
      const pct = Math.max(0, Math.min(100, Math.round((progress || 0) * 100)));
      self.postMessage({ type: "progress", pct });
    });

    let lastLogs = [];
    core.setLogger(({ message }) => {
      if (message) {
        lastLogs.push(message);
        if (lastLogs.length > 20) lastLogs.shift();
      }
    });

    core.FS.writeFile(inputName, new Uint8Array(inputBytes));
    const exitCode = core.exec(...args);
    if (exitCode !== 0) {
      throw new Error("FFmpeg завершился с кодом " + exitCode + ": " + lastLogs.slice(-4).join(" | "));
    }

    const outBytes = core.FS.readFile(outputName);
    const outCopy = new Uint8Array(outBytes.byteLength);
    outCopy.set(outBytes);

    try { core.FS.unlink(inputName); } catch (_) {}
    try { core.FS.unlink(outputName); } catch (_) {}

    self.postMessage({ type: "done", outputBuffer: outCopy.buffer }, [outCopy.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", error: err && err.message ? err.message : String(err) });
  } finally {
    if (coreUrl) URL.revokeObjectURL(coreUrl);
    if (wasmUrl) URL.revokeObjectURL(wasmUrl);
  }
};
`;

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.cmd !== "RUN_FFMPEG") return;

  const replyTarget = event.source;
  const { jobId, coreJsBuf, coreWasmBuf, inputName, outputName, inputBuffer, args } = data;

  const workerBlob = new Blob([WORKER_CODE], { type: "text/javascript" });
  const workerUrl = URL.createObjectURL(workerBlob);
  const worker = new Worker(workerUrl);

  worker.onmessage = (we) => {
    const msg = we.data;
    if (msg.type === "progress") {
      replyTarget.postMessage({ jobId, type: "progress", pct: msg.pct }, "*");
    } else if (msg.type === "done") {
      replyTarget.postMessage({ jobId, type: "done", outputBuffer: msg.outputBuffer }, "*", [msg.outputBuffer]);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    } else if (msg.type === "error") {
      replyTarget.postMessage({ jobId, type: "error", error: msg.error }, "*");
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    }
  };

  worker.onerror = (err) => {
    replyTarget.postMessage({ jobId, type: "error", error: err.message || "Worker error" }, "*");
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
  };

  worker.postMessage(
    { coreJsBuf, coreWasmBuf, inputName, outputName, inputBytes: inputBuffer, args },
    [coreJsBuf, coreWasmBuf, inputBuffer]
  );
});