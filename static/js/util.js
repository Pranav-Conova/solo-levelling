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
export const userName = () => pref("name", "Hunter");

// ---------- strings ----------
export const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const initial = (title) => (title.trim().match(/[\p{L}\p{N}]/u) || ["•"])[0];

export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// a stable gradient per task so each "post" has its own look, all from the palette
const MEDIA = [
  "linear-gradient(135deg, #FB6A2C, #FD3DB5)",
  "linear-gradient(135deg, #FD3DB5, #8C1946)",
  "linear-gradient(135deg, #8C1946, #FB6A2C)",
  "linear-gradient(45deg, #FB6A2C 0%, #FD3DB5 55%, #8C1946 100%)",
  "linear-gradient(160deg, #FD3DB5, #FB6A2C 70%)",
];
export const mediaFor = (id) => MEDIA[id % MEDIA.length];

// heat level 0-3 for a day's completion ratio
export function heat(done, total) {
  if (!total || !done) return 0;
  if (done === total) return 3;
  return done / total >= 0.5 ? 2 : 1;
}

// progress ring; call setRing() after insert so the stroke animates from empty
const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;
export const ring = () => `
  <svg class="ring" viewBox="0 0 76 76" aria-hidden="true">
    <circle class="ring-track" cx="38" cy="38" r="${RING_R}"/>
    <circle class="ring-value" cx="38" cy="38" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
  </svg>`;
export function setRing(svg, done, total) {
  const value = svg?.querySelector(".ring-value");
  if (!value) return;
  const p = total ? done / total : 0;
  value.style.opacity = p ? 1 : 0; // a round cap would otherwise leave a dot at 0%
  requestAnimationFrame(() => requestAnimationFrame(() => { value.style.strokeDashoffset = RING_C * (1 - p); }));
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

const BURST_COLORS = ["#FD3DB5", "#FB6A2C", "#8C1946", "#FFB8DC"];

// small particle ring around an element (used on the like button)
export function burst(host, count = 8) {
  if (reducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const dot = document.createElement("i");
    dot.className = "burst-dot";
    dot.style.background = BURST_COLORS[i % BURST_COLORS.length];
    host.appendChild(dot);
    const angle = (i / count) * Math.PI * 2;
    const dist = 22 + Math.random() * 6;
    dot.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0)`, opacity: 0 },
      ],
      { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" },
    ).onfinish = () => dot.remove();
  }
}

export function confetti(host, count = 36) {
  if (reducedMotion()) return;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("i");
    piece.className = "confetti";
    piece.style.background = BURST_COLORS[i % BURST_COLORS.length];
    host.appendChild(piece);
    const x = (Math.random() - 0.5) * 520;
    const y = -120 - Math.random() * 260;
    piece.animate(
      [
        { transform: "translate(-50%, 0) rotate(0deg)", opacity: 1 },
        { transform: `translate(calc(-50% + ${x * 0.6}px), ${y}px) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${x}px), ${y + 420}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ],
      { duration: 1500 + Math.random() * 700, easing: "cubic-bezier(.2,.7,.4,1)" },
    ).onfinish = () => piece.remove();
  }
}

// ---------- dialogs (native <dialog> for focus trapping + Esc, animated close) ----------
export function openDialog(dlg) {
  dlg.classList.remove("is-closing");
  if (!dlg.open) dlg.showModal();
}

export function closeDialog(dlg) {
  if (!dlg.open || dlg.classList.contains("is-closing")) return;
  if (reducedMotion()) { dlg.close(); return; }
  dlg.classList.add("is-closing");
  dlg.addEventListener("animationend", () => {
    dlg.classList.remove("is-closing");
    dlg.close();
  }, { once: true });
}

// Esc and backdrop clicks close with the animation instead of instantly
export function wireDialog(dlg) {
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(dlg); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDialog(dlg); });
  return dlg;
}

export function makeDialog(className) {
  const dlg = document.createElement("dialog");
  dlg.className = className;
  document.body.appendChild(dlg);
  return wireDialog(dlg);
}

// Instagram-style action sheet: [{ label, danger?, run }]
export function actionSheet(title, actions) {
  const dlg = makeDialog("sheet");
  dlg.setAttribute("aria-label", title);
  dlg.innerHTML = `
    <div class="sheet-body flush">
      <div class="grabber" aria-hidden="true"></div>
      <p class="menu-title">${esc(title)}</p>
      <div class="menu-list">
        ${actions.map((a, i) => `<button type="button" data-i="${i}" class="${a.danger ? "danger" : ""}">${esc(a.label)}</button>`).join("")}
        <button type="button" data-cancel>Cancel</button>
      </div>
    </div>`;
  dlg.addEventListener("close", () => dlg.remove());
  dlg.querySelectorAll("[data-i]").forEach((b) =>
    b.addEventListener("click", () => { closeDialog(dlg); actions[Number(b.dataset.i)].run(); }),
  );
  dlg.querySelector("[data-cancel]").addEventListener("click", () => closeDialog(dlg));
  openDialog(dlg);
}

// ---------- toasts ----------
const pending = new Set();

export function toast(message, { action, onAction, onTimeout, duration = 4000, tone } = {}) {
  const region = document.querySelector(".toasts");
  const el = document.createElement("div");
  el.className = `toast${tone ? ` ${tone}` : ""}`;
  el.innerHTML = `<p>${esc(message)}</p>${action ? `<button type="button">${esc(action)}</button>` : ""}`;
  region.appendChild(el);

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
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
