const mediaInput = document.getElementById("mediaInput");
const encoderSelect = document.getElementById("encoderSelect");
const coverMode = document.getElementById("coverMode");
const customCoverWrap = document.getElementById("customCoverWrap");
const coverInput = document.getElementById("coverInput");
const watermarkCheck = document.getElementById("watermarkCheck");
const customTextWrap = document.getElementById("customTextWrap");
const customText = document.getElementById("customText");
const videoSettingsRow = document.getElementById("videoSettingsRow");
const fpsSelect = document.getElementById("fpsSelect");
const bitrateSelect = document.getElementById("bitrateSelect");
const audioSettingsRow = document.getElementById("audioSettingsRow");
const audioBitrateSelect = document.getElementById("audioBitrateSelect");
const audioCopyOpt = document.getElementById("audioCopyOpt");

const convertBtn = document.getElementById("convertBtn");
const cancelBtn = document.getElementById("cancelBtn");
const statusText = document.getElementById("statusText");

const noticeLine = document.getElementById("noticeLine");
const warnAlertBox = document.getElementById("warnAlertBox");
const warnAlertText = document.getElementById("warnAlertText");
const downloadWarnLogBtn = document.getElementById("downloadWarnLogBtn");
const errorAlertBox = document.getElementById("errorAlertBox");
const errorAlertText = document.getElementById("errorAlertText");
const downloadErrorLogBtn = document.getElementById("downloadErrorLogBtn");

const previewWindow = document.getElementById("previewWindow");
const statsText = document.getElementById("statsText");
const previewImg = document.getElementById("previewImg");
const previewPlayerMount = document.getElementById("previewPlayerMount");
const saveDbBtn = document.getElementById("saveDbBtn");
const saveFileBtn = document.getElementById("saveFileBtn");
const savedList = document.getElementById("savedList");
const ffmpegStatusBanner = document.getElementById("ffmpegStatusBanner");
const sandboxFrame = document.getElementById("sandboxFrame");

let selectedFile = null;
let selectedType = null;
let customCoverFile = null;
let currentResult = null;
let abortController = null;
let activePreviewCtrl = null;

// --- 3-уровневая система логирования: NOTICE / WARN / ERROR ---
const logEntries = [];
const runWarns = [];
const runErrors = [];

function renderIssueBox(textEl, items, isError) {
  textEl.textContent = "";
  const listWrap = document.createElement("div");
  for (const msg of items) {
    const p = document.createElement("div");
    p.style.marginBottom = "4px";
    p.textContent = "• " + msg;
    listWrap.appendChild(p);
  }
  const footer = document.createElement("div");
  footer.style.marginTop = "6px";
  const prefix = document.createTextNode(
    (isError ? "Работа остановлена из-за ошибки. " : "") +
    "Пожалуйста, напишите контекст про ошибку в "
  );
  const link = document.createElement("a");
  link.href = "https://github.com/oorraanngee/Mediaza/issues";
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "https://github.com/oorraanngee/Mediaza/issues";
  const suffix = document.createTextNode(" и прикрепите скачанный файл лога (.txt).");
  footer.append(prefix, link, suffix);
  textEl.append(listWrap, footer);
}

function resetRunAlerts() {
  runWarns.length = 0;
  runErrors.length = 0;
  noticeLine.style.display = "none";
  noticeLine.textContent = "";
  warnAlertBox.style.display = "none";
  errorAlertBox.style.display = "none";
}

function addLog(level, message) {
  const now = new Date();
  const ts = now.toISOString().slice(11, 23);
  const line = `[${ts}] [${level}] ${message}`;
  logEntries.push(line);
  if (logEntries.length > 2500) logEntries.shift();

  if (level === "ERROR") {
    console.error("[Медиаза-Студия]", message);
    runErrors.push(message);
    errorAlertBox.style.display = "block";
    renderIssueBox(errorAlertText, runErrors, true);
  } else if (level === "WARN") {
    console.warn("[Медиаза-Студия]", message);
    runWarns.push(message);
    warnAlertBox.style.display = "block";
    renderIssueBox(warnAlertText, runWarns, false);
  } else if (level === "NOTICE") {
    console.info("[Медиаза-Студия][Оповещение]", message);
    noticeLine.style.display = "block";
    noticeLine.textContent = "Оповещение: " + message;
  } else {
    console.log("[Медиаза-Студия]", message);
  }
}

