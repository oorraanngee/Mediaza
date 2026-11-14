importScripts("ffmpeg-core.js");

self.onmessage = async function (e) {
  const { coreWasmBuf, inputName, outputName, inputBytes, args } = e.data;
  try {
    if (typeof self.createFFmpegCore !== "function") {
      throw new Error("createFFmpegCore не найден в ffmpeg-core.js");
    }

    const core = await self.createFFmpegCore({
      wasmBinary: new Uint8Array(coreWasmBuf)
    });

    core.setProgress(({ progress }) => {
      const pct = Math.max(0, Math.min(100, Math.round((progress || 0) * 100)));
      self.postMessage({ type: "progress", pct });
    });

    const lastLogs = [];
    core.setLogger(({ message }) => {
      if (message) {
        lastLogs.push(message);
        if (lastLogs.length > 30) lastLogs.shift();
        self.postMessage({ type: "log", message });
      }
    });

    core.FS.writeFile(inputName, new Uint8Array(inputBytes));
    const exitCode = core.exec(...args);
    if (exitCode !== 0) {
      throw new Error("FFmpeg завершился с кодом " + exitCode + ": " + lastLogs.slice(-5).join(" | "));
    }

    const outBytes = core.FS.readFile(outputName);
    const outCopy = new Uint8Array(outBytes.byteLength);
    outCopy.set(outBytes);

    try { core.FS.unlink(inputName); } catch (_) {}
    try { core.FS.unlink(outputName); } catch (_) {}

    self.postMessage({ type: "done", outputBuffer: outCopy.buffer }, [outCopy.buffer]);
  } catch (err) {
    self.postMessage({ type: "error", error: err && err.message ? err.message : String(err) });
  }
};