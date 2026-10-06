import { api } from "./api.js";
import { openAdd } from "./add.js";
import { confetti, esc, icon, pref, replayClass, setPref } from "./util.js";
import * as home from "./views/home.js";
import * as calendar from "./views/calendar.js";
import * as profile from "./views/profile.js";

const routes = { "": home, calendar, profile };
const viewEl = document.getElementById("view");
const mainEl = document.getElementById("main");
let current = null;
let firstRoute = true;

// ---------- router (hash based: deep links + a working back button) ----------
function route() {
  const [page = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  const key = page in routes ? page : "";
  const view = routes[key];

  current?.unmount?.();
  document.querySelectorAll("[data-route]").forEach((a) => {
    if (a.dataset.route === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  replayClass(viewEl, "view-enter");
  current = view.mount(viewEl, arg);
  document.title = `${view.title} · Solo Levelling`;

  if (!firstRoute) {
    scrollTo(0, 0);
    mainEl.focus({ preventScroll: true });
  }
  firstRoute = false;
}
addEventListener("hashchange", route);

// ---------- create buttons ----------
document.querySelectorAll("[data-open-add]").forEach((b) => b.addEventListener("click", () => openAdd()));

// ---------- theme ----------
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const effectiveTheme = () => document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light");

function renderThemeButtons() {
  const dark = effectiveTheme() === "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.querySelector("use").setAttribute("href", dark ? "#i-sun" : "#i-moon");
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  });
  document.querySelectorAll("[data-theme-label]").forEach((s) => { s.textContent = dark ? "Light mode" : "Dark mode"; });
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = dark ? "#000000" : "#ffffff"; });
}

document.querySelectorAll("[data-theme-toggle]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setPref("theme", next);
    renderThemeButtons();
  }),
);
darkQuery.addEventListener("change", renderThemeButtons);
if (pref("theme")) document.documentElement.dataset.theme = pref("theme");
renderThemeButtons();

// ---------- streak chip + level-up ----------
let lastLevel = null;

function renderStreak(stats) {
  document.querySelectorAll("[data-streak-chip]").forEach((chip) => {
    const prev = chip.dataset.value;
    chip.hidden = false;
    chip.dataset.value = stats.current_streak;
    chip.innerHTML = `${icon("flame")}<span>${stats.current_streak}</span>`;
    chip.setAttribute("aria-label", `${stats.current_streak} day streak`);
    chip.setAttribute("role", "img");
    if (prev !== undefined && Number(prev) < stats.current_streak) replayClass(chip, "bump");
  });
}

function celebrate(stats) {
  const opener = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "celebrate";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "lvl-title");
  overlay.innerHTML = `
    <div class="celebrate-card">
      <p class="kicker" id="lvl-title">Level up</p>
      <p class="lvl">${stats.level}</p>
      <p>You're now Rank ${esc(stats.rank)}. Keep stacking days.</p>
      <button class="btn" type="button">Continue</button>
    </div>`;
  document.body.appendChild(overlay);
  const btn = overlay.querySelector("button");
  btn.focus();
  confetti(overlay.querySelector(".celebrate-card"));

  const close = () => {
    overlay.classList.add("is-leaving");
    setTimeout(() => overlay.remove(), 260);
    opener?.focus?.();
  };
  btn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); if (e.key === "Escape") close(); }
  });
}

async function refreshStats() {
  try {
    const stats = await api.stats();
    renderStreak(stats);
    if (lastLevel !== null && stats.level > lastLevel) celebrate(stats);
    lastLevel = stats.level;
  } catch (e) { /* the chip is decorative; views report their own errors */ }
}

// one place fans data changes out to the current view and the shell
let statsTimer;
document.addEventListener("tracker:changed", (e) => {
  current?.refresh?.(e.detail || {});
  clearTimeout(statsTimer);
  statsTimer = setTimeout(refreshStats, 250);
});

route();
refreshStats();
