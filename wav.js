// Чистые функции обработки звука (используются в offscreen.js и тестах)
function ytcrFindStart(L, R, th = 1e-5) {
  for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > th || Math.abs(R[i]) > th) return i;
  return -1;
}

function ytcrFade(L, R, n) {
  n = Math.min(n, L.length >> 1);
  for (let i = 0; i < n; i++) {
    const g = i / n, j = L.length - 1 - i;
    L[i] *= g; R[i] *= g; L[j] *= g; R[j] *= g;
  }
}

function ytcrEncodeWav24(L, R, sr) {
  const n = L.length, dataLen = n * 6;
  const buf = new ArrayBuffer(44 + dataLen), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); dv.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
  str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 6, true); dv.setUint16(32, 6, true); dv.setUint16(34, 24, true);
  str(36, "data"); dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      let s = c ? R[i] : L[i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
      dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255);
      o += 3;
    }
  }
  return buf;
}

if (typeof module !== "undefined") module.exports = { ytcrFindStart, ytcrFade, ytcrEncodeWav24 };
