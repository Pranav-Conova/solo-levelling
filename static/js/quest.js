import { api, changed } from "./api.js";
import { openAdd } from "./add.js";
import {
  closeDialog, esc, everyText, fmt, gapOf, haptic, icon, makeWindow, openDialog, particles, plural,
  questKind, relativeDay, replayClass, todayISO, toast, winHead, wireClose,
} from "./util.js";

/**
 * Optimistically flip a quest between complete and incomplete, then save. Mutates `task`.
 * Returns true when saved; on failure the task is restored and a toast shown.
 */
export async function toggleDone(task, date, { source, el } = {}) {
  const next = !task.completed;
  task.completed = next;
  if (next) { haptic(14); particles(el); }
  try {
    await api.complete(date, task.id, next);
    if (next) toast(`Quest complete: ${task.title}`);
    changed({ kind: "completion", source });
    return true;
  } catch (err) {
    task.completed = !next;
    toast(`Couldn't save: ${err.message}`, { tone: "error" });
    return false;
  }
}

// ---------- quest row: the whole row ticks the quest; ⋮ opens its details ----------
// `info` is the Daily Quest's habit record ({ streak, ... }) when known
function metaHTML(t, info) {
  // done state is shown by the filled box, the strike line and dimming: no extra text, so rows never change height
  if (!t.is_permanent) return `<span class="goal-kind">Personal</span><span>one day only</span>`;
  const gap = gapOf(t);
  const tag = `<span class="goal-kind">${gap > 1 ? `Every ${gap} days` : "Daily"}</span>`;
  // without habit data (e.g. a past day in the Quest Log) don't guess at the streak
  if (!info) return `${tag}<span>${gap > 1 ? "repeating" : "every day"}</span>`;
  // for gap quests the streak counts scheduled runs, so off days never break it
  const streak = gap > 1 ? `${info.streak} in a row` : `${info.streak}-day streak`;
  return `${tag}${info.streak
    ? `<span class="goal-streak">${icon("flame")}${streak}</span>`
    : `<span>start a streak today</span>`}`;
}

export const goalRowHTML = (t, i, { future = false, info } = {}) => `
  <li class="goal-row${t.completed ? " is-done" : ""}" data-id="${t.id}" style="--i:${i}">
    <button class="goal-toggle" type="button" role="checkbox" aria-checked="${t.completed}" data-check="${t.id}"
            aria-label="${esc(t.title)}" aria-describedby="goal-meta-${t.id}" ${future ? "disabled" : ""}>
      <span class="goal-text">
        <span class="goal-name">${esc(t.title)}</span>
        <span class="goal-meta" id="goal-meta-${t.id}">${metaHTML(t, info)}</span>
      </span>
      <span class="goal-box" aria-hidden="true"><i>${icon("check")}</i></span>
    </button>
    <button class="icon-btn goal-more" type="button" data-open="${t.id}" aria-label="Details for ${esc(t.title)}">${icon("more-v")}</button>
  </li>`;

export function paintGoalRow(row, t, info) {
  const wasDone = row.classList.contains("is-done");
  row.classList.toggle("is-done", t.completed);
  row.querySelector("[data-check]").setAttribute("aria-checked", t.completed);
  row.querySelector(".goal-meta").innerHTML = metaHTML(t, info);
  if (t.completed && !wasDone) replayClass(row, "just-done");
}

// ---------- progress meter: one segment per quest, like a HUD gauge ----------
export const progressHTML = () => `
  <div class="quest-progress" role="progressbar" aria-label="Quests cleared" aria-valuemin="0" data-progress>
    <div class="qp-head"><span class="caps">Progress</span><span class="qp-count" data-count></span></div>
    <div class="qp-track" data-track></div>
  </div>`;

export function paintProgress(root, tasks) {
  const el = root.querySelector("[data-progress]");
  if (!el) return;
  el.hidden = !tasks.length;
  const done = tasks.filter((t) => t.completed).length;
  el.setAttribute("aria-valuemax", tasks.length);
  el.setAttribute("aria-valuenow", done);
  el.setAttribute("aria-valuetext", `${done} of ${tasks.length} cleared`);
  el.querySelector("[data-count]").innerHTML = `<b>${done}</b> / ${tasks.length} cleared`;
  el.classList.toggle("is-complete", tasks.length > 0 && done === tasks.length);

  const track = el.querySelector("[data-track]");
  const segmented = tasks.length <= 12; // past that, segments get too thin to read
  track.classList.toggle("is-bar", !segmented);
  if (!segmented) {
    track.innerHTML = `<i class="qp-fill" style="--p:${done / tasks.length}"></i>`;
    return;
  }
  // keep existing segments so newly lit ones can animate
  while (track.children.length < tasks.length) track.appendChild(document.createElement("i"));
  while (track.children.length > tasks.length) track.lastChild.remove();
  [...track.children].forEach((seg, i) => {
    const on = i < done;
    if (on && !seg.classList.contains("on")) replayClass(seg, "lit");
    seg.classList.toggle("on", on);
  });
}