function downloadFullLogTxt() {
  const header = [
    "=== Медиаза — Диагностический лог студии ===",
    "Если возникла проблема, откройте Issue: https://github.com/oorraanngee/Mediaza/issues",
    "Опишите контекст (какой файл конвертировали, настройки, что произошло) и прикрепите этот файл.",
    "--------------------------------------------",
    `Версия расширения: ${chrome.runtime?.getManifest?.().version || "2.2.1"}`,
    `Браузер: ${navigator.userAgent}`,
    `Дата выгрузки: ${new Date().toISOString()}`,
    `Предупреждений в последнем прогоне: ${runWarns.length}, Критических ошибок: ${runErrors.length}`,
    "============================================",
    ""
  ].join("\n");

  const blob = new Blob([header + logEntries.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
  saveBlobToFile(blob, `mediaza_log_${Date.now()}.txt`);
}

downloadWarnLogBtn.addEventListener("click", downloadFullLogTxt);
downloadErrorLogBtn.addEventListener("click", downloadFullLogTxt);

window.addEventListener("error", (e) => {
  addLog("ERROR", `Uncaught error: ${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener("unhandledrejection", (e) => {
  addLog("ERROR", `Unhandled promise rejection: ${e.reason?.message || e.reason}`);
});

addLog("INFO", `Студия запущена. UA=${navigator.userAgent}`);

// --- Мост к sandboxFrame для FFmpeg ---
const sandboxReadyPromise = new Promise((resolve) => {
  if (sandboxFrame.contentWindow && sandboxFrame.contentDocument?.readyState === "complete") {
    resolve();
  } else {
    sandboxFrame.addEventListener("load", resolve, { once: true });
  }
});

const pendingFfmpegJobs = new Map();

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || !msg.jobId) return;
  const job = pendingFfmpegJobs.get(msg.jobId);
  if (!job) return;

  if (msg.type === "progress") {
    job.onProgress?.(msg.pct);
  } else if (msg.type === "log") {
    addLog("INFO", `[FFmpeg] ${msg.message}`);
  } else if (msg.type === "done") {
    pendingFfmpegJobs.delete(msg.jobId);
    job.resolve(msg.outputBuffer);
  } else if (msg.type === "error") {
    pendingFfmpegJobs.delete(msg.jobId);
    job.reject(new Error(msg.error));
  }
});

async function runFFmpegJob({ inputName, outputName, inputBuffer, args, onProgress }) {
  await sandboxReadyPromise;
  const bundle = await DFFmpegLoader.ensureDownloaded(updateFfmpegBanner);
  const coreJsBuf = bundle.coreJs.slice(0);
  const coreWasmBuf = bundle.coreWasm.slice(0);
  const jobId = "studio_" + Date.now() + "_" + Math.random().toString(16).slice(2);

  addLog("INFO", `Запуск FFmpeg: ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    pendingFfmpegJobs.set(jobId, { resolve, reject, onProgress });
    abortController = {
      cancel: () => {
        addLog("NOTICE", `Отмена задачи FFmpeg (${jobId})`);
        sandboxFrame.contentWindow.postMessage({ cmd: "CANCEL_FFMPEG", jobId }, "*");
      }
    };
    sandboxFrame.contentWindow.postMessage(
      { cmd: "RUN_FFMPEG", jobId, coreJsBuf, coreWasmBuf, inputName, outputName, inputBuffer, args },
      "*",
      [coreJsBuf, coreWasmBuf, inputBuffer]
    );
  });
}

function updateFfmpegBanner(p) {
  if (!ffmpegStatusBanner) return;
  if (p.phase === "ready") {
    ffmpegStatusBanner.textContent = "FFmpeg (конвертация и скачивание форматов): готов и сохранён в IndexedDB.";
    ffmpegStatusBanner.style.color = "#1b6b1b";
  } else {
    const mb = (p.loaded / (1024 * 1024)).toFixed(1);
    const totalMb = (p.total / (1024 * 1024)).toFixed(1);
    ffmpegStatusBanner.textContent = `FFmpeg: фоновая загрузка в IndexedDB — ${mb} / ~${totalMb} МБ (${p.pct}%)...`;
    ffmpegStatusBanner.style.color = "#003c74";
  }
}

DFFmpegLoader.ensureDownloaded(updateFfmpegBanner)
  .then(() => addLog("INFO", "FFmpeg в IndexedDB готов."))
  .catch((err) => {
    addLog("NOTICE", "Не удалось заранее скачать FFmpeg: " + err.message);
    if (ffmpegStatusBanner) {
      ffmpegStatusBanner.textContent = "FFmpeg: ошибка загрузки (" + err.message + "). Попробуем при конвертации.";
      ffmpegStatusBanner.style.color = "#b00";
    }
  });

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " Б";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КБ";
  return (bytes / (1024 * 1024)).toFixed(2) + " МБ";
}

function detectMediaType(file) {
  if (!file) return null;
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  const ext = file.name.split(".").pop().toLowerCase();
  if (["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac"].includes(ext)) return "audio";
  return "video";
}

function guessExt(file, fallback) {
  const parts = file.name.split(".");
  if (parts.length > 1) return parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "") || fallback;
  return fallback;
}

