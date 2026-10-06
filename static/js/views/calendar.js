import { api, changed } from "../api.js";
import { openAdd } from "../add.js";
import {
  closeDialog, esc, fmt, heat, icon, iso, isValidISO, makeDialog, openDialog, parseISO, plural,
  reducedMotion, relativeDay, ring, setRing, toast, todayISO, withUndo, addDays,
} from "../util.js";

export const title = "Calendar";

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
    <div class="cal-page">
      <section aria-labelledby="cal-title">
        <div class="cal-head">
          <h1 id="cal-title" aria-live="polite"></h1>
          <button class="icon-btn" type="button" data-prev aria-label="Previous month">${icon("chevron-left")}</button>
          <button class="btn btn-secondary" type="button" data-today style="min-height:36px;padding:0 14px">Today</button>
          <button class="icon-btn" type="button" data-next aria-label="Next month">${icon("chevron-right")}</button>
        </div>
        <p class="cal-sub">Tap a day to see and update its tasks. Swipe to change month.</p>
        <div class="cal-weekdays" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${esc(d)}</span>`).join("")}</div>
        <div class="cal-grid" role="group" aria-labelledby="cal-title" data-grid></div>
        <div class="legend" aria-hidden="true">Less <i></i><i class="h1"></i><i class="h2"></i><i class="h3"></i> More</div>
        <div class="month-stats" data-mstats></div>
      </section>
      <aside class="day-panel" aria-label="Selected day" data-panel></aside>
    </div>`;

  const grid = el.querySelector("[data-grid]");
  const panel = el.querySelector("[data-panel]");

  // mobile: the selected day opens in a bottom sheet
  const sheet = makeDialog("sheet");
  sheet.setAttribute("aria-label", "Day details");
  sheet.innerHTML = `
    <div class="sheet-body" style="padding-left:0;padding-right:0">
      <div class="grabber" aria-hidden="true"></div>
      <button class="icon-btn sheet-close" type="button" data-close aria-label="Close">${icon("x")}</button>
      <div data-sheet-box></div>
    </div>`;
  const sheetBox = sheet.querySelector("[data-sheet-box]");
  sheet.querySelector("[data-close]").addEventListener("click", () => closeDialog(sheet));

  // ---------- month grid ----------
  const monthStart = () => iso(new Date(year, month, 1));
  const monthEnd = () => iso(new Date(year, month + 1, 0));

  function tileLabel(d, s) {
    const name = fmt(d, { weekday: "long", month: "long", day: "numeric" });
    if (!s || !s.total) return `${name}: no tasks`;
    return `${name}: ${s.done} of ${plural(s.total, "task")} done`;
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
    el.querySelector("#cal-title").textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
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
      <div class="month-stat"><strong>${total ? Math.round((done / total) * 100) : 0}%</strong><span>completion</span></div>`;
  }

  async function loadMonth(direction = 0, quiet = false) {
    const token = ++loadToken;
    try {
      const data = await api.calendar(monthStart(), monthEnd());
      if (!alive || token !== loadToken) return;
      summary = Object.fromEntries(data.map((d) => [d.date, d]));
      renderGrid(direction, quiet);
    } catch (err) {
      toast(`Couldn't load calendar: ${err.message}`, { tone: "error" });
    }
  }

  function shiftMonth(delta, focus) {
    month += delta;
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
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

  function select(d, { open = true } = {}) {
    selected = d;
    focusDate = d;
    grid.querySelectorAll(".tile[data-date]").forEach((t) => {
      t.setAttribute("aria-pressed", t.dataset.date === d);
      t.tabIndex = t.dataset.date === d ? 0 : -1;
    });
    history.replaceState(null, "", `#/calendar/${d}`);
    if (desktop.matches) renderDay(panel, d);
    else if (open) { renderDay(sheetBox, d); openDialog(sheet); }
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
    if (t.getMonth() !== month || t.getFullYear() !== year) {
      await shiftMonth(step > 0 ? 1 : -1, target);
    }
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

  // ---------- day details ----------
  async function renderDay(box, d) {
    box.innerHTML = `<div class="daybox"><div class="skeleton" style="height:52px"></div><div class="skeleton" style="height:44px"></div><div class="skeleton" style="height:44px"></div></div>`;
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
          <div>
            <h2>${esc(relativeDay(d))}</h2>
            <p>${esc(fmt(d, { month: "long", day: "numeric", year: "numeric" }))} · <span data-day-count></span></p>
          </div>
          ${ring()}
        </div>
        ${future ? `<p class="note">Planning ahead. You can check these off when the day comes.</p>` : ""}
        <ul class="checklist" data-list></ul>
        <form class="quick-add" data-quick>
          <label class="sr-only" for="qa-${d}">Add a task for ${esc(fmt(d, { month: "long", day: "numeric" }))}</label>
          <input class="input" id="qa-${d}" maxlength="80" autocomplete="off" placeholder="Add a task for this day…" />
          <button class="btn btn-primary" type="submit">Add</button>
        </form>
        <button class="btn btn-ghost" type="button" data-new-habit style="justify-self:start">${icon("repeat", "icon-sm")} New daily habit</button>
      </div>`;

    const list = box.querySelector("[data-list]");
    const ringSvg = box.querySelector(".ring");

    const sync = () => {
      const done = data.tasks.filter((t) => t.completed).length;
      const total = data.tasks.length;
      box.querySelector("[data-day-count]").textContent = total ? `${done}/${total} done` : "no tasks";
      setRing(ringSvg, done, total);
      summary[d] = { date: d, done, total };
      updateTile(d);
    };

    const rowHTML = (t, i) => `
      <li class="check-row" style="--i:${i}" data-id="${t.id}">
        <label>
          <input type="checkbox" ${t.completed ? "checked" : ""} ${future ? "disabled" : ""} />
          <span class="check-title">${esc(t.title)}</span>
        </label>
        <span class="chip">${t.is_permanent ? `${icon("repeat")} Daily` : "Once"}</span>
        ${t.is_permanent ? "" : `<button class="icon-btn" type="button" data-delete aria-label="Delete ${esc(t.title)}">${icon("trash", "icon-sm")}</button>`}
      </li>`;

    const renderList = () => {
      list.innerHTML = data.tasks.length
        ? data.tasks.map(rowHTML).join("")
        : `<li class="note">Nothing here yet. Add a one-off task below.</li>`;
    };
    renderList();
    sync();

    list.addEventListener("change", async (e) => {
      const row = e.target.closest(".check-row");
      const t = data.tasks.find((x) => x.id === Number(row.dataset.id));
      const next = e.target.checked;
      t.completed = next;
      sync();
      try {
        await api.complete(d, t.id, next);
        changed({ kind: "completion", source: "calendar" });
      } catch (err) {
        t.completed = !next;
        e.target.checked = !next;
        sync();
        toast(`Couldn't save: ${err.message}`, { tone: "error" });
      }
    });

    list.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-delete]");
      if (!btn) return;
      const row = btn.closest(".check-row");
      const idx = data.tasks.findIndex((x) => x.id === Number(row.dataset.id));
      const [t] = data.tasks.splice(idx, 1);
      row.classList.add("is-leaving");
      const hide = () => { row.hidden = true; };
      if (reducedMotion()) hide(); else row.addEventListener("animationend", hide, { once: true });
      sync();
      withUndo("Task deleted", {
        commit: async () => {
          try {
            await api.remove(t.id);
            changed({ kind: "removed", source: "calendar" });
          } catch (err) {
            toast(`Couldn't delete: ${err.message}`, { tone: "error" });
          }
        },
        undo: () => {
          data.tasks.splice(idx, 0, t);
          renderList();
          sync();
        },
      });
    });

    box.querySelector("[data-quick]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      input.disabled = true;
      try {
        const t = await api.create({ title: value, is_permanent: false, specific_date: d });
        data.tasks.push(t);
        renderList();
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

    box.querySelector("[data-new-habit]").addEventListener("click", () => openAdd({ kind: "daily" }));
  }

  const onBreakpoint = () => {
    if (desktop.matches) { closeDialog(sheet); renderDay(panel, selected); }
  };
  desktop.addEventListener("change", onBreakpoint);

  loadMonth().then(() => {
    if (desktop.matches) renderDay(panel, selected);
    else if (isValidISO(arg)) select(arg); // deep link opens the sheet on mobile
  });

  return {
    refresh(detail) {
      if (detail.source === "calendar") return;
      loadMonth(0, true);
      if (desktop.matches) renderDay(panel, selected);
      else if (sheet.open) renderDay(sheetBox, selected);
    },
    unmount() {
      alive = false;
      desktop.removeEventListener("change", onBreakpoint);
      sheet.remove();
    },
  };
}
