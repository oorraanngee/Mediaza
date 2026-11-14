const mediaInput = document.getElementById("mediaInput");
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

const convertBtn = document.getElementById("convertBtn");
const cancelBtn = document.getElementById("cancelBtn");
const statusText = document.getElementById("statusText");

const previewWindow = document.getElementById("previewWindow");
const statsText = document.getElementById("statsText");
const previewImg = document.getElementById("previewImg");
const previewVideo = document.getElementById("previewVideo");
const previewAudio = document.getElementById("previewAudio");
const saveDbBtn = document.getElementById("saveDbBtn");
const saveFileBtn = document.getElementById("saveFileBtn");
const savedList = document.getElementById("savedList");

const ffmpegStatusBanner = document.getElementById("ffmpegStatusBanner");

function updateFfmpegBanner(p) {
  if (!ffmpegStatusBanner) return;
  if (p.phase === "ready") {
    ffmpegStatusBanner.textContent = "FFmpeg (для скачивания .mp4/.3gp/.avi/.mp3): готов и сохранён в IndexedDB.";
    ffmpegStatusBanner.style.color = "#1b6b1b";
  } else {
    const mb = (p.loaded / (1024 * 1024)).toFixed(1);
    const totalMb = (p.total / (1024 * 1024)).toFixed(1);
    ffmpegStatusBanner.textContent = `FFmpeg: фоновая загрузка в IndexedDB — ${mb} / ~${totalMb} МБ (${p.pct}%)...`;
    ffmpegStatusBanner.style.color = "#003c74";
  }
}

const ffmpegEnsurePromise = DFFmpegLoader.ensureDownloaded(updateFfmpegBanner).catch((err) => {
  if (ffmpegStatusBanner) {
    ffmpegStatusBanner.textContent = "FFmpeg: ошибка загрузки (" + err.message + "). При конвертации попробуем снова.";
    ffmpegStatusBanner.style.color = "#b00";
  }
});

let selectedFile = null;
let selectedType = null;
let customCoverFile = null;
let currentResult = null;
let abortController = null;

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

function guessAudioMime(file) {
  if (file.type && file.type.startsWith("audio/")) return file.type;
  const ext = file.name.split(".").pop().toLowerCase();
  const map = {
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    opus: "audio/opus",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac",
    webm: "audio/webm"
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

    // Если заглушка без водяного знака (для внутренней обложки плеера), рисуем аккуратную иконку
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

async function transcodeVideoToQvga(file, fps, videoBitrate, customImg, onProgress) {
  const srcUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = srcUrl;
  video.playsInline = true;
  video.crossOrigin = "anonymous";

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
  const destNode = audioCtx.createMediaStreamDestination();
  sourceNode.connect(destNode);

  const canvasStream = canvas.captureStream(fps);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destNode.stream.getAudioTracks()
  ]);

  const mimeOptions = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const chosenMime = mimeOptions.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";

  const recorder = new MediaRecorder(combinedStream, {
    mimeType: chosenMime,
    videoBitsPerSecond: videoBitrate,
    audioBitsPerSecond: 32000
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  let cancelled = false;
  let rafId = null;

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
      audioCtx.close().catch(() => {});
      URL.revokeObjectURL(srcUrl);
      if (cancelled) reject(new Error("Отменено пользователем"));
      else resolve(new Blob(chunks, { type: chosenMime }));
    };
    recorder.onerror = (e) => reject(e.error || new Error("Ошибка записи"));
  });

  function renderLoop() {
    if (video.paused || video.ended || cancelled) return;
    ctx.drawImage(video, 0, 0, width, height);
    if (duration > 0) {
      onProgress(Math.min(100, Math.round((video.currentTime / duration) * 100)));
    }
    rafId = requestAnimationFrame(renderLoop);
  }

  video.onended = () => {
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, 120);
  };

  recorder.start(250);
  await video.play();
  renderLoop();

  const videoBlob = await resultPromise;
  return { mediaBlob: videoBlob, coverCanvas, cleanCoverBlob, width, height, duration };
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
    return { mediaBlob, coverCanvas, cleanCoverBlob, width, height, duration: 0 };
  }

  const audioBitrate = Number(audioMode);
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
  const destNode = audioCtx.createMediaStreamDestination();
  sourceNode.connect(destNode);

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
  if (previewImg.src.startsWith("blob:")) URL.revokeObjectURL(previewImg.src);
  if (previewVideo.src.startsWith("blob:")) URL.revokeObjectURL(previewVideo.src);
  if (previewAudio.src.startsWith("blob:")) URL.revokeObjectURL(previewAudio.src);
  if (previewVideo.poster?.startsWith("blob:")) URL.revokeObjectURL(previewVideo.poster);

  previewImg.src = URL.createObjectURL(item.blob);

  const buf = await item.blob.arrayBuffer();
  const decoded = DFCodec.extractFromBuffer(buf, item._rawPayload);

  previewVideo.style.display = "none";
  previewAudio.style.display = "none";
  previewVideo.removeAttribute("src");
  previewVideo.removeAttribute("poster");
  previewAudio.removeAttribute("src");

  if (decoded && decoded.found && !decoded.corrupted) {
    const mediaUrl = URL.createObjectURL(decoded.videoBlob);
    const isAudio = decoded.mime.startsWith("audio/");
    if (isAudio) {
      previewAudio.src = mediaUrl;
      previewAudio.style.display = "block";
    } else {
      if (decoded.coverBlob) previewVideo.poster = URL.createObjectURL(decoded.coverBlob);
      previewVideo.src = mediaUrl;
      previewVideo.style.display = "block";
    }
    const cleanCoverInfo = decoded.coverBlob ? ` | Чистая обложка: ${formatBytes(decoded.coverBlob.size)}` : "";
    statsText.textContent =
      `Файл: ${item.name} | ID: ${decoded.uid} | Тип: ${isAudio ? "Аудио" : "Видео"} (${decoded.mime}) | Размер GIF: ${item.width}×${item.height} | Медиа: ${formatBytes(item.videoSize)}${cleanCoverInfo} | Итоговый GIF: ${formatBytes(item.blob.size)}`;
  } else {
    statsText.textContent = `Файл: ${item.name} | Не удалось декодировать (${decoded?.reason || "старый формат"})`;
  }
  previewWindow.style.display = "block";
}