function guessAudioMime(file) {
  if (file.type && file.type.startsWith("audio/")) return file.type;
  const ext = file.name.split(".").pop().toLowerCase();
  const map = {
    mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/opus",
    wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", webm: "audio/webm"
  };
  return map[ext] || "audio/mpeg";
}

function fitBox(w, h, maxW, maxH) {
  const scale = Math.min(maxW / w, maxH / h, 1);
  const outW = Math.max(8, Math.floor((w * scale) / 2) * 2);
  const outH = Math.max(8, Math.floor((h * scale) / 2) * 2);
  return { width: outW, height: outH };
}

function wrapText(ctx, text, maxWidth) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось загрузить картинку обложки"));
    };
    img.src = url;
  });
}

function drawCoverCanvas(mode, withWatermark, userText, bgSource, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  if ((mode === "frame" || mode === "custom") && bgSource) {
    ctx.fillStyle = "#0d1321";
    ctx.fillRect(0, 0, w, h);

    const srcW = bgSource.videoWidth || bgSource.naturalWidth || w;
    const srcH = bgSource.videoHeight || bgSource.naturalHeight || h;
    const scale = Math.max(w / srcW, h / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const dx = (w - drawW) / 2;
    const dy = (h - drawH) / 2;
    ctx.drawImage(bgSource, dx, dy, drawW, drawH);

    if (withWatermark) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
      ctx.fillRect(0, 0, w, h);
    }
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#1c2b4a");
    grad.addColorStop(1, "#0d1321");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#4ea8de";
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, w - 12, h - 12);

    if (!withWatermark) {
      ctx.fillStyle = "rgba(78, 168, 222, 0.25)";
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#7dd3fc";
      if (selectedType === "audio") {
        ctx.font = "bold 26px Tahoma, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("♫", w / 2, h / 2 + 2);
      } else {
        ctx.beginPath();
        ctx.moveTo(w / 2 - 7, h / 2 - 11);
        ctx.lineTo(w / 2 + 13, h / 2);
        ctx.lineTo(w / 2 - 7, h / 2 + 11);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  if (withWatermark) {
    const trimmed = (userText || "").trim();
    const extraLines = trimmed ? wrapText(ctx, trimmed, w - 24).slice(0, 3) : [];
    const lineH = 19;
    const totalLines = 2 + (extraLines.length ? extraLines.length + 0.5 : 0);
    let y = Math.round((h - totalLines * lineH) / 2) + 14;

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px Tahoma, sans-serif";
    ctx.fillText("Установите расширение для просмотра", w / 2, y);
    y += lineH;

    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 13px Tahoma, sans-serif";
    ctx.fillText("ПКМ > Открыть в новой вкладке", w / 2, y);
    y += lineH + 8;

    if (extraLines.length) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "12px Tahoma, sans-serif";
      for (const ln of extraLines) {
        ctx.fillText(ln, w / 2, y);
        y += 16;
      }
    }
  }

  return canvas;
}

function canvasToCleanWebp(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
}

async function prepareVideoCovers(file, customImg) {
  const srcUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = srcUrl;
  video.playsInline = true;
  video.crossOrigin = "anonymous";

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("Не удалось прочитать метаданные видеофайла"));
    });

    const { width, height } = fitBox(video.videoWidth || 320, video.videoHeight || 240, 320, 240);
    const duration = video.duration || 0;
    addLog("INFO", `Исходное видео: ${video.videoWidth}x${video.videoHeight} -> QVGA ${width}x${height}, длительность=${duration.toFixed(2)}с, размер=${formatBytes(file.size)}`);

    if (coverMode.value === "frame" && duration > 0.3) {
      video.currentTime = Math.min(0.3, duration / 3);
      await new Promise((r) => { video.onseeked = r; });
    }

    const bgSource = coverMode.value === "custom" ? customImg : (coverMode.value === "frame" ? video : null);
    const coverCanvas = drawCoverCanvas(coverMode.value, watermarkCheck.checked, customText.value, bgSource, width, height);
    const cleanCanvas = drawCoverCanvas(coverMode.value, false, "", bgSource, width, height);
    const cleanCoverBlob = await canvasToCleanWebp(cleanCanvas);

    return { coverCanvas, cleanCoverBlob, width, height, duration };
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

