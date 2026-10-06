import { api, changed } from "../api.js";
import { openAdd } from "../add.js";
import {
  addDays, closeDialog, countUp, ding, esc, fmt, heat, icon, makeWindow, openDialog, parseISO, plural,
  reducedMotion, setPref, soundOn, toast, todayISO, userName, winHead, wireClose, withUndo,
} from "../util.js";

export const title = "Status";

const RANK_TITLES = { E: "E-Rank Hunter", D: "D-Rank Hunter", C: "C-Rank Hunter", B: "B-Rank Hunter", A: "A-Rank Hunter", S: "S-Rank Hunter" };

export function mount(el, arg) {
  const today = todayISO();
  let tab = arg === "habits" ? "habits" : "days";
  let stats, habits, days, today_;
  let alive = true;

  el.innerHTML = `
    <div class="page">
      <div class="status-wrap">
        <section class="sys sys-window" aria-label="Player status" data-status>
          <div class="skeleton" style="height:96px"></div>
          <div class="skeleton" style="height:64px"></div>
        </section>
        <div>
          <div class="tabs" role="tablist" aria-label="Status sections">
            <span class="tabs-ink" aria-hidden="true"></span>
            <button class="tab-btn" type="button" role="tab" id="tab-days" aria-controls="panel-days" data-tab="days">${icon("grid")} Records</button>
            <button class="tab-btn" type="button" role="tab" id="tab-habits" aria-controls="panel-habits" data-tab="habits">${icon("list")} Daily Quests</button>
          </div>
          <div role="tabpanel" id="panel-days" aria-labelledby="tab-days" data-panel="days" style="padding-top:16px"></div>
          <div role="tabpanel" id="panel-habits" aria-labelledby="tab-habits" data-panel="habits" style="padding-top:16px"></div>
        </div>
      </div>
    </div>`;

  const statusEl = el.querySelector("[data-status]");
  const ink = el.querySelector(".tabs-ink");
  const tabs = [...el.querySelectorAll("[role=tab]")];

  // ---------- status window (the anime's STATUS screen, driven by real numbers) ----------
  function renderStatus(quiet) {
    const span = stats.next_level_xp - stats.level_start_xp;
    const mp = Math.max(0, Math.min(1, (stats.xp - stats.level_start_xp) / span));
    const done = today_.tasks.filter((t) => t.completed).length;
    const total = today_.tasks.length;
    const hp = total ? done / total : 0;
    const stat = (k, v, what) => `
      <div class="stat-line"><span class="k">${k}<small>${what}</small></span><span class="v" data-count="${v}">${quiet ? v : 0}</span></div>`;
    statusEl.innerHTML = `
      <div class="win-head"><h1 class="box">Status</h1></div>
      <div class="status-top">
        <div class="status-lines">
          <div class="status-name"><span class="k">NAME:</span>&nbsp;<span class="v">${esc(userName())}</span></div>
          <div><span class="k">JOB:</span> <span class="v">None</span></div>
          <div><span class="k">TITLE:</span> <span class="v">${esc(RANK_TITLES[stats.rank] || `${stats.rank}-Rank Hunter`)}</span></div>
          <div><span class="k">FATIGUE:</span> <span class="v">${total - done}</span> <small style="color:var(--text-3);font-size:14px">quests left today</small></div>
        </div>
        <div class="status-level"><span class="caps">Level</span><strong>${stats.level}</strong></div>
      </div>
      <div class="bars">
        <div class="bar-row"><span class="k">HP</span><div class="exp-bar hp" role="progressbar" aria-label="Today's quests cleared" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i data-bar="${hp}"></i></div><span class="v">${done}/${total}</span></div>
        <div class="bar-row"><span class="k">MP</span><div class="exp-bar" role="progressbar" aria-label="EXP to level ${stats.level + 1}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(mp * 100)}"><i data-bar="${mp}"></i></div><span class="v">${stats.xp}/${stats.next_level_xp}</span></div>
        <small style="font-size:14px;color:var(--text-3)">HP is today's quests cleared. MP is EXP towards level ${stats.level + 1}: 10 EXP per quest, +20 for a perfect day.</small>
      </div>
      <div class="win-divider"></div>
      <div class="stat-list">
        ${stat("STR", stats.total_done, "quests cleared")}
        ${stat("VIT", stats.best_streak, "best streak")}
        ${stat("AGI", stats.current_streak, "current streak")}
        ${stat("INT", stats.active_days, "active days")}
        ${stat("PER", stats.perfect_days, "perfect days")}
      </div>
      <div class="status-foot">
        <span class="caps">System sound</span>
        <button class="btn btn-sys btn-sm" type="button" data-sound aria-pressed="${soundOn()}">${icon(soundOn() ? "volume" : "mute", "icon-sm")} ${soundOn() ? "On" : "Off"}</button>
      </div>
      <div class="win-divider"></div>
      <div class="status-foot">
        <button class="btn btn-sys btn-sm" type="button" data-password>${icon("key", "icon-sm")} Change password</button>
        <button class="btn btn-text btn-danger" type="button" data-logout>${icon("logout", "icon-sm")} Log out</button>
      </div>`;
    statusEl.querySelectorAll("[data-count]").forEach((n) => { if (!quiet) countUp(n, Number(n.dataset.count)); });
    const bars = statusEl.querySelectorAll("[data-bar]");
    const fill = () => bars.forEach((b) => b.style.setProperty("--p", b.dataset.bar));
    if (quiet) fill(); else requestAnimationFrame(() => requestAnimationFrame(fill));
    statusEl.querySelector("[data-password]").addEventListener("click", openPasswordWindow);
    statusEl.querySelector("[data-logout]").addEventListener("click", logout);
    statusEl.querySelector("[data-sound]").addEventListener("click", () => {
      setPref("sound", soundOn() ? "off" : "on");
      renderStatus(true);
      ding();
      statusEl.querySelector("[data-sound]").focus();
    });
  }

  // ---------- account ----------
  async function logout(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await api.logout();
      document.dispatchEvent(new CustomEvent("tracker:session", { detail: await api.me() }));
    } catch (err) {
      toast(`Couldn't log out: ${err.message}`, { tone: "error" });
      btn.disabled = false;
    }
  }

  function openPasswordWindow() {
    const dlg = makeWindow("Change password");
    dlg.innerHTML = `
      <form class="win-body sys auth-form" method="post" novalidate>
        ${winHead("Password", "key")}
        <input type="text" name="username" autocomplete="username" value="${esc(userName())}" hidden />
        <div class="field">
          <label for="pw-current">Current password</label>
          <input class="input" id="pw-current" name="current" type="password" autocomplete="current-password" required aria-describedby="pw-current-err" />
          <p class="field-error" id="pw-current-err" hidden></p>
        </div>
        <div class="field">
          <label for="pw-new">New password</label>
          <input class="input" id="pw-new" name="next" type="password" autocomplete="new-password" required aria-describedby="pw-new-help pw-new-err" />
          <p class="field-help" id="pw-new-help">At least 8 characters. Your other devices will be signed out.</p>
          <p class="field-error" id="pw-new-err" hidden></p>
        </div>
        <div class="field">
          <label for="pw-confirm">Confirm new password</label>
          <input class="input" id="pw-confirm" name="confirm" type="password" autocomplete="new-password" required aria-describedby="pw-confirm-err" />
          <p class="field-error" id="pw-confirm-err" hidden></p>
        </div>
        <p class="form-error" role="alert" data-form-error hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Change password</button>
      </form>`;
    wireClose(dlg);
    const form = dlg.querySelector("form");
    const { current, next, confirm } = form.elements;
    const button = form.querySelector("[type=submit]");
    const setError = (input, msg) => {
      const el = form.querySelector(`#${input.id}-err`);
      el.textContent = msg || "";
      el.hidden = !msg;
      input.setAttribute("aria-invalid", msg ? "true" : "false");
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      form.querySelector("[data-form-error]").hidden = true;
      const problems = [
        [current, current.value ? "" : "Enter your current password."],
        [next, next.value.length >= 8 ? "" : "Use at least 8 characters."],
        [confirm, confirm.value === next.value ? "" : "The passwords don't match."],
      ];
      problems.forEach(([input, msg]) => setError(input, msg));
      const first = problems.find(([, msg]) => msg);
      if (first) { first[0].focus(); return; }
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        await api.changePassword(current.value, next.value);
        closeDialog(dlg);
        toast("Password changed. Other devices were signed out.");
      } catch (err) {
        if (err.status === 400) { setError(current, err.message); current.select(); }
        else { const box = form.querySelector("[data-form-error]"); box.textContent = err.message; box.hidden = false; }
        button.disabled = false;
        button.textContent = "Change password";
      }
    });
    openDialog(dlg);
    current.focus();
  }

  // ---------- tabs ----------
  function moveInk() {
    const active = tabs.find((t) => t.dataset.tab === tab);
    ink.style.width = `${active.offsetWidth}px`;
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function selectTab(name, focus = false) {
    tab = name;
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute("aria-selected", on);
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    el.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
    history.replaceState(null, "", name === "habits" ? "#/profile/habits" : "#/profile");
    moveInk();
  }

  tabs.forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));
  el.querySelector("[role=tablist]").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    selectTab(tab === "days" ? "habits" : "days", true);
  });
  const onResize = () => moveInk();
  addEventListener("resize", onResize);

  // ---------- records: last 30 days ----------
  function renderDays() {
    const panel = el.querySelector('[data-panel="days"]');
    panel.innerHTML = `
      <div class="days-grid">
        ${[...days].reverse().map((d, i) => {
          const label = `${fmt(d.date, { weekday: "long", month: "long", day: "numeric" })}: ${d.total ? `${d.done} of ${plural(d.total, "quest")} cleared` : "no quests"}`;
          return `
            <a class="day-cell h${heat(d.done, d.total)}" href="#/calendar/${d.date}" style="--i:${i}" aria-label="${esc(label)}">
              <strong>${parseISO(d.date).getDate()}</strong>
              <span>${esc(d.date === today ? "Today" : fmt(d.date, { month: "short" }))}</span>
            </a>`;
        }).join("")}
      </div>`;
  }

  // ---------- daily quests ----------
  function renderHabits() {
    const panel = el.querySelector('[data-panel="habits"]');
    if (!habits.length) {
      panel.innerHTML = `
        <div class="sys empty">
          <h3>No Daily Quests</h3>
          <p>Daily Quests return every day until you abandon them.</p>
          <button class="btn btn-primary" type="button" data-new>Create a Daily Quest</button>
        </div>`;
      panel.querySelector("[data-new]").addEventListener("click", () => openAdd({ kind: "daily" }));
      return;
    }
    panel.innerHTML = `
      <ul class="quest-list">
        ${habits.map((h, i) => `
          <li class="sys habit-row" style="--i:${i}" data-id="${h.id}">
            <div>
              <strong>${esc(h.title)}</strong>
              <small>Since ${esc(fmt(h.start_date, { month: "short", day: "numeric" }))} · ${plural(h.total_done, "day")} cleared${h.completed_today ? " · cleared today" : ""}</small>
            </div>
            <span class="streak" aria-label="${h.streak} day streak">${icon("flame")} ${h.streak}</span>
            <button class="btn btn-sys btn-sm" type="button" data-stop>Abandon</button>
          </li>`).join("")}
      </ul>`;
  }

  el.querySelector('[data-panel="habits"]').addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stop]");
    if (!btn) return;
    const row = btn.closest(".habit-row");
    const id = Number(row.dataset.id);
    const idx = habits.findIndex((h) => h.id === id);
    const [habit] = habits.splice(idx, 1);
    row.classList.add("is-leaving");
    const hide = () => { row.hidden = true; if (!habits.length) renderHabits(); };
    if (reducedMotion()) hide(); else setTimeout(hide, 260);
    withUndo(`Daily Quest abandoned: ${habit.title}. Its record stays.`, {
      commit: async () => {
        try {
          await api.archive(id);
          changed({ kind: "removed", source: "profile" });
        } catch (err) {
          toast(`Couldn't abandon quest: ${err.message}`, { tone: "error" });
          load();
        }
      },
      undo: () => {
        habits.splice(idx, 0, habit);
        renderHabits();
      },
    });
  });

  // ---------- data ----------
  async function load(quiet = false) {
    try {
      const [s, h, d, t] = await Promise.all([api.stats(), api.habits(), api.calendar(addDays(today, -29), today), api.day(today)]);
      if (!alive) return;
      stats = s; habits = h; days = d; today_ = t;
      renderStatus(quiet);
      renderDays();
      renderHabits();
      if (quiet) el.querySelectorAll(".day-cell, .habit-row").forEach((n) => n.classList.add("static"));
      selectTab(tab);
    } catch (err) {
      statusEl.innerHTML = `<div class="empty"><h3>The System is unreachable</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  selectTab(tab);
  load();

  return {
    refresh(detail) { if (detail.source !== "profile") load(true); },
    unmount() { alive = false; removeEventListener("resize", onResize); },
  };
}
