(function (root) {
  const MAGIC_V1 = [0x44, 0x46, 0x47, 0x49, 0x46, 0x31]; // DFGIF1
  const MAGIC_V2 = [0x44, 0x46, 0x47, 0x49, 0x46, 0x32]; // DFGIF2 (+ чистая обложка)

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function calcCrc32Parts(arrays) {
    let crc = 0xffffffff;
    for (const bytes of arrays) {
      for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function generateUid() {
    const arr = new Uint8Array(4);
    crypto.getRandomValues(arr);
    return arr;
  }

  function uidToHex(arr) {
    return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  // Формат DFGIF2:
  // [MAGIC 6B][UID 4B][videoLen 4B][crc32 4B][mimeLen 1B][coverLen 4B][coverMimeLen 1B][mime][coverMime][video][cover]
  async function packToGif(coverCanvas, videoBlob, cleanCoverBlob) {
    const ctx = coverCanvas.getContext("2d");
    const coverRgba = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;

    const videoBytes = new Uint8Array(await videoBlob.arrayBuffer());
    const mimeStr = videoBlob.type || "video/webm";
    const mimeBytes = new TextEncoder().encode(mimeStr).slice(0, 255);

    const coverBytes = cleanCoverBlob ? new Uint8Array(await cleanCoverBlob.arrayBuffer()) : new Uint8Array(0);
    const coverMimeStr = cleanCoverBlob ? (cleanCoverBlob.type || "image/webp") : "";
    const coverMimeBytes = new TextEncoder().encode(coverMimeStr).slice(0, 255);

    const uidBytes = generateUid();
    const crc = calcCrc32Parts([videoBytes, coverBytes]);

    const headerLen = 24 + mimeBytes.length + coverMimeBytes.length;
    const payload = new Uint8Array(headerLen + videoBytes.length + coverBytes.length);
    let offset = 0;

    payload.set(MAGIC_V2, offset); offset += 6;
    payload.set(uidBytes, offset); offset += 4;

    const view = new DataView(payload.buffer);
    view.setUint32(offset, videoBytes.length, false); offset += 4;
    view.setUint32(offset, crc, false); offset += 4;

    payload[offset] = mimeBytes.length; offset += 1;
    view.setUint32(offset, coverBytes.length, false); offset += 4;
    payload[offset] = coverMimeBytes.length; offset += 1;

    payload.set(mimeBytes, offset); offset += mimeBytes.length;
    payload.set(coverMimeBytes, offset); offset += coverMimeBytes.length;
    payload.set(videoBytes, offset); offset += videoBytes.length;
    payload.set(coverBytes, offset);

    const uid = uidToHex(uidBytes);
    console.log(`[Codec-Pack] DFGIF2 ID=${uid}, медиа=${videoBytes.length} Б, чистая обложка=${coverBytes.length} Б, всего payload=${payload.length} Б`);

    const encoded = DFGif.encodeGif(coverRgba, coverCanvas.width, coverCanvas.height, payload);
    return {
      blob: encoded.blob,
      uid,
      dataFrameCount: encoded.dataFrameCount,
      bytesPerFrame: encoded.bytesPerFrame,
      rawPayload: payload
    };
  }

  function extractFromBuffer(arrayBuffer, expectedPayloadForDebug) {
    const payload = DFGif.decodeFramesToPayloads(arrayBuffer, MAGIC_V1);
    if (!payload || payload.length < 19) {
      return { found: false, fileSize: arrayBuffer.byteLength };
    }

    const version = payload[5]; // 0x31 ('1') или 0x32 ('2')
    const uid = uidToHex(payload.slice(6, 10));
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

    if (version === 0x31) {
      const videoLen = view.getUint32(10, false);
      const expectedCrc = view.getUint32(14, false);
      const mimeLen = payload[18];

      if (videoLen === 0 || 19 + mimeLen + videoLen > payload.length) {
        return { found: false, fileSize: arrayBuffer.byteLength, reason: "битая длина в заголовке GIF" };
      }

      const mime = new TextDecoder().decode(payload.slice(19, 19 + mimeLen)) || "video/webm";
      const videoBytes = payload.slice(19 + mimeLen, 19 + mimeLen + videoLen);
      const actualCrc = calcCrc32Parts([videoBytes]);

      if (actualCrc !== expectedCrc) {
        return { found: true, corrupted: true, uid, reason: "не совпала контрольная сумма CRC32" };
      }

      return {
        found: true,
        corrupted: false,
        uid,
        mime,
        videoBytes,
        videoBlob: new Blob([videoBytes], { type: mime }),
        coverBytes: null,
        coverMime: null,
        coverBlob: null
      };
    }

    if (version === 0x32 && payload.length >= 24) {
      const videoLen = view.getUint32(10, false);
      const expectedCrc = view.getUint32(14, false);
      const mimeLen = payload[18];
      const coverLen = view.getUint32(19, false);
      const coverMimeLen = payload[23];

      const headerLen = 24 + mimeLen + coverMimeLen;
      if (videoLen === 0 || headerLen + videoLen + coverLen > payload.length) {
        return { found: false, fileSize: arrayBuffer.byteLength, reason: "битая длина в заголовке DFGIF2" };
      }

      let off = 24;
      const mime = new TextDecoder().decode(payload.slice(off, off + mimeLen)) || "video/webm";
      off += mimeLen;
      const coverMime = coverMimeLen ? new TextDecoder().decode(payload.slice(off, off + coverMimeLen)) : "image/webp";
      off += coverMimeLen;

      const videoBytes = payload.slice(off, off + videoLen);
      off += videoLen;
      const coverBytes = coverLen > 0 ? payload.slice(off, off + coverLen) : new Uint8Array(0);

      const actualCrc = calcCrc32Parts([videoBytes, coverBytes]);
      if (actualCrc !== expectedCrc) {
        if (expectedPayloadForDebug) {
          for (let i = 0; i < expectedPayloadForDebug.length; i++) {
            if (payload[i] !== expectedPayloadForDebug[i]) {
              console.log(`[Codec-Diff] Первое расхождение на байте #${i}`);
              break;
            }
          }
        }
        return { found: true, corrupted: true, uid, reason: "не совпала контрольная сумма CRC32" };
      }

      return {
        found: true,
        corrupted: false,
        uid,
        mime,
        videoBytes,
        videoBlob: new Blob([videoBytes], { type: mime }),
        coverBytes: coverBytes.length ? coverBytes : null,
        coverMime: coverBytes.length ? coverMime : null,
        coverBlob: coverBytes.length ? new Blob([coverBytes], { type: coverMime }) : null
      };
    }

    return { found: false, fileSize: arrayBuffer.byteLength };
  }

  root.DFCodec = { packToGif, extractFromBuffer };
})(typeof self !== "undefined" ? self : window);