function getAacAudioArgs(audioBitrate) {
  const channels = audioBitrate <= 32000 ? "1" : "2";
  // Небольшой запас громкости (0.92) убирает клиппинг на дропах; 44100 Hz AAC не падает в ffmpeg.wasm
  return ["-af", "volume=0.92", "-c:a", "aac", "-ar", "44100", "-b:a", String(audioBitrate), "-ac", channels];
}

async function transcodeVideoViaFFmpeg(file, fps, videoBitrate, audioBitrate, customImg, onProgress) {
  const { coverCanvas, cleanCoverBlob, width, height, duration } = await prepareVideoCovers(file, customImg);
  const inputExt = guessExt(file, "mp4");
  const inputName = `in_src.${inputExt}`;
  const outputName = `out_qvga.mp4`;
  const inputBuffer = await file.arrayBuffer();

  const args = [
    "-i", inputName,
    "-threads", "1",
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "fastdecode",
    "-profile:v", "baseline",
    "-level", "3.0",
    "-pix_fmt", "yuv420p",
    "-b:v", String(videoBitrate),
    "-maxrate", String(Math.round(videoBitrate * 1.4)),
    "-bufsize", String(Math.round(videoBitrate * 2)),
    "-g", String(fps * 2),
    "-movflags", "+faststart",
    ...getAacAudioArgs(audioBitrate),
    outputName
  ];

  const t0 = Date.now();
  const outBuffer = await runFFmpegJob({ inputName, outputName, inputBuffer, args, onProgress });
  const mediaBlob = new Blob([outBuffer], { type: "video/mp4" });
  addLog("INFO", `FFmpeg (H.264/AAC MP4) завершил кодирование за ${((Date.now() - t0) / 1000).toFixed(1)}с. Итоговый файл: ${formatBytes(mediaBlob.size)}`);
  return { mediaBlob, coverCanvas, cleanCoverBlob, width, height, duration };
}

