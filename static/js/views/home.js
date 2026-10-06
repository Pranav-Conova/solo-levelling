import { api, changed } from "../api.js";
import { openAdd } from "../add.js";
import { goalRowHTML, openQuest, paintGoalRow, toggleDone } from "../quest.js";
import {
  addDays, esc, fmt, heat, icon, makeWindow, openDialog, particles, plural, pref, reducedMotion,
  replayClass, setPref, toast, todayISO, typewrite, winHead, wireClose, withUndo,
} from "../util.js";

export const title = "Quest Info";

export function mount(el) {
  const date = todayISO();
  let day = null;
  let stats = null;
  let week = [];
  let alive = true;

  el.innerHTML = `
    <div class="page">
      <div class="home-grid">
        <section class="sys sys-window quest-window" aria-labelledby="qi-title">
          <div class="win-head">
            <span class="box icon-box" aria-hidden="true">${icon("alert")}</span>
            <h1 class="box" id="qi-title">Quest Info</h1>
          </div>
          <p class="win-lead" data-lead>&nbsp;</p>
          <h2 class="goal-title">Goal</h2>
          <ul class="goal-list" data-daily>
            ${'<li class="skeleton" style="height:44px;margin:4px 0"></li>'.repeat(3)}
          </ul>
          <div data-personal hidden>
            <div class="win-divider" style="margin:4px 0 14px"></div>
            <p class="sub-title" style="text-align:center;margin-bottom:6px">Personal quests</p>
            <ul class="goal-list" data-once></ul>
          </div>
          <p class="win-warn" data-warn></p>
          <p class="reset-timer">Time until reset: <b data-timer>--:--:--</b></p>
          <div class="win-row"><button class="btn btn-text" type="button" data-add>${icon("plus-small", "icon-sm")} New quest</button></div>
        </section>
        <aside class="home-side" aria-label="Status" data-side></aside>
      </div>
    </div>`;

  const dailyEl = el.querySelector("[data-daily]");
  const onceEl = el.querySelector("[data-once]");
  const personalEl = el.querySelector("[data-personal]");
  const warnEl = el.querySelector("[data-warn]");
  const sideEl = el.querySelector("[data-side]");
  const visible = () => day.tasks.filter((t) => !t._removed);
  const allClear = () => visible().length > 0 && visible().every((t) => t.completed);

  // ---------- reset countdown (the day ends at local midnight) ----------
  const timerEl = el.querySelector("[data-timer]");
  const tickTimer = () => {
    if (todayISO() !== date) { location.reload(); return; } // a new day: new quests
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const s = Math.max(0, Math.floor((midnight - now) / 1000));
    timerEl.textContent = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  };
  tickTimer();
  const timer = setInterval(tickTimer, 1000);

  // ---------- goals ----------
  function renderGoals(quiet = false) {
    const tasks = visible();
    const daily = tasks.filter((t) => t.is_permanent);
    const once = tasks.filter((t) => !t.is_permanent);
    dailyEl.innerHTML = daily.length
      ? daily.map((t, i) => goalRowHTML(t, i)).join("")
      : `<li class="empty-line">${tasks.length ? "No daily quests yet." : "No quests have arrived yet."}</li>`;
    personalEl.hidden = !once.length;
    onceEl.innerHTML = once.map((t, i) => goalRowHTML(t, daily.length + i)).join("");
    if (quiet) el.querySelectorAll(".goal-row").forEach((r) => r.classList.add("static"));
    renderWarn();
  }

  function renderWarn() {
    const tasks = visible();
    if (!tasks.length) {
      warnEl.innerHTML = `Accept a quest to begin. <button class="btn btn-primary btn-block" type="button" data-first style="margin-top:12px">Create a quest</button>`;
      return;
    }
    const left = tasks.filter((t) => !t.completed).length;
    warnEl.innerHTML = left
      ? `<b>WARNING:</b> Failure to complete the daily quest will result in an appropriate penalty. <span style="color:var(--text-2)">(${plural(left, "quest")} left)</span>`
      : `[The Daily Quest has been completed.]`;
  }

  function findTask(id) { return day.tasks.find((t) => t.id === Number(id)); }
  function rowFor(id) { return el.querySelector(`.goal-row[data-id="${id}"]`); }

  async function toggle(t, row) {
    const wasClear = allClear();
    const saving = toggleDone(t, date, { source: "home", el: row });
    paintGoalRow(row, t);
    if (t.completed) replayClass(row, "flash");
    renderWarn();
    if (!wasClear && allClear()) setTimeout(rewards, 900);
    if (!(await saving)) { paintGoalRow(row, t); renderWarn(); }
  }

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]") || e.target.closest("[data-first]")) { openAdd(); return; }
    const check = e.target.closest("[data-check]");
    if (check) { toggle(findTask(check.dataset.check), check.closest(".goal-row")); return; }
    const open = e.target.closest("[data-open]");
    if (open) {
      const t = findTask(open.dataset.open);
      const wasClear = allClear();
      openQuest(t, date, {
        source: "home",
        onToggle: () => { const row = rowFor(t.id); if (row) paintGoalRow(row, t); renderWarn(); },
        onClose: () => { if (alive && !wasClear && allClear()) rewards(); },
        onRemove: removeQuest,
      });
    }
  });

  function removeQuest(t) {
    const row = rowFor(t.id);
    row?.classList.add("is-leaving");
    const hide = () => { t._removed = true; renderGoals(true); };
    if (reducedMotion() || !row) hide(); else setTimeout(hide, 260);
    withUndo(t.is_permanent ? `Daily Quest abandoned: ${t.title}` : `Quest deleted: ${t.title}`, {
      commit: async () => {
        try {
          await (t.is_permanent ? api.archive(t.id) : api.remove(t.id));
          changed({ kind: "removed", source: "home" });
        } catch (err) {
          toast(`Couldn't remove: ${err.message}`, { tone: "error" });
          load();
        }
      },
      undo: () => { t._removed = false; renderGoals(true); },
    });
  }

  // ---------- System events ----------
  function rewards() {
    if (!alive || pref("rewarded") === date) return;
    setPref("rewarded", date);
    const tasks = visible();
    const exp = tasks.length * 10 + 20;
    const dlg = makeWindow("Quest complete");
    dlg.innerHTML = `
      <div class="win-body sys">
        ${winHead("Quest Complete")}
        <p class="win-lead">[The Daily Quest has been completed.]</p>
        <h3 class="goal-title">Rewards</h3>
        <div class="reward-list">
          <p>EXP <b>+${exp}</b></p>
          <p>Quests cleared <b>${tasks.length}</b></p>
          <p>Perfect-day bonus <b>+20 EXP</b></p>
        </div>
        <button class="btn btn-primary btn-block" type="button" data-close>Accept rewards</button>
      </div>`;
    wireClose(dlg);
    openDialog(dlg, "level");
    setTimeout(() => particles(dlg.querySelector(".reward-list"), 26), 500);
  }

  function penaltyCheck() {
    const yesterday = addDays(date, -1);
    const y = week.find((d) => d.date === yesterday);
    if (!y || !y.total || y.done === y.total || pref("penalty-seen") === yesterday) return;
    setPref("penalty-seen", yesterday);
    const dlg = makeWindow("Penalty");
    dlg.innerHTML = `
      <div class="win-body sys penalty">
        ${winHead("Penalty")}
        <p class="win-lead">[You failed to complete yesterday's Daily Quest.]</p>
        <div class="reward-list">
          <p>Cleared <b style="color:var(--danger);text-shadow:none">${y.done} / ${y.total}</b> quests</p>
          <p>Perfect-day bonus lost <b style="color:var(--danger);text-shadow:none">-20 EXP</b></p>
          ${y.done === 0 ? `<p>Your streak has been <b style="color:var(--danger);text-shadow:none">reset</b>.</p>` : ""}
        </div>
        <p class="win-warn">Do not fail again, ${esc(pref("name", "Hunter"))}.</p>
        <button class="btn btn-sys btn-block" type="button" data-close>I understand</button>
      </div>`;
    wireClose(dlg);
    openDialog(dlg, "penalty");
  }

  // ---------- side status (desktop) ----------
  function renderSide() {
    const span = stats.next_level_xp - stats.level_start_xp;
    const pct = Math.max(0, Math.min(1, (stats.xp - stats.level_start_xp) / span));
    sideEl.innerHTML = `
      <a class="sys mini-status" href="#/profile" aria-label="Open status: level ${stats.level}, ${esc(stats.rank)}-Rank">
        <span class="caps">Status</span>
        <div class="row"><span class="lvl">LV. ${stats.level}</span><span class="rank">${esc(stats.rank)}-Rank</span></div>
        <div class="exp">
          <div class="exp-bar"><i style="--p:${pct}"></i></div>
          <small>EXP ${stats.xp} / ${stats.next_level_xp}</small>
        </div>
        <div class="row"><span class="caps">Streak</span><span class="streak">${icon("flame")} ${plural(stats.current_streak, "day")}</span></div>
      </a>
      <div class="sys mini-status">
        <span class="caps">Last 7 days</span>
        <div class="week">
          ${week.map((d) => `
            <a href="#/calendar/${d.date}" class="${d.date === date ? "is-today" : ""}"
               aria-label="${esc(fmt(d.date, { weekday: "long", month: "short", day: "numeric" }))}: ${d.done} of ${d.total} cleared">
              <i class="h${heat(d.done, d.total)}"></i>${esc(fmt(d.date, { weekday: "narrow" }))}
            </a>`).join("")}
        </div>
      </div>`;
  }

  // ---------- data ----------
  async function load(first = false) {
    try {
      const [d, s, w] = await Promise.all([api.day(date), api.stats(), api.calendar(addDays(date, -6), date)]);
      if (!alive) return;
      day = d; stats = s; week = w;
      renderGoals(!first);
      renderSide();
      if (first) {
        typewrite(el.querySelector("[data-lead]"), d.tasks.length ? "[Daily Quest has arrived.]" : "[No Daily Quest has arrived yet.]");
        penaltyCheck();
      }
    } catch (err) {
      dailyEl.innerHTML = `<li class="empty"><h3>The System is unreachable</h3><p>${esc(err.message)}</p>
        <button class="btn btn-sys" type="button" data-retry>Try again</button></li>`;
      dailyEl.querySelector("[data-retry]").addEventListener("click", () => load(first));
    }
  }

  async function refreshSide() {
    const [s, w] = await Promise.all([api.stats(), api.calendar(addDays(date, -6), date)]);
    if (!alive) return;
    stats = s; week = w;
    renderSide();
  }

  load(true);

  return {
    refresh(detail) {
      if (detail.source === "home") refreshSide().catch(() => {});
      else load();
    },
    unmount() { alive = false; clearInterval(timer); },
  };
}