function updateCoverUi() {
  const frameOpt = coverMode.querySelector('option[value="frame"]');
  if (selectedType === "audio") {
    frameOpt.disabled = true;
    if (coverMode.value === "frame") coverMode.value = "placeholder";
  } else {
    frameOpt.disabled = false;
  }

  customCoverWrap.style.display = coverMode.value === "custom" ? "inline-block" : "none";
  customTextWrap.style.display = watermarkCheck.checked ? "inline-block" : "none";

  videoSettingsRow.style.display = selectedType === "audio" ? "none" : "flex";
  audioSettingsRow.style.display = selectedType === "audio" ? "flex" : "none";
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
  }
});

convertBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  if (coverMode.value === "custom" && !customCoverFile) {
    alert("Выберите свою картинку для обложки!");
    return;
  }

  convertBtn.disabled = true;
  cancelBtn.style.display = "inline-block";
  saveDbBtn.disabled = false;

  try {
    if (!(await DFFmpegLoader.isReady())) {
      statusText.textContent = "Ожидание докачки FFmpeg в IndexedDB...";
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
      statusText.textContent = "Сжатие видео: 0%...";
      result = await transcodeVideoToQvga(
        selectedFile,
        Number(fpsSelect.value),
        Number(bitrateSelect.value),
        customImg,
        (pct) => { statusText.textContent = `Сжатие видео: ${pct}%...`; }
      );
    }

    statusText.textContent = "Сборка GIF-кадров (LZW)...";
    const packed = await DFCodec.packToGif(result.coverCanvas, result.mediaBlob, result.cleanCoverBlob);
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
    statusText.textContent = "Ошибка: " + err.message;
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
  if (!items.length) {
    savedList.innerHTML = "<div style='font-size:13px; color:#666;'>Пока пусто.</div>";
    return;
  }

  savedList.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "saved-item";

    const img = document.createElement("img");
    img.src = URL.createObjectURL(item.blob);

    const info = document.createElement("div");
    info.className = "saved-info";
    const uidLabel = item.uid ? `ID: ${item.uid}` : "старый формат";
    const kindLabel = item.mediaKind === "audio" ? "Аудио" : "Видео";
    info.innerHTML = `<b>${item.name}</b><br>${kindLabel} • ${uidLabel} • ${item.width}×${item.height} • Всего: ${formatBytes(item.blob.size)} (медиа: ${formatBytes(item.videoSize)})`;

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