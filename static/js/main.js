import { api } from "./api.js";
import { openAdd } from "./add.js";
import { esc, initial, makeWindow, openDialog, particles, pref, replayClass, toast, userName, winHead, wireClose } from "./util.js";
import * as home from "./views/home.js";
import * as calendar from "./views/calendar.js";
import * as profile from "./views/profile.js";
import * as welcome from "./views/welcome.js";

const routes = { "": home, calendar, profile, welcome };
const viewEl = document.getElementById("view");
const mainEl = document.getElementById("main");
let current = null;
let firstRoute = true;

// ---------- router (hash based: deep links + a working back button) ----------
function route() {
  const [page = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  // first visit goes through the awakening screen once
  if (page !== "welcome" && !pref("awakened")) { location.replace("#/welcome"); return; }
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

document.querySelectorAll("[data-open-add]").forEach((b) => b.addEventListener("click", () => openAdd()));

function renderAvatar() {
  document.querySelectorAll("[data-avatar]").forEach((a) => { a.textContent = initial(userName()); });
}

// ---------- level up ----------
let lastLevel = null;

function levelUp(stats) {
  const dlg = makeWindow("Level up");
  dlg.innerHTML = `
    <div class="win-body sys">
      ${winHead("Notification", "alert")}
      <div class="levelup">
        <p class="big">Level Up!</p>
        <p class="lvl-num">${stats.level}</p>
        <p>You have leveled up. Title: <strong>${esc(stats.rank)}-Rank Hunter</strong>.</p>
        <button class="btn btn-primary btn-block" type="button" data-close>Continue</button>
      </div>
    </div>`;
  wireClose(dlg);
  openDialog(dlg, "level");
  setTimeout(() => particles(dlg.querySelector(".lvl-num"), 30), 450);
}

async function checkLevel() {
  try {
    const stats = await api.stats();
    if (lastLevel !== null && stats.level > lastLevel) levelUp(stats);
    lastLevel = stats.level;
  } catch (e) { /* views report their own errors */ }
}

// one place fans data changes out to the current view and the shell
let statsTimer;
document.addEventListener("tracker:changed", (e) => {
  const detail = e.detail || {};
  if (detail.kind === "name") { renderAvatar(); return; }
  current?.refresh?.(detail);
  clearTimeout(statsTimer);
  statsTimer = setTimeout(checkLevel, 300);
});

// tell the Player when saving can't work (offline-support)
addEventListener("offline", () => toast("Connection to the System lost. Changes won't be saved until you're back online.", { tone: "error", duration: 6000 }));
addEventListener("online", () => toast("Connection to the System restored."));

renderAvatar();
route();
checkLevel();
