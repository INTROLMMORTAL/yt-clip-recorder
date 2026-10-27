const $ = (id) => document.getElementById(id);
let tab = null, isYT = false, pageTitle = "audio";

function parseTime(v) {
  v = v.trim();
  if (!v) return null;
  const p = v.split(":").map(Number);
  if (p.length > 3 || p.some((n) => Number.isNaN(n) || n < 0)) return NaN;
  return p.reduce((a, x) => a * 60 + x, 0);
}
function fmtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
function setStatus(text, cls = "") { $("status").textContent = text; $("status").className = cls; }
async function inPage(func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return r.result;
}

function render(state) {
  const st = (state && state.status) || "idle";
  $("stop").hidden = st !== "recording";
  $("go").disabled = st !== "idle" || !isYT;
  if (st === "recording") setStatus("● Идёт запись… не ставь на паузу и не закрывай вкладку.", "dim");
  else if (st === "encoding") setStatus("Обработка и сохранение…", "dim");
  else if (state && state.last && state.last.ok) setStatus("Сохранено: Загрузки/YT-Audio/" + state.last.name, "ok");
  else if (state && state.last && state.last.error) setStatus(state.last.error, "err");
  else setStatus("");
}

async function init() {
  chrome.action.setBadgeText({ text: "" });
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  isYT = !!(tab && tab.url && /^https:\/\/(www\.|m\.|music\.)?youtube\.com\/(watch|shorts)/.test(tab.url));
  if (isYT) {
    const info = await inPage(() => ({ title: document.title.replace(/^\(\d+\)\s*/, "").replace(/ - YouTube( Music)?$/, "") }));
    pageTitle = info.title || "audio";
    $("title").textContent = pageTitle;
  } else {
    $("title").textContent = "Открой страницу видео на YouTube";
  }
  const { state } = await chrome.storage.session.get("state");
  render(state);
}

chrome.storage.onChanged.addListener((c, area) => { if (area === "session" && c.state) render(c.state.newValue); });

const curTime = () => inPage(() => (document.querySelector("video") || {}).currentTime || 0);
$("setStart").onclick = async () => { $("start").value = fmtTime(await curTime()); };
$("setEnd").onclick = async () => { $("end").value = fmtTime(await curTime()); };

$("preview").onclick = async () => {
  const s = parseTime($("start").value) || 0, e = parseTime($("end").value);
  if (Number.isNaN(s) || Number.isNaN(e)) return setStatus("Неверный формат времени", "err");
  await inPage((start, end) => {
    const v = document.querySelector("video");
    if (!v) return;
    window.__ytcr_cleanup && window.__ytcr_cleanup();
    v.currentTime = start; v.play();
    if (end == null) return;
    const check = () => { if (v.currentTime >= end) { v.pause(); v.removeEventListener("timeupdate", check); } };
    v.addEventListener("timeupdate", check);
  }, [s, e]);
};

$("go").onclick = async () => {
  const start = parseTime($("start").value), end = parseTime($("end").value);
  if (Number.isNaN(start) || Number.isNaN(end)) return setStatus("Неверный формат времени (пример: 1:23.5)", "err");
  if (start != null && end != null && end <= start) return setStatus("Конец должен быть позже начала", "err");
  setStatus("Готовлюсь к записи…", "dim");
  const res = await chrome.runtime.sendMessage({
    type: "start", tabId: tab.id, title: pageTitle, start, end, fade: $("fade").checked,
  });
  if (res && !res.ok) setStatus(res.error || "Ошибка", "err");
};

$("stop").onclick = () => chrome.runtime.sendMessage({ type: "force-stop" });

init();
