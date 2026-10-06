import { api, changed } from "./api.js";
import { openAdd } from "./add.js";
import {
  closeDialog, esc, fmt, haptic, icon, makeWindow, openDialog, particles,
  questKind, replayClass, statusText, todayISO, toast, winHead, wireClose,
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

export const checkHTML = (t, disabled) => `
  <button class="box-check" type="button" role="checkbox" aria-checked="${t.completed}" data-check="${t.id}"
          aria-label="${esc(t.title)} complete" ${disabled ? "disabled" : ""}><i>${icon("check")}</i></button>`;

export const goalRowHTML = (t, i, { future = false } = {}) => `
  <li class="goal-row${t.completed ? " is-done" : ""}" data-id="${t.id}" style="--i:${i}">
    <button class="goal-name" type="button" data-open="${t.id}" aria-label="${esc(t.title)}, ${questKind(t)}. Open quest">${esc(t.title)}</button>
    <span class="status-text" aria-hidden="true">${statusText(t)}</span>
    ${checkHTML(t, future)}
  </li>`;

export function paintGoalRow(row, t) {
  row.classList.toggle("is-done", t.completed);
  const status = row.querySelector(".status-text");
  status.textContent = statusText(t);
  replayClass(status, "bump");
  row.querySelector("[data-check]").setAttribute("aria-checked", t.completed);
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
  dlg.querySelector("[data-new]")?.addEventListener("click", () => { closeDialog(dlg); openAdd({ date }); });

  dlg.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-check]");
    if (!btn) return;
    const t = tasks.find((x) => x.id === Number(btn.dataset.check));
    const row = btn.closest(".goal-row");
    const saving = toggleDone(t, date, { source, el: row });
    paintGoalRow(row, t);
    if (!(await saving) && dlg.open) paintGoalRow(row, t);
  });

  openDialog(dlg);
  return dlg;
}

// ---------- Single quest ----------
export function openQuest(task, date, { source, onRemove, onClose, onToggle } = {}) {
  const future = date > todayISO();
  const dlg = makeWindow(task.title);
  dlg.addEventListener("close", () => onClose?.());

  dlg.innerHTML = `
    <div class="win-body sys">
      ${winHead("Quest")}
      <p class="win-lead">[${esc(questKind(task))}: <strong>${esc(task.title)}</strong>]</p>
      <p class="goal-title" style="font-size:24px;text-decoration:none" data-status></p>
      ${future ? `<p class="note">This quest unlocks on its day. You can plan it now.</p>` : ""}
      <div class="win-actions">
        <button class="btn btn-primary btn-block" type="button" data-toggle ${future ? "disabled" : ""}></button>
      </div>
      <div class="win-foot">
        <button class="btn btn-text btn-danger" type="button" data-remove>${task.is_permanent ? "Abandon daily quest" : "Delete quest"}</button>
      </div>
    </div>`;
  wireClose(dlg);

  const statusEl = dlg.querySelector("[data-status]");
  const toggleBtn = dlg.querySelector("[data-toggle]");
  const render = () => {
    statusEl.textContent = statusText(task);
    statusEl.style.color = task.completed ? "var(--blue)" : "var(--text-2)";
    toggleBtn.innerHTML = task.completed ? `${icon("check")} Completed, tap to undo` : "Complete quest";
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
