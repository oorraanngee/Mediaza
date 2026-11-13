(function (root) {
  // 256-цветная палитра для красивой обложки: 6x6x6 RGB куб (0..215) + 40 оттенков серого (216..255)
  const COVER_PALETTE = (() => {
    const pal = new Uint8Array(256 * 3);
    let idx = 0;
    for (let r = 0; r < 6; r++) {
      for (let g = 0; g < 6; g++) {
        for (let b = 0; b < 6; b++) {
          pal[idx++] = r * 51;
          pal[idx++] = g * 51;
          pal[idx++] = b * 51;
        }
      }
    }
    for (let i = 0; i < 40; i++) {
      const v = Math.round((i / 39) * 255);
      pal[idx++] = v;
      pal[idx++] = v;
      pal[idx++] = v;
    }
    return pal;
  })();

  // Кэш 32x32x32 для быстрого подбора ближайшего цвета из 256 цветов обложки
  const COVER_LUT = new Int16Array(32768).fill(-1);

  function quantizeCoverRgba(rgba, pixelCount) {
    const out = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const p = i * 4;
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const lutKey = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let best = COVER_LUT[lutKey];
      if (best === -1) {
        let bestDist = 0x7fffffff;
        best = 0;
        for (let c = 0; c < 256; c++) {
          const cOff = c * 3;
          const dr = r - COVER_PALETTE[cOff];
          const dg = g - COVER_PALETTE[cOff + 1];
          const db = b - COVER_PALETTE[cOff + 2];
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestDist) {
            bestDist = dist;
            best = c;
          }
        }
        COVER_LUT[lutKey] = best;
      }
      out[i] = best;
    }
    return out;
  }

  // 64-цветная устойчивая палитра для кадров с данными (уровни 0, 85, 170, 255 -> 6 бит на пиксель)
  const DATA_PALETTE = (() => {
    const pal = new Uint8Array(64 * 3);
    let idx = 0;
    for (let r = 0; r < 4; r++) {
      for (let g = 0; g < 4; g++) {
        for (let b = 0; b < 4; b++) {
          pal[idx++] = r * 85;
          pal[idx++] = g * 85;
          pal[idx++] = b * 85;
        }
      }
    }
    return pal;
  })();

  function lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = clearCode + 2;
    const dict = new Map();

    const out = [];
    let bitBuf = 0;
    let bitCount = 0;

    function writeCode(code, size) {
      bitBuf |= code << bitCount;
      bitCount += size;
      while (bitCount >= 8) {
        out.push(bitBuf & 0xff);
        bitBuf >>>= 8;
        bitCount -= 8;
      }
    }

    writeCode(clearCode, codeSize);
    let prefix = indices[0];

    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const hit = dict.get(key);
      if (hit !== undefined) {
        prefix = hit;
      } else {
        writeCode(prefix, codeSize);
        if (nextCode < 4096) {
          dict.set(key, nextCode++);
          if (nextCode > (1 << codeSize) && codeSize < 12) {
            codeSize++;
          } else if (nextCode === 4096) {
            writeCode(clearCode, codeSize);
            dict.clear();
            nextCode = clearCode + 2;
            codeSize = minCodeSize + 1;
          }
        }
        prefix = k;
      }
    }

    writeCode(prefix, codeSize);
    writeCode(eoiCode, codeSize);
    if (bitCount > 0) out.push(bitBuf & 0xff);
    return new Uint8Array(out);
  }

  function lzwDecode(lzwBytes, minCodeSize, expectedPixels, frameLabel) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = clearCode + 2;

    const prefixArr = new Int16Array(4096);
    const suffixArr = new Uint8Array(4096);
    const stack = new Uint8Array(4096);

    function resetDict() {
      for (let i = 0; i < clearCode; i++) {
        prefixArr[i] = -1;
        suffixArr[i] = i;
      }
      nextCode = clearCode + 2;
      codeSize = minCodeSize + 1;
    }

    resetDict();

    let bytePos = 0;
    let bitBuf = 0;
    let bitCount = 0;

    function readCode() {
      while (bitCount < codeSize) {
        if (bytePos >= lzwBytes.length) return -1;
        bitBuf |= lzwBytes[bytePos++] << bitCount;
        bitCount += 8;
      }
      const code = bitBuf & ((1 << codeSize) - 1);
      bitBuf >>>= codeSize;
      bitCount -= codeSize;
      return code;
    }

    const out = new Uint8Array(expectedPixels);
    let outPos = 0;
    let oldCode = -1;
    let oldFirstByte = 0;

    while (outPos < expectedPixels) {
      const code = readCode();
      if (code === -1) {
        console.log(`[GIF-LZW] ${frameLabel}: неожиданный конец потока на пикселе ${outPos}/${expectedPixels}`);
        break;
      }
      if (code === eoiCode) break;

      if (code === clearCode) {
        resetDict();
        oldCode = -1;
        continue;
      }

      let sp = 0;
      if (code < nextCode) {
        let c = code;
        while (c !== -1 && sp < 4096) {
          stack[sp++] = suffixArr[c];
          c = prefixArr[c];
        }
      } else if (code === nextCode && oldCode !== -1) {
        stack[sp++] = oldFirstByte;
        let c = oldCode;
        while (c !== -1 && sp < 4096) {
          stack[sp++] = suffixArr[c];
          c = prefixArr[c];
        }
      } else {
        console.log(`[GIF-LZW] ${frameLabel}: рассинхрон LZW (code=${code}, nextCode=${nextCode}, codeSize=${codeSize}) на пикселе ${outPos}/${expectedPixels}`);
        break;
      }

      const firstByte = stack[sp - 1];
      while (sp > 0 && outPos < expectedPixels) {
        out[outPos++] = stack[--sp];
      }

      if (oldCode !== -1 && nextCode < 4096) {
        prefixArr[nextCode] = oldCode;
        suffixArr[nextCode] = firstByte;
        nextCode++;
        if (nextCode === (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      }

      oldCode = code;
      oldFirstByte = firstByte;
    }

    if (outPos !== expectedPixels) {
      console.log(`[GIF-LZW] ${frameLabel}: декодировано ${outPos} из ${expectedPixels} пикселей`);
    }

    return out;
  }

  function pushSubBlocks(buf, data) {
    let pos = 0;
    while (pos < data.length) {
      const chunk = Math.min(255, data.length - pos);
      buf.push(chunk);
      for (let i = 0; i < chunk; i++) buf.push(data[pos++]);
    }
    buf.push(0);
  }

  function writeU16LE(buf, val) {
    buf.push(val & 0xff, (val >> 8) & 0xff);
  }

  function encodeGif(coverRgba, width, height, payloadBytes) {
    const out = [];
    out.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
    writeU16LE(out, width);
    writeU16LE(out, height);
    out.push(0x70, 0x00, 0x00);

    // --- КАДР 1: Чистая обложка ---
    out.push(0x21, 0xf9, 0x04, 0x04);
    writeU16LE(out, 65535);
    out.push(0x00, 0x00);

    out.push(0x2c);
    writeU16LE(out, 0); writeU16LE(out, 0);
    writeU16LE(out, width); writeU16LE(out, height);
    out.push(0x87);
    for (let i = 0; i < COVER_PALETTE.length; i++) out.push(COVER_PALETTE[i]);

    const coverIndices = quantizeCoverRgba(coverRgba, width * height);
    out.push(8);
    pushSubBlocks(out, lzwEncode(coverIndices, 8));

    // --- 5 лёгких keep-alive кадров 1x1 ---
    const dummyLzw = lzwEncode(new Uint8Array([0]), 2);
    for (let k = 0; k < 5; k++) {
      out.push(0x21, 0xf9, 0x04, 0x05);
      writeU16LE(out, 65535);
      out.push(0x00, 0x00);

      out.push(0x2c);
      writeU16LE(out, 0); writeU16LE(out, 0);
      writeU16LE(out, 1); writeU16LE(out, 1);
      out.push(0x81);
      for (let i = 0; i < 12; i++) out.push(0);
      out.push(2);
      pushSubBlocks(out, dummyLzw);
    }

    // --- КАДРЫ ДАННЫХ ---
    const usablePixels = Math.floor((width * height) / 4) * 4;
    const bytesPerFrame = (usablePixels / 4) * 3;
    const dataFrameCount = Math.ceil(payloadBytes.length / bytesPerFrame);

    for (let f = 0; f < dataFrameCount; f++) {
      out.push(0x21, 0xf9, 0x04, 0x04);
      writeU16LE(out, 100);
      out.push(0x00, 0x00);

      out.push(0x2c);
      writeU16LE(out, 0); writeU16LE(out, 0);
      writeU16LE(out, width); writeU16LE(out, height);
      out.push(0x85);
      for (let i = 0; i < DATA_PALETTE.length; i++) out.push(DATA_PALETTE[i]);

      const frameIndices = new Uint8Array(width * height);
      const startByte = f * bytesPerFrame;

      for (let p = 0, b = startByte; p < usablePixels; p += 4, b += 3) {
        const b0 = b < payloadBytes.length ? payloadBytes[b] : 0;
        const b1 = b + 1 < payloadBytes.length ? payloadBytes[b + 1] : 0;
        const b2 = b + 2 < payloadBytes.length ? payloadBytes[b + 2] : 0;

        frameIndices[p]     = (b0 >> 2) & 0x3f;
        frameIndices[p + 1] = ((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0f);
        frameIndices[p + 2] = ((b1 & 0x0f) << 2) | ((b2 >> 6) & 0x03);
        frameIndices[p + 3] = b2 & 0x3f;
      }

      out.push(6);
      pushSubBlocks(out, lzwEncode(frameIndices, 6));
    }

    out.push(0x3b);
    return {
      blob: new Blob([new Uint8Array(out)], { type: "image/gif" }),
      dataFrameCount,
      bytesPerFrame
    };
  }

  function decodeFramesToPayloads(arrayBuffer, magicBytes) {
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 13) return null;
    const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (sig !== "GIF") return null;

    let pos = 6;
    const width = bytes[pos] | (bytes[pos + 1] << 8);
    const height = bytes[pos + 2] | (bytes[pos + 3] << 8);
    const packed = bytes[pos + 4];
    pos += 7;

    let gct = null;
    if (packed & 0x80) {
      const gctSize = 3 * (1 << ((packed & 7) + 1));
      gct = bytes.subarray(pos, pos + gctSize);
      pos += gctSize;
    }

    const totalPixels = width * height;
    const usablePixels = Math.floor(totalPixels / 4) * 4;
    const bytesPerFrame = (usablePixels / 4) * 3;

    const screenR = new Uint8Array(totalPixels);
    const screenG = new Uint8Array(totalPixels);
    const screenB = new Uint8Array(totalPixels);

    let disposal = 0;
    let transparentIdx = -1;
    let foundMagicFrame = false;
    let frameIndex = 0;
    const extractedChunks = [];

    function skipSubBlocks() {
      while (pos < bytes.length) {
        const len = bytes[pos++];
        if (len === 0) break;
        pos += len;
      }
    }

    function readSubBlocks() {
      const parts = [];
      let total = 0;
      while (pos < bytes.length) {
        const len = bytes[pos++];
        if (len === 0) break;
        const slice = bytes.subarray(pos, pos + len);
        parts.push(slice);
        total += slice.length;
        pos += len;
      }
      const res = new Uint8Array(total);
      let off = 0;
      for (const s of parts) {
        res.set(s, off);
        off += s.length;
      }
      return res;
    }

    while (pos < bytes.length) {
      const blockId = bytes[pos++];
      if (blockId === 0x3b) break;

      if (blockId === 0x21) {
        const label = bytes[pos++];
        if (label === 0xf9 && bytes[pos] === 4) {
          const gcePacked = bytes[pos + 1];
          disposal = (gcePacked >> 2) & 7;
          transparentIdx = (gcePacked & 1) ? bytes[pos + 4] : -1;
        }
        skipSubBlocks();
        continue;
      }

      if (blockId === 0x2c) {
        frameIndex++;
        const left = bytes[pos] | (bytes[pos + 1] << 8);
        const top = bytes[pos + 2] | (bytes[pos + 3] << 8);
        const fw = bytes[pos + 4] | (bytes[pos + 5] << 8);
        const fh = bytes[pos + 6] | (bytes[pos + 7] << 8);
        const fPacked = bytes[pos + 8];
        pos += 9;

        let ct = gct;
        if (fPacked & 0x80) {
          const lctSize = 3 * (1 << ((fPacked & 7) + 1));
          ct = bytes.subarray(pos, pos + lctSize);
          pos += lctSize;
        }

        const minCodeSize = bytes[pos++];
        const lzwData = readSubBlocks();
        if (!ct) continue;

        const indices = lzwDecode(lzwData, minCodeSize, fw * fh, `Кадр #${frameIndex} (${fw}x${fh})`);
        const interlaced = Boolean(fPacked & 0x40);

        const passes = interlaced ? [[0, 8], [4, 8], [2, 4], [1, 2]] : [[0, 1]];
        let idxPos = 0;
        for (const [startY, stepY] of passes) {
          for (let y = startY; y < fh; y += stepY) {
            const sy = top + y;
            for (let x = 0; x < fw; x++) {
              const colorIdx = indices[idxPos++];
              if (colorIdx === transparentIdx) continue;
              const sx = left + x;
              if (sx < width && sy < height) {
                const sOff = sy * width + sx;
                const cOff = colorIdx * 3;
                screenR[sOff] = ct[cOff];
                screenG[sOff] = ct[cOff + 1];
                screenB[sOff] = ct[cOff + 2];
              }
            }
          }
        }

        if (fw >= 8 && fh >= 8) {
          if (!foundMagicFrame) {
            const headBytes = new Uint8Array(6);
            for (let p = 0, b = 0; p < 8; p += 4, b += 3) {
              const p0 = (Math.round(screenR[p] / 85) << 4) | (Math.round(screenG[p] / 85) << 2) | Math.round(screenB[p] / 85);
              const p1 = (Math.round(screenR[p + 1] / 85) << 4) | (Math.round(screenG[p + 1] / 85) << 2) | Math.round(screenB[p + 1] / 85);
              const p2 = (Math.round(screenR[p + 2] / 85) << 4) | (Math.round(screenG[p + 2] / 85) << 2) | Math.round(screenB[p + 2] / 85);
              const p3 = (Math.round(screenR[p + 3] / 85) << 4) | (Math.round(screenG[p + 3] / 85) << 2) | Math.round(screenB[p + 3] / 85);
              headBytes[b]     = (p0 << 2) | (p1 >> 4);
              headBytes[b + 1] = ((p1 & 0x0f) << 4) | (p2 >> 2);
              headBytes[b + 2] = ((p2 & 0x03) << 6) | p3;
            }

            let match = true;
            for (let i = 0; i < 5; i++) {
              if (headBytes[i] !== magicBytes[i]) { match = false; break; }
            }
            if (headBytes[5] !== 0x31 && headBytes[5] !== 0x32) match = false;
            if (match) {
              foundMagicFrame = true;
              console.log(`[GIF-Decode] Найдена сигнатура DFGIF1 в кадре #${frameIndex}`);
            }
          }

          if (foundMagicFrame) {
            const frameBytes = new Uint8Array(bytesPerFrame);
            for (let p = 0, b = 0; p < usablePixels; p += 4, b += 3) {
              const p0 = (Math.round(screenR[p] / 85) << 4) | (Math.round(screenG[p] / 85) << 2) | Math.round(screenB[p] / 85);
              const p1 = (Math.round(screenR[p + 1] / 85) << 4) | (Math.round(screenG[p + 1] / 85) << 2) | Math.round(screenB[p + 1] / 85);
              const p2 = (Math.round(screenR[p + 2] / 85) << 4) | (Math.round(screenG[p + 2] / 85) << 2) | Math.round(screenB[p + 2] / 85);
              const p3 = (Math.round(screenR[p + 3] / 85) << 4) | (Math.round(screenG[p + 3] / 85) << 2) | Math.round(screenB[p + 3] / 85);
              frameBytes[b]     = (p0 << 2) | (p1 >> 4);
              frameBytes[b + 1] = ((p1 & 0x0f) << 4) | (p2 >> 2);
              frameBytes[b + 2] = ((p2 & 0x03) << 6) | p3;
            }
            extractedChunks.push(frameBytes);
          }
        }

        if (disposal === 2) {
          for (let y = 0; y < fh; y++) {
            const sy = top + y;
            if (sy >= height) continue;
            for (let x = 0; x < fw; x++) {
              const sx = left + x;
              if (sx < width) {
                const sOff = sy * width + sx;
                screenR[sOff] = 0; screenG[sOff] = 0; screenB[sOff] = 0;
              }
            }
          }
        }
        disposal = 0;
        transparentIdx = -1;
      }
    }

    console.log(`[GIF-Decode] Всего кадров в GIF: ${frameIndex}, извлечено кадров данных: ${extractedChunks.length}, байт/кадр: ${bytesPerFrame}`);
    if (!extractedChunks.length) return null;
    const joined = new Uint8Array(extractedChunks.length * bytesPerFrame);
    for (let i = 0; i < extractedChunks.length; i++) {
      joined.set(extractedChunks[i], i * bytesPerFrame);
    }
    return joined;
  }

  root.DFGif = { encodeGif, decodeFramesToPayloads };
})(typeof self !== "undefined" ? self : window);