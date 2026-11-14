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
  const blobUrl = URL.createObjectURL(blob);
  chrome.downloads.download({
    url: blobUrl,
    filename: filename,
    saveAs: false
  }, () => {
    if (btn) {
      const old = btn.textContent;
      btn.textContent = "Сохранено!";
      setTimeout(() => (btn.textContent = old), 1200);
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  });
}

async function render() {
  const items = await DFDatabase.getAllImages();
  listEl.textContent = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.style.fontSize = "12px";
    empty.style.color = "#666";
    empty.style.textAlign = "center";
    empty.style.padding = "10px";
    empty.append(
      document.createTextNode("Нет сохранённых картинок."),
      document.createElement("br"),
      document.createTextNode("Откройте студию, чтобы создать.")
    );
    listEl.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "item";

    const img = document.createElement("img");
    img.src = URL.createObjectURL(item.blob);

    const meta = document.createElement("div");
    meta.className = "meta";
    const titleEl = document.createElement("b");
    titleEl.title = item.name;
    titleEl.textContent = item.name;
    const uidLine = item.uid ? `ID: ${item.uid} • ` : "";
    meta.append(
      titleEl,
      document.createTextNode(`${uidLine}${item.width}×${item.height}`),
      document.createElement("br"),
      document.createTextNode(formatBytes(item.blob.size))
    );

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