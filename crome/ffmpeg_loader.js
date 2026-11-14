(function (root) {
  const CORE_VERSION = "0.12.10";
  const MIRRORS = [
    `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
    `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`
  ];

  let activeDownloadPromise = null;

  async function fetchWithProgress(url, onChunk) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status + " (" + url + ")");

    const contentLength = Number(res.headers.get("content-length")) || 0;
    if (!res.body) {
      const buf = await res.arrayBuffer();
      onChunk(buf.byteLength, buf.byteLength);
      return buf;
    }

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onChunk(received, contentLength);
    }

    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out.buffer;
  }

  async function isReady() {
    const cached = await DFDatabase.getFFmpegCache();
    return Boolean(cached && cached.version === CORE_VERSION && cached.coreJs?.byteLength > 50000 && cached.coreWasm?.byteLength > 10000000);
  }

  async function ensureDownloaded(onProgress) {
    const cached = await DFDatabase.getFFmpegCache();
    if (cached && cached.version === CORE_VERSION && cached.coreJs?.byteLength > 50000 && cached.coreWasm?.byteLength > 10000000) {
      onProgress?.({ phase: "ready", pct: 100, loaded: cached.coreWasm.byteLength, total: cached.coreWasm.byteLength });
      return cached;
    }

    if (activeDownloadPromise) {
      return activeDownloadPromise;
    }

    activeDownloadPromise = (async () => {
      let lastErr = null;
      for (const base of MIRRORS) {
        try {
          onProgress?.({ phase: "downloading", pct: 1, loaded: 0, total: 32 * 1024 * 1024 });

          const coreJs = await fetchWithProgress(`${base}/ffmpeg-core.js`, () => {});
          const coreWasm = await fetchWithProgress(`${base}/ffmpeg-core.wasm`, (loaded, totalHeader) => {
            const estTotal = totalHeader > 1000000 ? totalHeader : 32 * 1024 * 1024;
            const pct = Math.min(99, Math.max(1, Math.round((loaded / estTotal) * 100)));
            onProgress?.({ phase: "downloading", pct, loaded, total: estTotal });
          });

          const bundle = {
            version: CORE_VERSION,
            coreJs,
            coreWasm,
            savedAt: Date.now()
          };
          await DFDatabase.saveFFmpegCache(bundle);
          onProgress?.({ phase: "ready", pct: 100, loaded: coreWasm.byteLength, total: coreWasm.byteLength });
          return bundle;
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr || new Error("Не удалось скачать FFmpeg с CDN");
    })();

    try {
      return await activeDownloadPromise;
    } finally {
      activeDownloadPromise = null;
    }
  }

  root.DFFmpegLoader = { isReady, ensureDownloaded };
})(window);