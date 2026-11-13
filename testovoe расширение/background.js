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