import { api, changed } from "../api.js";
import { openAdd } from "../add.js";
import {
  addDays, countUp, esc, fmt, heat, icon, initial, parseISO, plural, reducedMotion,
  setPref, toast, todayISO, userName, withUndo,
} from "../util.js";

export const title = "Profile";

export function mount(el, arg) {
  const today = todayISO();
  let tab = arg === "habits" ? "habits" : "days";
  let stats, habits, days;
  let alive = true;

  el.innerHTML = `
    <div class="profile">
      <header class="profile-head" data-head>
        <span class="avatar"><span class="skeleton" style="border-radius:50%"></span></span>
        <div class="skeleton" style="height:24px;width:60%"></div>
      </header>
      <div class="tabs" role="tablist" aria-label="Profile sections">
        <span class="tabs-ink" aria-hidden="true"></span>
        <button class="tab-btn" type="button" role="tab" id="tab-days" aria-controls="panel-days" data-tab="days">${icon("grid")} Days</button>
        <button class="tab-btn" type="button" role="tab" id="tab-habits" aria-controls="panel-habits" data-tab="habits">${icon("list")} Habits</button>
      </div>
      <div role="tabpanel" id="panel-days" aria-labelledby="tab-days" data-panel="days"></div>
      <div role="tabpanel" id="panel-habits" aria-labelledby="tab-habits" data-panel="habits"></div>
    </div>`;

  const head = el.querySelector("[data-head]");
  const ink = el.querySelector(".tabs-ink");
  const tabs = [...el.querySelectorAll("[role=tab]")];

  // ---------- header ----------
  function renderHead(quiet) {
    const span = stats.next_level_xp - stats.level_start_xp;
    const pct = Math.max(0, Math.min(1, (stats.xp - stats.level_start_xp) / span));
    head.innerHTML = `
      <span class="avatar"><span>${esc(initial(userName()))}</span></span>
      <div class="profile-name" data-name-wrap>
        <h1>${esc(userName())}</h1>
        <button class="icon-btn" type="button" data-edit aria-label="Edit name">${icon("pencil", "icon-sm")}</button>
        <span class="rank-badge">${icon("level", "icon-sm")} Rank ${esc(stats.rank)}</span>
      </div>
      <ul class="profile-stats">
        <li><strong data-count="${stats.total_done}">0</strong>tasks done</li>
        <li><strong data-count="${stats.current_streak}">0</strong>day streak</li>
        <li><strong data-count="${stats.best_streak}">0</strong>best streak</li>
      </ul>
      <div class="level-card">
        <div class="level-row"><strong>Level ${stats.level}</strong><span>${stats.xp} XP</span></div>
        <div class="progress" role="progressbar" aria-label="Progress to level ${stats.level + 1}"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct * 100)}"><i></i></div>
        <small>${stats.next_level_xp - stats.xp} XP to level ${stats.level + 1} · 10 XP per task, +20 for a perfect day</small>
      </div>`;
    head.querySelectorAll("[data-count]").forEach((n) => {
      if (quiet) n.textContent = n.dataset.count;
      else countUp(n, Number(n.dataset.count));
    });
    const bar = head.querySelector(".progress");
    if (quiet) bar.style.setProperty("--p", pct);
    else requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty("--p", pct)));
    head.querySelector("[data-edit]").addEventListener("click", editName);
  }

  function editName() {
    const wrap = head.querySelector("[data-name-wrap]");
    const h1 = wrap.querySelector("h1");
    const editBtn = wrap.querySelector("[data-edit]");
    const form = document.createElement("form");
    form.innerHTML = `
      <label class="sr-only" for="name-input">Your name</label>
      <input class="input" id="name-input" maxlength="30" value="${esc(userName())}" style="min-height:40px;width:200px" />
      <button class="btn btn-primary" type="submit" style="min-height:40px">Save</button>`;
    h1.replaceWith(form);
    editBtn.hidden = true;
    const input = form.querySelector("input");
    input.select();
    const finish = (save) => {
      const value = input.value.trim();
      if (save && value) setPref("name", value);
      renderHead(true);
      head.querySelector("[data-edit]").focus();
    };
    form.addEventListener("submit", (e) => { e.preventDefault(); finish(true); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } });
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

  // ---------- days grid (newest first, like a profile's posts) ----------
  function renderDays() {
    const panel = el.querySelector('[data-panel="days"]');
    const list = [...days].reverse();
    panel.innerHTML = `
      <div class="days-grid">
        ${list.map((d, i) => {
          const lvl = heat(d.done, d.total);
          const label = `${fmt(d.date, { weekday: "long", month: "long", day: "numeric" })}: ${d.total ? `${d.done} of ${plural(d.total, "task")} done` : "no tasks"}`;
          return `
            <a class="day-post h${lvl}" href="#/calendar/${d.date}" style="--i:${i}"
               data-hover="${d.total ? `${d.done}/${d.total} done` : "No tasks"}" aria-label="${esc(label)}">
              <strong>${parseISO(d.date).getDate()}</strong>
              <span>${esc(d.date === today ? "Today" : fmt(d.date, { month: "short" }))}</span>
            </a>`;
        }).join("")}
      </div>`;
  }

  // ---------- habits ----------
  function renderHabits() {
    const panel = el.querySelector('[data-panel="habits"]');
    if (!habits.length) {
      panel.innerHTML = `
        <div class="empty">
          <div class="empty-art">${icon("repeat")}</div>
          <h3>No daily habits yet</h3>
          <p>Habits show up every day until you stop them.</p>
          <button class="btn btn-primary" type="button" data-new>Create a habit</button>
        </div>`;
      panel.querySelector("[data-new]").addEventListener("click", () => openAdd({ kind: "daily" }));
      return;
    }
    panel.innerHTML = `
      <ul class="habit-list">
        ${habits.map((h, i) => `
          <li class="habit-row" style="--i:${i}" data-id="${h.id}">
            <span class="avatar${h.completed_today ? " is-done" : ""}"><span>${esc(initial(h.title))}</span></span>
            <div class="habit-info">
              <strong>${esc(h.title)}</strong>
              <small>Since ${esc(fmt(h.start_date, { month: "short", day: "numeric" }))} · ${plural(h.total_done, "day")} done${h.completed_today ? " · done today" : ""}</small>
            </div>
            <span class="chip" aria-label="${h.streak} day streak">${icon("flame")} ${h.streak}</span>
            <button class="btn btn-secondary" type="button" data-stop style="min-height:36px;padding:0 12px;font-size:14px">Stop</button>
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
    if (reducedMotion()) hide(); else row.addEventListener("animationend", hide, { once: true });
    withUndo(`Stopped "${habit.title}". Its history stays.`, {
      commit: async () => {
        try {
          await api.archive(id);
          changed({ kind: "removed", source: "profile" });
        } catch (err) {
          toast(`Couldn't stop habit: ${err.message}`, { tone: "error" });
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
      const [s, h, d] = await Promise.all([api.stats(), api.habits(), api.calendar(addDays(today, -29), today)]);
      if (!alive) return;
      stats = s; habits = h; days = d;
      renderHead(quiet);
      renderDays();
      renderHabits();
      if (quiet) el.querySelectorAll(".day-post, .habit-row").forEach((n) => n.classList.add("static"));
      selectTab(tab);
    } catch (err) {
      head.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Couldn't load your profile</h3><p>${esc(err.message)}</p></div>`;
    }
  }

  selectTab(tab);
  load();

  return {
    refresh(detail) { if (detail.source !== "profile") load(true); },
    unmount() { alive = false; removeEventListener("resize", onResize); },
  };
}
