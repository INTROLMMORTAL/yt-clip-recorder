async function getState() {
  const { state } = await chrome.storage.session.get("state");
  return state || { status: "idle" };
}
async function setState(patch) {
  const cur = await getState();
  await chrome.storage.session.set({ state: { ...cur, ...patch } });
}
function badge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function ensureOffscreen() {
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (ctxs.length) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Запись звука вкладки YouTube",
  });
}
async function closeOffscreen() { try { await chrome.offscreen.closeDocument(); } catch {} }

async function fail(err) {
  await setState({ status: "idle", last: { ok: false, error: String(err.message || err) } });
  badge("ERR", "#d33");
  closeOffscreen();
}

// ---- функции, выполняемые внутри страницы YouTube ----
function pagePrepare(start) {
  const v = document.querySelector("video.html5-main-video") || document.querySelector("video");
  if (!v) return { error: "Видео на странице не найдено" };
  if (document.querySelector(".ad-showing")) return { error: "Сейчас идёт реклама — дождись конца и повтори" };
  window.__ytcr_cleanup && window.__ytcr_cleanup();
  v.pause();
  v.playbackRate = 1;
  return new Promise((resolve) => {
    const done = () => { v.removeEventListener("seeked", done); resolve({ duration: v.duration }); };
    v.addEventListener("seeked", done);
    v.currentTime = start || 0;
    setTimeout(done, 5000);
  });
}

function pagePlay(end) {
  const v = document.querySelector("video.html5-main-video") || document.querySelector("video");
  window.__ytcr_cleanup && window.__ytcr_cleanup();
  let done = false, iv = null;
  const onPlaying = () => { v.removeEventListener("playing", onPlaying); chrome.runtime.sendMessage({ type: "mark-start" }); };
  const cleanup = () => {
    clearInterval(iv);
    v.removeEventListener("ended", finish);
    v.removeEventListener("timeupdate", check);
    v.removeEventListener("playing", onPlaying);
    window.__ytcr_cleanup = null;
  };
  const finish = () => {
    if (done) return;
    done = true; cleanup(); v.pause();
    chrome.runtime.sendMessage({ type: "mark-end" });
  };
  const check = () => { if (end != null && v.currentTime >= end) finish(); };
  v.addEventListener("playing", onPlaying);
  v.addEventListener("ended", finish);
  v.addEventListener("timeupdate", check);
  iv = setInterval(check, 10);
  window.__ytcr_cleanup = cleanup;
  v.play();
}

function pagePause() {
  window.__ytcr_cleanup && window.__ytcr_cleanup();
  const v = document.querySelector("video.html5-main-video") || document.querySelector("video");
  v && v.pause();
}

// ---- основной сценарий ----
async function startRecording({ tabId, title, start, end, fade }) {
  const cur = await getState();
  if (cur.status === "recording" || cur.status === "encoding") throw new Error("Запись уже идёт");

  const [prep] = await chrome.scripting.executeScript({ target: { tabId }, func: pagePrepare, args: [start] });
  if (prep.result && prep.result.error) throw new Error(prep.result.error);

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const duration = end != null ? end - (start || 0) : null;
  const res = await chrome.runtime.sendMessage({
    target: "offscreen", type: "begin", streamId,
    options: { duration, fadeMs: fade ? 15 : 0 },
  });
  if (!res || !res.ok) throw new Error((res && res.error) || "Не удалось начать захват звука");

  await setState({ status: "recording", last: null, title, start, end, tabId });
  badge("REC", "#d33");
  await chrome.scripting.executeScript({ target: { tabId }, func: pagePlay, args: [end] });
}

async function forceStop() {
  const s = await getState();
  if (s.tabId) { try { await chrome.scripting.executeScript({ target: { tabId: s.tabId }, func: pagePause }); } catch {} }
  chrome.runtime.sendMessage({ type: "mark-end" }).catch(() => {});
}

const sanitize = (s) =>
  s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "").slice(0, 100) || "audio";
const fileTs = (t) => `${Math.floor(t / 60)}m${String(Math.floor(t % 60)).padStart(2, "0")}s`;

async function onDone({ url }) {
  const s = await getState();
  const seg = s.start != null || s.end != null
    ? ` [${fileTs(s.start || 0)}-${s.end != null ? fileTs(s.end) : "end"}]` : "";
  const name = `${sanitize(s.title || "audio")}${seg}.wav`;
  chrome.downloads.download({ url, filename: `YT-Audio/${name}`, conflictAction: "uniquify" }, (id) => {
    if (chrome.runtime.lastError || id == null) {
      fail(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || "Не удалось сохранить файл"));
    }
  });
  await setState({ status: "idle", last: { ok: true, name } });
  badge("OK", "#2a9d4b");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target) return;
  switch (msg.type) {
    case "start":
      startRecording(msg)
        .then(() => sendResponse({ ok: true }))
        .catch(async (e) => { await fail(e); sendResponse({ ok: false, error: String(e.message || e) }); });
      return true;
    case "force-stop": forceStop(); break;
    case "status": setState({ status: msg.status }); if (msg.status === "encoding") badge("...", "#e69500"); break;
    case "done": onDone(msg); break;
    case "error": fail(new Error(msg.message)); break;
  }
});

chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state && (delta.state.current === "complete" || delta.state.current === "interrupted")) {
    const s = await getState();
    if (s.status === "idle") closeOffscreen();
  }
});
