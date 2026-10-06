import { api, changed } from "../api.js";
import { openAdd } from "../add.js";
import { openQuest, openQuestInfo, toggleDone } from "../quest.js";
import {
  addDays, closeDialog, esc, fmt, heat, icon, iso, isValidISO, makeWindow, openDialog,
  parseISO, plural, questKind, relativeDay, replayClass, statusText, toast, todayISO, withUndo, wireClose,
} from "../util.js";

export const title = "Quest Log";

const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }), // 2023-01-01 was a Sunday
);

export function mount(el, arg) {
  const today = todayISO();
  let selected = isValidISO(arg) ? arg : today;
  let focusDate = selected;
  let year = parseISO(selected).getFullYear();
  let month = parseISO(selected).getMonth();
  let summary = {};
  let alive = true;
  let loadToken = 0;
  const desktop = matchMedia("(min-width: 1024px)");

  el.innerHTML = `
    <div class="page">
      <div class="page-title"><div class="win-head">
        <span class="box icon-box" aria-hidden="true">${icon("calendar")}</span><h1 class="box">Quest Log</h1>
      </div></div>
      <div class="cal-page">
        <section class="sys cal-section" aria-labelledby="cal-month">
          <div class="cal-head">
            <h2 id="cal-month" aria-live="polite"></h2>
            <button class="icon-btn" type="button" data-prev aria-label="Previous month">${icon("chevron-left")}</button>
            <button class="btn btn-sys btn-sm" type="button" data-today>Today</button>
            <button class="icon-btn" type="button" data-next aria-label="Next month">${icon("chevron-right")}</button>
          </div>
          <div class="cal-weekdays caps" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${esc(d)}</span>`).join("")}</div>
          <div class="cal-grid" role="group" aria-labelledby="cal-month" data-grid></div>
          <div class="legend" aria-hidden="true">Less <i></i><i class="h1"></i><i class="h2"></i><i class="h3"></i> More</div>
          <div class="month-stats" data-mstats></div>
        </section>
        <aside class="sys day-panel" aria-label="Selected day" data-panel></aside>
      </div>
    </div>`;

  const grid = el.querySelector("[data-grid]");
  const panel = el.querySelector("[data-panel]");

  // phones: the selected day opens in a System window
  const win = makeWindow("Day record", { persistent: true });
  win.innerHTML = `<div class="win-body sys" style="padding:0">
      <button class="icon-btn win-close" type="button" data-close aria-label="Close">${icon("x")}</button>
      <div data-win-box></div>
    </div>`;
  wireClose(win);
  const winBox = win.querySelector("[data-win-box]");

  // ---------- month grid ----------
  const monthStart = () => iso(new Date(year, month, 1));
  const monthEnd = () => iso(new Date(year, month + 1, 0));

  function tileLabel(d, s) {
    const name = fmt(d, { weekday: "long", month: "long", day: "numeric" });
    if (!s || !s.total) return `${name}: no quests`;
    return `${name}: ${s.done} of ${plural(s.total, "quest")} cleared`;
  }

  function tileHTML(d, i) {
    const s = summary[d];
    const lvl = s ? heat(s.done, s.total) : 0;
    const classes = ["tile", `h${lvl}`, d > today ? "is-future" : ""].join(" ");
    return `
      <button type="button" class="${classes}" data-date="${d}" style="--i:${i}"
              tabindex="${d === focusDate ? 0 : -1}" aria-pressed="${d === selected}"
              ${d === today ? 'aria-current="date"' : ""} aria-label="${esc(tileLabel(d, s))}">
        <span class="tile-num">${parseISO(d).getDate()}</span>
        ${lvl === 3 ? icon("check", "tile-check") : ""}
        <span class="tile-count" aria-hidden="true">${s && s.total && d <= today ? `${s.done}/${s.total}` : ""}</span>
        ${s && s.total && s.done && d <= today ? `<i class="tile-bar" style="--p:${s.done / s.total}" aria-hidden="true"></i>` : ""}
      </button>`;
  }

  function renderGrid(direction, quiet = false) {
    const first = new Date(year, month, 1);
    const days = new Date(year, month + 1, 0).getDate();
    if (parseISO(focusDate).getMonth() !== month || parseISO(focusDate).getFullYear() !== year) {
      focusDate = iso(first);
    }
    let html = "";
    for (let i = 0; i < first.getDay(); i++) html += `<span class="tile pad" aria-hidden="true"></span>`;
    for (let n = 1; n <= days; n++) html += tileHTML(iso(new Date(year, month, n)), n);
    grid.innerHTML = html;
    if (quiet) grid.querySelectorAll(".tile").forEach((t) => t.classList.add("static"));
    grid.classList.remove("slide-next", "slide-prev");
    if (direction) { void grid.offsetWidth; grid.classList.add(direction > 0 ? "slide-next" : "slide-prev"); }
    el.querySelector("#cal-month").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    renderMonthStats();
  }

  function renderMonthStats() {
    const past = Object.values(summary).filter((s) => s.date <= today && s.total > 0);
    const active = past.filter((s) => s.done > 0).length;
    const perfect = past.filter((s) => s.done === s.total).length;
    const done = past.reduce((a, s) => a + s.done, 0);
    const total = past.reduce((a, s) => a + s.total, 0);
    el.querySelector("[data-mstats]").innerHTML = `
      <div class="month-stat"><strong>${active}</strong><span>active days</span></div>
      <div class="month-stat"><strong>${perfect}</strong><span>perfect days</span></div>
      <div class="month-stat"><strong>${total ? Math.round((done / total) * 100) : 0}%</strong><span>cleared</span></div>`;
  }

  async function loadMonth(direction = 0, quiet = false) {
    const token = ++loadToken;
    try {
      const data = await api.calendar(monthStart(), monthEnd());
      if (!alive || token !== loadToken) return;
      summary = Object.fromEntries(data.map((d) => [d.date, d]));
      renderGrid(direction, quiet);
    } catch (err) {
      toast(`Couldn't load the quest log: ${err.message}`, { tone: "error" });
    }
  }

  function shiftMonth(delta, focus) {
    month += delta;
    while (month < 0) { month += 12; year -= 1; }
    while (month > 11) { month -= 12; year += 1; }
    if (focus) focusDate = focus;
    return loadMonth(delta);
  }

  function updateTile(d) {
    const tile = grid.querySelector(`[data-date="${d}"]`);
    if (!tile) return;
    const fresh = document.createElement("template");
    fresh.innerHTML = tileHTML(d, 0).trim();
    const node = fresh.content.firstChild;
    node.classList.add("static");
    tile.replaceWith(node);
    renderMonthStats();
  }

  function select(d) {
    selected = d;
    focusDate = d;
    grid.querySelectorAll(".tile[data-date]").forEach((t) => {
      t.setAttribute("aria-pressed", t.dataset.date === d);
      t.tabIndex = t.dataset.date === d ? 0 : -1;
    });
    history.replaceState(null, "", `#/calendar/${d}`);
    if (desktop.matches) renderDay(panel, d);
    else { renderDay(winBox, d); openDialog(win); }
  }

  grid.addEventListener("click", (e) => {
    const tile = e.target.closest(".tile[data-date]");
    if (tile) select(tile.dataset.date);
  });

  // roving focus: arrows move by day/week, crossing into the next month when needed
  grid.addEventListener("keydown", async (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const target = addDays(focusDate, step);
    const t = parseISO(target);
    if (t.getMonth() !== month || t.getFullYear() !== year) await shiftMonth(step > 0 ? 1 : -1, target);
    focusDate = target;
    grid.querySelectorAll(".tile[data-date]").forEach((tile) => { tile.tabIndex = tile.dataset.date === target ? 0 : -1; });
    grid.querySelector(`[data-date="${target}"]`)?.focus();
  });

  // touch swipe between months
  let swipe = null;
  grid.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") swipe = { x: e.clientX, y: e.clientY }; });
  grid.addEventListener("pointerup", (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) shiftMonth(dx < 0 ? 1 : -1);
  });

  el.querySelector("[data-prev]").addEventListener("click", () => shiftMonth(-1));
  el.querySelector("[data-next]").addEventListener("click", () => shiftMonth(1));
  el.querySelector("[data-today]").addEventListener("click", () => {
    const delta = (parseISO(today).getFullYear() - year) * 12 + parseISO(today).getMonth() - month;
    if (delta) shiftMonth(delta, today).then(() => select(today));
    else select(today);
  });

  // ---------- day record ----------
  async function renderDay(box, d) {
    box.innerHTML = `<div class="daybox"><div class="skeleton" style="height:48px"></div><div class="skeleton" style="height:60px"></div><div class="skeleton" style="height:60px"></div></div>`;
    let data;
    try {
      data = await api.day(d);
    } catch (err) {
      box.innerHTML = `<div class="daybox"><p class="note">Couldn't load this day: ${esc(err.message)}</p></div>`;
      return;
    }
    if (!alive || selected !== d) return;
    const future = d > today;

    box.innerHTML = `
      <div class="daybox swap">
        <div class="daybox-head">
          <h3>${esc(relativeDay(d))}</h3>
          <p>${esc(fmt(d, { month: "long", day: "numeric", year: "numeric" }))} · <span data-day-count></span></p>
        </div>
        ${future ? `<p class="note">Planning ahead. These quests unlock when the day arrives.</p>` : ""}
        <div class="day-quests" data-list></div>
        <form class="quick-add" data-quick>
          <label class="sr-only" for="qa-${d}">Add a quest for ${esc(fmt(d, { month: "long", day: "numeric" }))}</label>
          <input class="input" id="qa-${d}" maxlength="80" autocomplete="off" placeholder="Add a quest for this day…" />
          <button class="btn btn-primary" type="submit">Add</button>
        </form>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          <button class="btn btn-text" type="button" data-info>${icon("info", "icon-sm")} Quest info</button>
          <button class="btn btn-text" type="button" data-new-goal>${icon("repeat", "icon-sm")} New daily quest</button>
        </div>
      </div>`;

    const list = box.querySelector("[data-list]");

    const sync = () => {
      const done = data.tasks.filter((t) => t.completed).length;
      const total = data.tasks.length;
      box.querySelector("[data-day-count]").textContent = total ? `${done}/${total} cleared` : "no quests";
      summary[d] = { date: d, done, total };
      updateTile(d);
    };

    const rowHTML = (t, i) => `
      <article class="sys quest${t.completed ? " is-done" : ""}" style="--i:${i}" data-id="${t.id}">
        <button class="quest-main" type="button" data-open aria-label="${esc(t.title)}, ${questKind(t)}. Open quest">
          <strong>${esc(t.title)}</strong><small>${questKind(t)}</small>
        </button>
        <span class="status-text" aria-hidden="true">${statusText(t)}</span>
        <button class="box-check" type="button" role="checkbox" aria-checked="${t.completed}" data-check
                aria-label="${esc(t.title)} complete" ${future ? "disabled" : ""}><i>${icon("check")}</i></button>
      </article>`;

    const renderList = (quiet = false) => {
      list.innerHTML = data.tasks.length
        ? data.tasks.map(rowHTML).join("")
        : `<p class="empty-line">No quests recorded. Add one below.</p>`;
      if (quiet) list.querySelectorAll(".quest").forEach((q) => q.classList.add("static"));
    };
    renderList();
    sync();

    list.addEventListener("click", async (e) => {
      const card = e.target.closest(".quest[data-id]");
      if (!card) return;
      const t = data.tasks.find((x) => x.id === Number(card.dataset.id));
      if (e.target.closest("[data-check]")) {
        const saving = toggleDone(t, d, { source: "calendar", el: card });
        renderList(true);
        if (t.completed) replayClass(list.querySelector(`[data-id="${t.id}"]`), "flash");
        sync();
        if (!(await saving)) { renderList(true); sync(); }
      } else if (e.target.closest("[data-open]")) {
        openQuest(t, d, {
          source: "calendar",
          onToggle: () => { renderList(true); sync(); },
          onClose: () => { renderList(true); sync(); },
          onRemove: removeQuest,
        });
      }
    });

    function removeQuest(t) {
      const idx = data.tasks.indexOf(t);
      data.tasks.splice(idx, 1);
      renderList(true);
      sync();
      withUndo(t.is_permanent ? `Daily Quest abandoned: ${t.title}` : `Quest deleted: ${t.title}`, {
        commit: async () => {
          try {
            await (t.is_permanent ? api.archive(t.id) : api.remove(t.id));
            changed({ kind: "removed", source: "calendar" });
          } catch (err) {
            toast(`Couldn't remove: ${err.message}`, { tone: "error" });
          }
          loadMonth(0, true);
        },
        undo: () => {
          data.tasks.splice(idx, 0, t);
          renderList(true);
          sync();
        },
      });
    }

    box.querySelector("[data-quick]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      input.disabled = true;
      try {
        const t = await api.create({ title: value, is_permanent: false, specific_date: d });
        data.tasks.push(t);
        renderList(true);
        list.lastElementChild?.classList.remove("static");
        sync();
        input.value = "";
        changed({ kind: "created", source: "calendar" });
      } catch (err) {
        toast(`Couldn't add: ${err.message}`, { tone: "error" });
      } finally {
        input.disabled = false;
        input.focus();
      }
    });

    box.querySelector("[data-info]").addEventListener("click", () =>
      openQuestInfo(data.tasks, d, {
        source: "calendar",
        onClose: () => { renderList(true); sync(); },
      }),
    );
    box.querySelector("[data-new-goal]").addEventListener("click", () => openAdd({ kind: "daily" }));
  }

  const onBreakpoint = () => {
    if (desktop.matches) { closeDialog(win); renderDay(panel, selected); }
  };
  desktop.addEventListener("change", onBreakpoint);

  loadMonth().then(() => {
    if (desktop.matches) renderDay(panel, selected);
    else if (isValidISO(arg)) select(arg); // deep link opens the day on phones
  });

  return {
    refresh(detail) {
      if (detail.source === "calendar") return;
      loadMonth(0, true);
      if (desktop.matches) renderDay(panel, selected);
      else if (win.open) renderDay(winBox, selected);
    },
    unmount() {
      alive = false;
      desktop.removeEventListener("change", onBreakpoint);
      win.remove();
    },
  };
}