async function transcodeVideoViaMediaRecorder(file, fps, videoBitrate, audioBitrate, customImg, onProgress) {
  addLog("NOTICE", "Запущен браузерный MediaRecorder (1x). Не сворачивайте вкладку до окончания записи.");
  const srcUrl = URL.createObjectURL(file);
  const hostBox = document.createElement("div");
  hostBox.style.cssText = "position:fixed; left:-9999px; top:0; width:2px; height:2px; opacity:0.01; pointer-events:none; overflow:hidden;";
  const video = document.createElement("video");
  video.src = srcUrl;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  hostBox.appendChild(video);
  document.body.appendChild(hostBox);

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("Не удалось прочитать видеофайл"));
    });

    const { width, height } = fitBox(video.videoWidth || 320, video.videoHeight || 240, 320, 240);
    const duration = video.duration || 0;

    if (coverMode.value === "frame" && duration > 0.3) {
      video.currentTime = Math.min(0.3, duration / 3);
      await new Promise((r) => { video.onseeked = r; });
    }

    const bgSource = coverMode.value === "custom" ? customImg : (coverMode.value === "frame" ? video : null);
    const coverCanvas = drawCoverCanvas(coverMode.value, watermarkCheck.checked, customText.value, bgSource, width, height);
    const cleanCanvas = drawCoverCanvas(coverMode.value, false, "", bgSource, width, height);
    const cleanCoverBlob = await canvasToCleanWebp(cleanCanvas);

    video.currentTime = 0;
    await new Promise((r) => { video.onseeked = r; });

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    const audioCtx = new AudioContext();
    await audioCtx.resume();
    const sourceNode = audioCtx.createMediaElementSource(video);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0.92;
    const destNode = audioCtx.createMediaStreamDestination();
    sourceNode.connect(gainNode);
    gainNode.connect(destNode);

    const canvasStream = canvas.captureStream(fps);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destNode.stream.getAudioTracks()
    ]);

    const mimeOptions = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
    const chosenMime = mimeOptions.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
    addLog("INFO", `MediaRecorder mime=${chosenMime}, fps=${fps}, videoBitrate=${videoBitrate}, audioBitrate=${audioBitrate}`);

    const recorder = new MediaRecorder(combinedStream, {
      mimeType: chosenMime,
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: audioBitrate
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    let cancelled = false;
    let rafId = null;
    let intervalId = null;
    let drawnFrames = 0;

    abortController = {
      cancel: () => {
        cancelled = true;
        video.pause();
        if (recorder.state !== "inactive") recorder.stop();
      }
    };

    const resultPromise = new Promise((resolve, reject) => {
      recorder.onstop = () => {
        cancelAnimationFrame(rafId);
        clearInterval(intervalId);
        audioCtx.close().catch(() => {});
        addLog("INFO", `MediaRecorder завершён: отрисовано кадров=${drawnFrames}, чанков=${chunks.length}`);
        if (cancelled) reject(new Error("Отменено пользователем"));
        else resolve(new Blob(chunks, { type: chosenMime }));
      };
      recorder.onerror = (e) => reject(e.error || new Error("Ошибка записи"));
    });

    function drawFrame() {
      if (video.paused || video.ended || cancelled) return;
      ctx.drawImage(video, 0, 0, width, height);
      drawnFrames++;
      if (duration > 0) {
        onProgress(Math.min(100, Math.round((video.currentTime / duration) * 100)));
      }
    }

    function renderLoop() {
      if (video.paused || video.ended || cancelled) return;
      drawFrame();
      rafId = requestAnimationFrame(renderLoop);
    }

    video.onended = () => {
      setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 120);
    };

    recorder.start(500);
    await video.play();
    renderLoop();
    intervalId = setInterval(drawFrame, Math.max(25, Math.round(1000 / fps)));

    const videoBlob = await resultPromise;
    return { mediaBlob: videoBlob, coverCanvas, cleanCoverBlob, width, height, duration };
  } finally {
    URL.revokeObjectURL(srcUrl);
    hostBox.remove();
  }
}

