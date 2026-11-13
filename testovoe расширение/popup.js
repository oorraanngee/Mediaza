const openStudioBtn = document.getElementById("openStudioBtn");
const enabledToggle = document.getElementById("enabledToggle");
const listEl = document.getElementById("list");

openStudioBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("studio.html") });
});

chrome.storage.local.get({ enabled: true }, (data) => {
  enabledToggle.checked = data.enabled;
});

enabledToggle.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledToggle.checked });
});

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " Б";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КБ";
  return (bytes / (1024 * 1024)).toFixed(2) + " МБ";
}

function saveBlobViaDownloads(blob, filename, btn) {
  const reader = new FileReader();
  reader.onload = () => {
    chrome.downloads.download({
      url: reader.result,
      filename: filename,
      saveAs: false
    }, () => {
      if (btn) {
        const old = btn.textContent;
        btn.textContent = "Сохранено!";
        setTimeout(() => (btn.textContent = old), 1200);
      }
    });
  };
  reader.readAsDataURL(blob);
}

async function render() {
  const items = await DFDatabase.getAllImages();
  if (!items.length) {
    listEl.innerHTML = "<div style='font-size:12px; color:#666; text-align:center; padding:10px;'>Нет сохранённых картинок.<br>Откройте студию, чтобы создать.</div>";
    return;
  }

  listEl.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "item";

    const img = document.createElement("img");
    img.src = URL.createObjectURL(item.blob);

    const meta = document.createElement("div");
    meta.className = "meta";
    const uidLine = item.uid ? `ID: ${item.uid} • ` : "";
    meta.innerHTML = `<b title="${item.name}">${item.name}</b>${uidLine}${item.width}×${item.height}<br>${formatBytes(item.blob.size)}`;

    const btns = document.createElement("div");
    btns.className = "btns";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Сохранить";
    saveBtn.onclick = () => saveBlobViaDownloads(item.blob, item.name, saveBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "danger";
    delBtn.textContent = "Удалить";
    delBtn.onclick = async () => {
      await DFDatabase.deleteImage(item.id);
      await render();
    };

    btns.append(saveBtn, delBtn);
    row.append(img, meta, btns);
    listEl.appendChild(row);
  }
}

render();