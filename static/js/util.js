// ---------- dates (always local time; toISOString() would shift days in UTC+ zones) ----------
export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parseISO = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const todayISO = () => iso(new Date());

export const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const isValidISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && iso(parseISO(s)) === s;

export const fmt = (s, opts) => parseISO(s).toLocaleDateString(undefined, opts);

export function relativeDay(s) {
  const diff = Math.round((parseISO(s) - parseISO(todayISO())) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return fmt(s, { weekday: "long" });
}

// ---------- per-viewer preferences (browser storage can be unavailable) ----------
export function pref(key, fallback) {
  try { return localStorage.getItem(`sl:${key}`) ?? fallback; } catch (e) { return fallback; }
}
export function setPref(key, value) {
  try { localStorage.setItem(`sl:${key}`, value); } catch (e) { /* private mode */ }
}
// the logged-in Player, as told by the server (/api/auth/me)
let player = null;
export const setPlayer = (name) => { player = name || null; };
export const userName = () => player || "Player";
// per-Player keys, so two accounts on one browser don't share "already shown today" flags
export const playerPref = (key, fallback) => pref(`${player}:${key}`, fallback);
export const setPlayerPref = (key, value) => setPref(`${player}:${key}`, value);

// ---------- strings ----------
export const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const initial = (title) => (title.trim().match(/[\p{L}\p{N}]/u) || ["?"])[0];

export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export const questKind = (t) => (t.is_permanent ? "Daily Quest" : "Personal Added");

// heat level 0-3 for a day's completion ratio
export function heat(done, total) {
  if (!total || !done) return 0;
  if (done === total) return 3;
  return done / total >= 0.5 ? 2 : 1;
}

// ---------- motion ----------
const reduceQuery = matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => reduceQuery.matches;

export function replayClass(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation
  el.classList.add(cls);
}

export function haptic(ms = 10) {
  try { navigator.vibrate?.(ms); } catch (e) { /* not supported */ }
}

export function countUp(el, to, ms = 700) {
  if (reducedMotion() || to === 0) { el.textContent = to; return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// glowing motes drifting up from an element, like mana leaving a cleared quest
export function particles(fromEl, count = 14) {
  if (reducedMotion() || !fromEl) return;
  const r = fromEl.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    p.className = "particle";
    p.style.left = `${r.left + Math.random() * r.width}px`;
    p.style.top = `${r.top + r.height * (0.4 + Math.random() * 0.6)}px`;
    document.body.appendChild(p);
    const dx = (Math.random() - 0.5) * 40;
    const dy = -40 - Math.random() * 90;
    p.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: `translate(${dx}px, ${dy}px) scale(.3)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 600, easing: "cubic-bezier(.2,.8,.2,1)", delay: Math.random() * 120 },
    ).onfinish = () => p.remove();
  }
}

// the System's notification "ding" (synthesised, so there is no audio file to ship)
let audio;
export const soundOn = () => pref("sound", "on") !== "off";
export function ding(kind = "notice") {
  if (!soundOn()) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume(); // browsers start audio muted until a tap
    const now = audio.currentTime;
    const notes = kind === "penalty" ? [220, 207.65] : kind === "level" ? [1046.5, 1318.5, 1568] : [1318.5, 1975.5];
    notes.forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = kind === "penalty" ? "sawtooth" : "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.07;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(kind === "penalty" ? 0.05 : 0.08, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  } catch (e) { /* audio unavailable */ }
}

// System text appears character by character; screen readers get the whole line at once
export function typewrite(el, text, speed = 28) {
  el.setAttribute("aria-label", text);
  if (reducedMotion()) { el.textContent = text; el.classList.add("typed", "is-done"); return Promise.resolve(); }
  el.textContent = "";
  el.classList.add("typed");
  el.classList.remove("is-done");
  return new Promise((resolve) => {
    let i = 0;
    let timer;
    const finish = () => {
      clearTimeout(timer);
      el.textContent = text;
      el.classList.add("is-done");
      el._finish = null;
      resolve();
    };
    const tick = () => {
      if (!el.isConnected) return resolve();
      el.textContent = text.slice(0, ++i);
      if (i < text.length) timer = setTimeout(tick, speed);
      else finish();
    };
    el._finish = finish; // lets a tap reveal the whole line at once
    tick();
  });
}

// ---------- system windows (native <dialog> for focus trapping + Esc, animated close) ----------
export function openDialog(dlg, sound = "notice") {
  dlg.classList.remove("is-closing");
  if (!dlg.open) { dlg.showModal(); if (sound) ding(sound); }
}

export function closeDialog(dlg) {
  if (!dlg.open || dlg.classList.contains("is-closing")) return;
  if (reducedMotion()) { dlg.close(); return; }
  dlg.classList.add("is-closing");
  setTimeout(() => {
    dlg.classList.remove("is-closing");
    dlg.close();
  }, 230);
}

export function makeWindow(label, { persistent = false } = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = "win";
  dlg.setAttribute("aria-label", label);
  document.body.appendChild(dlg);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(dlg); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(dlg); });
  if (!persistent) dlg.addEventListener("close", () => dlg.remove());
  return dlg;
}

export const winHead = (title, iconName = "alert") => `
  <button class="icon-btn win-close" type="button" data-close aria-label="Close">${icon("x")}</button>
  <div class="win-head">
    <span class="box icon-box" aria-hidden="true">${icon(iconName)}</span>
    <h2 class="box">${esc(title)}</h2>
  </div>`;

export function wireClose(dlg) {
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => closeDialog(dlg)));
}

// a small confirm-style menu: [{ label, danger?, run }]
export function actionMenu(title, actions) {
  const dlg = makeWindow(title);
  dlg.innerHTML = `
    <div class="win-body sys">
      ${winHead(title, "list")}
      <div class="menu-list">
        ${actions.map((a, i) => `<button class="btn btn-sys btn-block${a.danger ? " btn-danger" : ""}" type="button" data-i="${i}">${esc(a.label)}</button>`).join("")}
        <button class="btn btn-text" type="button" data-close>Cancel</button>
      </div>
    </div>`;
  wireClose(dlg);
  dlg.querySelectorAll("[data-i]").forEach((b) =>
    b.addEventListener("click", () => { closeDialog(dlg); actions[Number(b.dataset.i)].run(); }),
  );
  openDialog(dlg);
}

// ---------- toasts (system notifications) ----------
const pending = new Set();

export function toast(message, { action, onAction, onTimeout, duration = 3800, tone } = {}) {
  const region = document.querySelector(".toasts");
  const el = document.createElement("div");
  el.className = `toast sys${tone ? " penalty" : ""}`;
  ding(tone ? "penalty" : "notice");
  el.innerHTML = `<p>${esc(message)}</p>${action ? `<button type="button">${esc(action)}</button>` : ""}`;
  region.appendChild(el);

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 220);
  };
  const timer = setTimeout(() => { onTimeout?.(); dismiss(); }, duration);
  el.querySelector("button")?.addEventListener("click", () => { onAction?.(); dismiss(); });
  return { dismiss };
}

// Remove optimistically, commit after the toast unless the user taps Undo
export function withUndo(message, { commit, undo }) {
  let settled = false;
  const run = () => {
    if (settled) return;
    settled = true;
    pending.delete(run);
    commit();
  };
  pending.add(run);
  toast(message, {
    action: "Undo",
    duration: 5000,
    onTimeout: run,
    onAction: () => {
      if (settled) return;
      settled = true;
      pending.delete(run);
      undo();
    },
  });
}

// don't lose a pending delete if the tab closes before the toast expires
addEventListener("pagehide", () => pending.forEach((run) => run()));