async function processAudio(file, audioMode, customImg, onProgress) {
  let width = 320;
  let height = 180;
  if (coverMode.value === "custom" && customImg) {
    const fitted = fitBox(customImg.naturalWidth || 320, customImg.naturalHeight || 320, 320, 320);
    width = fitted.width;
    height = fitted.height;
  }

  const bgSource = coverMode.value === "custom" ? customImg : null;
  const coverCanvas = drawCoverCanvas(coverMode.value, watermarkCheck.checked, customText.value, bgSource, width, height);
  const cleanCanvas = drawCoverCanvas(coverMode.value, false, "", bgSource, width, height);
  const cleanCoverBlob = await canvasToCleanWebp(cleanCanvas);

  if (audioMode === "copy") {
    const mime = guessAudioMime(file);
    const mediaBlob = new Blob([await file.arrayBuffer()], { type: mime });
    addLog("INFO", `Аудио упаковано без пережатия (${mime}, ${formatBytes(mediaBlob.size)})`);
    return { mediaBlob, coverCanvas, cleanCoverBlob, width, height, duration: 0 };
  }

  const audioBitrate = Number(audioMode);
  if (encoderSelect.value === "ffmpeg") {
    try {
      const inputExt = guessExt(file, "mp3");
      const inputName = `in_aud.${inputExt}`;
      const outputName = `out_aud.m4a`;
      const inputBuffer = await file.arrayBuffer();
      const args = ["-i", inputName, "-threads", "1", "-vn", ...getAacAudioArgs(audioBitrate), "-movflags", "+faststart", outputName];
      const outBuffer = await runFFmpegJob({ inputName, outputName, inputBuffer, args, onProgress });
      const mediaBlob = new Blob([outBuffer], { type: "audio/mp4" });
      addLog("INFO", `FFmpeg (AAC M4A) сжал аудио: ${formatBytes(file.size)} -> ${formatBytes(mediaBlob.size)}`);
      return { mediaBlob, coverCanvas, cleanCoverBlob, width, height, duration: 0 };
    } catch (ffErr) {
      if (ffErr.message === "Отменено пользователем") throw ffErr;
      addLog(
        "WARN",
        `Кодировщик FFmpeg для аудио завершился с ошибкой (${ffErr.message}). Выполнен откат на браузерный MediaRecorder (1x) — качество и скорость сжатия могут измениться.`
      );
      statusText.textContent = "Откат на MediaRecorder (1x): 0%...";
    }
  }

  const srcUrl = URL.createObjectURL(file);
  const audio = document.createElement("audio");
  audio.src = srcUrl;
  audio.crossOrigin = "anonymous";

  await new Promise((resolve, reject) => {
    audio.onloadedmetadata = resolve;
    audio.onerror = () => reject(new Error("Не удалось прочитать аудиофайл"));
  });

  const duration = audio.duration || 0;
  const audioCtx = new AudioContext();
  await audioCtx.resume();
  const sourceNode = audioCtx.createMediaElementSource(audio);
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.92;
  const destNode = audioCtx.createMediaStreamDestination();
  sourceNode.connect(gainNode);
  gainNode.connect(destNode);

  const mimeOptions = ["audio/webm;codecs=opus", "audio/webm"];
  const chosenMime = mimeOptions.find((m) => MediaRecorder.isTypeSupported(m)) || "audio/webm";

  const recorder = new MediaRecorder(destNode.stream, {
    mimeType: chosenMime,
    audioBitsPerSecond: audioBitrate
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  let cancelled = false;
  let timerId = null;

  abortController = {
    cancel: () => {
      cancelled = true;
      audio.pause();
      if (recorder.state !== "inactive") recorder.stop();
    }
  };

  const resultPromise = new Promise((resolve, reject) => {
    recorder.onstop = () => {
      clearInterval(timerId);
      audioCtx.close().catch(() => {});
      URL.revokeObjectURL(srcUrl);
      if (cancelled) reject(new Error("Отменено пользователем"));
      else resolve(new Blob(chunks, { type: chosenMime }));
    };
    recorder.onerror = (e) => reject(e.error || new Error("Ошибка записи аудио"));
  });

  timerId = setInterval(() => {
    if (duration > 0 && !audio.paused) {
      onProgress(Math.min(100, Math.round((audio.currentTime / duration) * 100)));
    }
  }, 200);

  audio.onended = () => {
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, 120);
  };

  recorder.start(250);
  await audio.play();

  const mediaBlob = await resultPromise;
  return { mediaBlob, coverCanvas, cleanCoverBlob, width, height, duration };
}

async function showPreview(item) {
  if (activePreviewCtrl) {
    activePreviewCtrl.media.pause();
    activePreviewCtrl = null;
  }
  if (previewImg.src.startsWith("blob:")) URL.revokeObjectURL(previewImg.src);

  previewImg.src = URL.createObjectURL(item.blob);
  previewPlayerMount.textContent = "";

  const buf = await item.blob.arrayBuffer();
  const decoded = DFCodec.extractFromBuffer(buf, item._rawPayload);

  if (decoded && decoded.found && !decoded.corrupted) {
    const isAudio = decoded.mime.startsWith("audio/");
    const ctrl = DFXpPlayer.createPlayerController({
      extracted: decoded,
      disableFloating: true,
      onLog: (lvl, msg) => addLog(lvl, `[Preview-${decoded.uid}] ${msg}`)
    });
    activePreviewCtrl = ctrl;
    previewPlayerMount.appendChild(ctrl.player);

    const cleanCoverInfo = decoded.coverBlob ? ` | Чистая обложка: ${formatBytes(decoded.coverBlob.size)}` : "";
    statsText.textContent =
      `Файл: ${item.name} | ID: ${decoded.uid} | Тип: ${isAudio ? "Аудио" : "Видео"} (${decoded.mime}) | Размер GIF: ${item.width}×${item.height} | Медиа: ${formatBytes(item.videoSize)}${cleanCoverInfo} | Итоговый GIF: ${formatBytes(item.blob.size)}`;
    addLog("INFO", `Предпросмотр готов: ${statsText.textContent}`);
  } else {
    const reason = decoded?.reason || "старый или повреждённый формат";
    statsText.textContent = `Файл: ${item.name} | Не удалось декодировать (${reason})`;
    addLog("ERROR", `Ошибка декодирования предпросмотра: ${reason}`);
  }
  previewWindow.style.display = "block";
}

function updateCoverUi() {
  const frameOpt = coverMode.querySelector('option[value="frame"]');
  if (selectedType === "audio") {
    frameOpt.disabled = true;
    if (coverMode.value === "frame") coverMode.value = "placeholder";
    audioCopyOpt.disabled = false;
    audioCopyOpt.hidden = false;
  } else {
    frameOpt.disabled = false;
    audioCopyOpt.disabled = true;
    audioCopyOpt.hidden = true;
    if (audioBitrateSelect.value === "copy") {
      audioBitrateSelect.value = "64000";
    }
  }

  customCoverWrap.style.display = coverMode.value === "custom" ? "inline-block" : "none";
  customTextWrap.style.display = watermarkCheck.checked ? "inline-block" : "none";

  videoSettingsRow.style.display = selectedType === "audio" ? "none" : "flex";
  audioSettingsRow.style.display = "flex";
}

coverMode.addEventListener("change", updateCoverUi);
watermarkCheck.addEventListener("change", updateCoverUi);
coverInput.addEventListener("change", () => {
  customCoverFile = coverInput.files[0] || null;
});

mediaInput.addEventListener("change", () => {
  selectedFile = mediaInput.files[0] || null;
  selectedType = detectMediaType(selectedFile);
  convertBtn.disabled = !selectedFile;
  updateCoverUi();
  if (selectedFile) {
    const kind = selectedType === "audio" ? "Аудио" : "Видео";
    statusText.textContent = `Выбрано (${kind}): ${selectedFile.name} (${formatBytes(selectedFile.size)})`;
    addLog("INFO", `Выбран файл (${kind}): ${selectedFile.name}, ${selectedFile.size} Б, type="${selectedFile.type}"`);
  }
});

convertBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  if (coverMode.value === "custom" && !customCoverFile) {
    alert("Выберите свою картинку для обложки!");
    return;
  }

  resetRunAlerts();
  convertBtn.disabled = true;
  cancelBtn.style.display = "inline-block";
  saveDbBtn.disabled = false;

  const useFFmpeg = encoderSelect.value === "ffmpeg" && !(selectedType === "audio" && audioBitrateSelect.value === "copy");

  try {
    if (useFFmpeg && !(await DFFmpegLoader.isReady())) {
      statusText.textContent = "Ожидание докачки FFmpeg в IndexedDB...";
      addLog("NOTICE", "FFmpeg не в кэше — докачиваем перед конвертацией...");
      await DFFmpegLoader.ensureDownloaded(updateFfmpegBanner);
    }

    let customImg = null;
    if (coverMode.value === "custom" && customCoverFile) {
      statusText.textContent = "Загрузка своей обложки...";
      customImg = await loadImageFile(customCoverFile);
    }

    let result;
    if (selectedType === "audio") {
      statusText.textContent = audioBitrateSelect.value === "copy" ? "Упаковка аудио..." : "Сжатие аудио: 0%...";
      result = await processAudio(
        selectedFile,
        audioBitrateSelect.value,
        customImg,
        (pct) => { statusText.textContent = `Сжатие аудио: ${pct}%...`; }
      );
    } else {
      const fps = Number(fpsSelect.value);
      const bitrate = Number(bitrateSelect.value);
      const audioBitrate = audioBitrateSelect.value === "copy" ? 64000 : Number(audioBitrateSelect.value);
      statusText.textContent = "Сжатие видео: 0%...";
      if (encoderSelect.value === "ffmpeg") {
        try {
          result = await transcodeVideoViaFFmpeg(
            selectedFile, fps, bitrate, audioBitrate, customImg,
            (pct) => { statusText.textContent = `FFmpeg сжатие видео: ${pct}%...`; }
          );
        } catch (ffErr) {
          if (ffErr.message === "Отменено пользователем") throw ffErr;
          addLog(
            "WARN",
            `Основной кодировщик FFmpeg завершился с ошибкой (${ffErr.message}). Выполнен откат на браузерный MediaRecorder — качество видео и FPS могут заметно пострадать из-за смены кодировщика (особенно при переключении или сворачивании вкладки).`
          );
          statusText.textContent = "Откат на MediaRecorder (1x): 0%...";
          result = await transcodeVideoViaMediaRecorder(
            selectedFile, fps, bitrate, audioBitrate, customImg,
            (pct) => { statusText.textContent = `MediaRecorder сжатие: ${pct}%...`; }
          );
        }
      } else {
        result = await transcodeVideoViaMediaRecorder(
          selectedFile, fps, bitrate, audioBitrate, customImg,
          (pct) => { statusText.textContent = `MediaRecorder сжатие: ${pct}%...`; }
        );
      }
    }

    statusText.textContent = "Сборка GIF-кадров (LZW)...";
    const packed = await DFCodec.packToGif(result.coverCanvas, result.mediaBlob, result.cleanCoverBlob);
    addLog("INFO", `GIF собран: ID=${packed.uid}, кадров с данными=${packed.dataFrameCount}, итоговый вес=${formatBytes(packed.blob.size)}`);

    const baseName = selectedFile.name.replace(/\.[^.]+$/, "") + `_${packed.uid}.gif`;

    currentResult = {
      name: baseName,
      uid: packed.uid,
      blob: packed.blob,
      width: result.width,
      height: result.height,
      duration: result.duration,
      videoSize: result.mediaBlob.size,
      mediaKind: selectedType,
      createdAt: Date.now(),
      _rawPayload: packed.rawPayload
    };

    await showPreview(currentResult);
    statusText.textContent = `Готово! ID: ${packed.uid}, кадров с данными: ${packed.dataFrameCount}.`;
  } catch (err) {
    if (err.message === "Отменено пользователем") {
      statusText.textContent = "Конвертация отменена.";
      addLog("NOTICE", "Конвертация отменена пользователем.");
    } else {
      statusText.textContent = "Ошибка: " + err.message;
      addLog("ERROR", `Критический сбой конвертации: ${err.message}`);
    }
  } finally {
    convertBtn.disabled = !selectedFile;
    cancelBtn.style.display = "none";
    abortController = null;
  }
});