// ---------- Quest info for any day (the Quest Log opens this) ----------
export function openQuestInfo(tasks, date, { source, onClose } = {}) {
  const future = date > todayISO();
  const isToday = date === todayISO();
  const dlg = makeWindow("Quest info");
  dlg.addEventListener("close", () => onClose?.());

  dlg.innerHTML = `
    <div class="win-body sys">
      ${winHead("Quest Info")}
      ${tasks.length ? `
        <p class="win-lead">[Daily Quest ${isToday ? "has arrived" : `of ${esc(fmt(date, { month: "long", day: "numeric" }))}`}.]</p>
        ${progressHTML()}
        <h3 class="goal-title">Goal</h3>
        <ul class="goal-list">${tasks.map((t, i) => goalRowHTML(t, i, { future })).join("")}</ul>
        <p class="win-warn">${future
          ? "These quests unlock when the day arrives."
          : "<b>WARNING:</b> Failure to complete the daily quest will result in an appropriate penalty."}</p>`
      : `
        <p class="win-lead">[No quests have arrived.]</p>
        <button class="btn btn-primary btn-block" type="button" data-new>Create a quest</button>`}
    </div>`;
  wireClose(dlg);
  paintProgress(dlg, tasks);
  dlg.querySelector("[data-new]")?.addEventListener("click", () => { closeDialog(dlg); openAdd({ date }); });

  dlg.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-check]");
    if (!btn) return;
    const t = tasks.find((x) => x.id === Number(btn.dataset.check));
    const row = btn.closest(".goal-row");
    const saving = toggleDone(t, date, { source, el: row });
    paintGoalRow(row, t);
    paintProgress(dlg, tasks);
    if (!(await saving) && dlg.open) { paintGoalRow(row, t); paintProgress(dlg, tasks); }
  });

  openDialog(dlg);
  return dlg;
}

// ---------- Single quest details ----------
export function openQuest(task, date, { source, onRemove, onClose, onToggle, info } = {}) {
  const future = date > todayISO();
  const dlg = makeWindow(task.title);
  dlg.addEventListener("close", () => onClose?.());

  const gap = gapOf(task);
  const facts = [
    ["Type", task.is_permanent ? "Repeating" : "Personal"],
    task.is_permanent ? ["Repeats", everyText(gap)] : ["Day", fmt(date, { weekday: "short", month: "short", day: "numeric" })],
    ...(task.is_permanent ? [["Since", fmt(task.start_date, { month: "short", day: "numeric", year: "numeric" })]] : []),
    ...(info ? [
      ["Next due", info.next_due === todayISO() ? "Today" : relativeDay(info.next_due) === "Tomorrow" ? "Tomorrow" : fmt(info.next_due, { weekday: "short", month: "short", day: "numeric" })],
      ["Streak", gap > 1 ? `${info.streak} in a row` : plural(info.streak, "day")],
      ["Cleared", plural(info.total_done, "time")],
    ] : []),
  ];

  dlg.innerHTML = `
    <div class="win-body sys">
      ${winHead("Quest")}
      <p class="quest-title">${esc(task.title)}</p>
      <dl class="quest-facts">
        ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}
      </dl>
      <p class="quest-status" data-status></p>
      ${future ? `<p class="note">This quest unlocks on its day. You can plan it now.</p>` : ""}
      <div class="win-actions">
        <button class="btn btn-primary btn-block" type="button" data-toggle ${future ? "disabled" : ""}></button>
      </div>
      <div class="win-foot">
        <button class="btn btn-text btn-danger" type="button" data-remove>${icon("trash", "icon-sm")} ${task.is_permanent ? "Abandon daily quest" : "Delete quest"}</button>
      </div>
    </div>`;
  wireClose(dlg);

  const statusEl = dlg.querySelector("[data-status]");
  const toggleBtn = dlg.querySelector("[data-toggle]");
  const render = () => {
    statusEl.innerHTML = task.completed ? `${icon("check")} Cleared${date === todayISO() ? " today" : ""}` : "Not cleared yet";
    statusEl.classList.toggle("is-done", task.completed);
    toggleBtn.innerHTML = task.completed ? "Mark as not cleared" : `${icon("check")} Clear quest`;
    toggleBtn.className = `btn btn-block ${task.completed ? "btn-sys" : "btn-primary"}`;
  };

  toggleBtn.addEventListener("click", async () => {
    const saving = toggleDone(task, date, { source, el: statusEl });
    render();
    replayClass(statusEl, "bump");
    onToggle?.(task);
    if (!(await saving) && dlg.open) { render(); onToggle?.(task); }
  });
  dlg.querySelector("[data-remove]").addEventListener("click", () => {
    closeDialog(dlg);
    onRemove?.(task);
  });

  render();
  openDialog(dlg);
  toggleBtn.focus();
  return dlg;
}
