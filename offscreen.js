const SR = 48000;      // частота потока YouTube (Opus) — без ресемплинга
const BLOCK = 512;
let ctx = null, stream = null, chunks = [], capturing = false, finished = false, opts = null;

const send = (m) => chrome.runtime.sendMessage(m).catch(() => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target === "offscreen" && msg.type === "begin") {
    begin(msg)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => { cleanup(); sendResponse({ ok: false, error: String(e.message || e) }); });
    return true;
  }
  if (msg.target) return;
  if (msg.type === "mark-start" && ctx && !finished) capturing = true;
  if (msg.type === "mark-end" && ctx && !finished) {
    finish().catch((e) => { cleanup(); send({ type: "error", message: String(e.message || e) }); });
  }
});

async function begin({ streamId, options }) {
  if (ctx) throw new Error("Запись уже идёт");
  opts = options; chunks = []; capturing = false; finished = false;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: false,
  });
  ctx = new AudioContext({ sampleRate: SR });
  await ctx.audioWorklet.addModule("recorder-worklet.js");

  const src = ctx.createMediaStreamSource(stream);
  const rec = new AudioWorkletNode(ctx, "recorder", { numberOfOutputs: 1, outputChannelCount: [2] });
  rec.port.onmessage = (e) => { if (capturing) chunks.push(e.data); };
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(rec); rec.connect(mute); mute.connect(ctx.destination);
  src.connect(ctx.destination);            // чтобы звук вкладки продолжал быть слышен
  if (ctx.state === "suspended") await ctx.resume();
}

function cleanup() {
  capturing = false;
  try { stream && stream.getTracks().forEach((t) => t.stop()); } catch {}
  try { ctx && ctx.close(); } catch {}
  stream = null; ctx = null;
}

async function finish() {
  finished = true;
  send({ type: "status", status: "encoding" });
  await sleep(120);                         // хвост: аудио приходит чуть позже видео
  capturing = false;
  const n = chunks.length * BLOCK;
  cleanup();
  if (!n) throw new Error("Ничего не записано. Проверь, что видео играло (и это не реклама).");

  let L = new Float32Array(n), R = new Float32Array(n);
  chunks.forEach((c, i) => { L.set(c[0], i * BLOCK); R.set(c[1], i * BLOCK); });
  chunks = [];

  const start = ytcrFindStart(L, R);        // отрезаем цифровую тишину до начала звука
  if (start < 0) throw new Error("Записана тишина. Проверь, что звук на вкладке не отключён.");
  let end = n;
  if (opts.duration) end = Math.min(n, start + Math.round(opts.duration * SR)); // точная длина фрагмента
  L = L.subarray(start, end); R = R.subarray(start, end);
  if (opts.fadeMs) ytcrFade(L, R, Math.round((opts.fadeMs / 1000) * SR));

  const wav = ytcrEncodeWav24(L, R, SR);
  const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  send({ type: "done", url });
}
