import { api } from "./api.js";
import { openAdd } from "./add.js";
import { esc, initial, makeWindow, openDialog, particles, replayClass, setPlayer, toast, userName, winHead, wireClose } from "./util.js";
import * as home from "./views/home.js";
import * as calendar from "./views/calendar.js";
import * as profile from "./views/profile.js";
import * as welcome from "./views/welcome.js";
import * as login from "./views/login.js";

const routes = { "": home, calendar, profile, welcome, login };
const PUBLIC = new Set(["welcome", "login"]); // reachable without an account
const viewEl = document.getElementById("view");
const mainEl = document.getElementById("main");
let current = null;
let firstRoute = true;
let session = null; // /api/auth/me: { authenticated, username, registration_open, has_users }

// ---------- router (hash based: deep links + a working back button) ----------
function route() {
  if (!session) return; // wait for the session check on boot
  const [page = "", arg] = location.hash.replace(/^#\/?/, "").split("/");
  const key = page in routes ? page : "";

  if (!session.authenticated && !PUBLIC.has(key)) {
    // a brand-new System starts with the awakening; otherwise ask the Player to identify
    location.replace(!session.has_users && session.registration_open ? "#/welcome" : "#/login");
    return;
  }
  if (session.authenticated && PUBLIC.has(key)) { location.replace("#/"); return; }
  if (key === "welcome" && !session.registration_open) { location.replace("#/login"); return; }

  const view = routes[key];
  current?.unmount?.();
  document.querySelectorAll("[data-route]").forEach((a) => {
    if (a.dataset.route === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  replayClass(viewEl, "view-enter");
  current = view.mount(viewEl, arg, { registrationOpen: session.registration_open });
  document.title = `${view.title} · Solo Levelling`;

  if (!firstRoute) {
    scrollTo(0, 0);
    mainEl.focus({ preventScroll: true });
  }
  firstRoute = false;
}
addEventListener("hashchange", route);

document.querySelectorAll("[data-open-add]").forEach((b) => b.addEventListener("click", () => openAdd()));

function applySession(next) {
  session = next;
  setPlayer(session.authenticated ? session.username : null);
  document.querySelectorAll("[data-avatar]").forEach((a) => { a.textContent = initial(userName()); });
}

// login, sign-up and logout all report the new session here
document.addEventListener("tracker:session", (e) => {
  const wasIn = session?.authenticated;
  applySession(e.detail);
  lastLevel = null;
  if (session.authenticated) checkLevel();
  else if (wasIn) location.hash = "#/login";
});

// the server said "not logged in" (expired or revoked session)
document.addEventListener("tracker:unauthorized", () => {
  if (!session?.authenticated) return;
  applySession({ ...session, authenticated: false, username: null, has_users: true });
  toast("Your session has ended. Identify yourself to continue.", { tone: "error" });
  location.hash = "#/login";
});

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
  if (!session?.authenticated) return;
  try {
    const stats = await api.stats();
    if (lastLevel !== null && stats.level > lastLevel) levelUp(stats);
    lastLevel = stats.level;
  } catch (e) { /* views report their own errors */ }
}

// one place fans data changes out to the current view and the shell
let statsTimer;
document.addEventListener("tracker:changed", (e) => {
  current?.refresh?.(e.detail || {});
  clearTimeout(statsTimer);
  statsTimer = setTimeout(checkLevel, 300);
});

// tell the Player when saving can't work (offline-support)
addEventListener("offline", () => toast("Connection to the System lost. Changes won't be saved until you're back online.", { tone: "error", duration: 6000 }));
addEventListener("online", () => toast("Connection to the System restored."));

async function boot() {
  try {
    applySession(await api.me());
  } catch (e) {
    applySession({ authenticated: false, username: null, registration_open: false, has_users: true });
    toast(`Couldn't reach the System: ${e.message}`, { tone: "error", duration: 8000 });
  }
  route();
  checkLevel();
}

boot();