cancelBtn.addEventListener("click", () => {
  if (abortController) abortController.cancel();
});

saveDbBtn.addEventListener("click", async () => {
  if (!currentResult) return;
  const { _rawPayload, ...toSave } = currentResult;
  await DFDatabase.saveImage(toSave);
  saveDbBtn.disabled = true;
  statusText.textContent = "Сохранено в IndexedDB!";
  await renderSavedList();
});

saveFileBtn.addEventListener("click", () => {
  if (!currentResult) return;
  saveBlobToFile(currentResult.blob, currentResult.name);
});

function saveBlobToFile(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function renderSavedList() {
  const items = await DFDatabase.getAllImages();
  savedList.textContent = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.style.fontSize = "13px";
    empty.style.color = "#666";
    empty.textContent = "Пока пусто.";
    savedList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "saved-item";

    const img = document.createElement("img");
    img.src = URL.createObjectURL(item.blob);

    const info = document.createElement("div");
    info.className = "saved-info";
    const titleEl = document.createElement("b");
    titleEl.textContent = item.name;
    const uidLabel = item.uid ? `ID: ${item.uid}` : "старый формат";
    const kindLabel = item.mediaKind === "audio" ? "Аудио" : "Видео";
    info.append(
      titleEl,
      document.createElement("br"),
      document.createTextNode(`${kindLabel} • ${uidLabel} • ${item.width}×${item.height} • Всего: ${formatBytes(item.blob.size)} (медиа: ${formatBytes(item.videoSize)})`)
    );

    const actions = document.createElement("div");
    actions.className = "saved-actions";

    const playBtn = document.createElement("button");
    playBtn.textContent = "Просмотр";
    playBtn.onclick = async () => {
      currentResult = item;
      saveDbBtn.disabled = true;
      await showPreview(item);
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Сохранить";
    saveBtn.onclick = () => saveBlobToFile(item.blob, item.name);

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Удалить";
    delBtn.onclick = async () => {
      await DFDatabase.deleteImage(item.id);
      await renderSavedList();
    };

    actions.append(playBtn, saveBtn, delBtn);
    row.append(img, info, actions);
    savedList.appendChild(row);
  }
}

updateCoverUi();
renderSavedList();