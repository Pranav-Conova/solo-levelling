import { api, changed } from "./api.js";
import { closeDialog, fmt, icon, makeDialog, openDialog, relativeDay, toast, todayISO } from "./util.js";

const MAX = 80;
let dlg;

function build() {
  dlg = makeDialog("sheet");
  dlg.setAttribute("aria-labelledby", "add-title");
  dlg.innerHTML = `
    <form class="sheet-body" novalidate>
      <div class="grabber" aria-hidden="true"></div>
      <div class="sheet-head">
        <button class="icon-btn" type="button" tabindex="-1" aria-hidden="true">${icon("x")}</button>
        <h2 id="add-title">New task</h2>
        <button class="icon-btn" type="button" data-close aria-label="Close">${icon("x")}</button>
      </div>

      <div class="field">
        <label for="add-name">What do you want to do?</label>
        <input class="input" id="add-name" name="title" autocomplete="off" maxlength="${MAX + 20}"
               placeholder="e.g. Read 20 pages" aria-describedby="add-count" />
        <div class="field-row"><span></span><span id="add-count" aria-live="polite">0/${MAX}</span></div>
      </div>

      <fieldset class="field" style="border:0;padding:0;margin:0">
        <legend class="label" style="padding:0;margin-bottom:6px">How often?</legend>
        <div class="segmented" data-value="daily">
          <span class="seg-ink" aria-hidden="true"></span>
          <input type="radio" name="kind" id="kind-daily" value="daily" checked />
          <label for="kind-daily">${icon("repeat")} Every day</label>
          <input type="radio" name="kind" id="kind-once" value="once" />
          <label for="kind-once">${icon("calendar-check")} One day</label>
        </div>
      </fieldset>

      <div class="collapse is-collapsed" data-date-wrap>
        <div>
          <div class="field">
            <label for="add-date">Which day?</label>
            <input class="input" type="date" id="add-date" name="date" />
          </div>
        </div>
      </div>

      <p class="helper" data-helper></p>

      <button class="btn btn-primary btn-block" type="submit" disabled>Add task</button>
    </form>`;

  const form = dlg.querySelector("form");
  const name = form.elements.title;
  const seg = form.querySelector(".segmented");
  const dateWrap = form.querySelector("[data-date-wrap]");
  const dateInput = form.elements.date;
  const submit = form.querySelector("[type=submit]");
  const count = form.querySelector("#add-count");
  const helper = form.querySelector("[data-helper]");

  const sync = () => {
    const kind = form.elements.kind.value;
    const len = name.value.trim().length;
    seg.dataset.value = kind;
    dateWrap.classList.toggle("is-collapsed", kind !== "once");
    dateInput.tabIndex = kind === "once" ? 0 : -1;
    count.textContent = `${len}/${MAX}`;
    count.classList.toggle("over", len > MAX);
    submit.disabled = len === 0 || len > MAX || (kind === "once" && !dateInput.value);
    helper.textContent =
      kind === "daily"
        ? "Shows up every day from today. Stop it any time from your profile; past days keep their history."
        : dateInput.value
          ? `Only shows on ${fmt(dateInput.value, { weekday: "long", month: "long", day: "numeric" })}.`
          : "Pick the day this task belongs to.";
  };

  form.addEventListener("input", sync);
  dlg.querySelector("[data-close]").addEventListener("click", () => closeDialog(dlg));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    const title = name.value.trim();
    const once = form.elements.kind.value === "once";
    const date = dateInput.value;
    submit.disabled = true;
    submit.textContent = "Adding…";
    try {
      await api.create({
        title,
        is_permanent: !once,
        specific_date: once ? date : null,
        start_date: todayISO(),
      });
      closeDialog(dlg);
      toast(once ? `Added for ${dayLabel(date)}` : `"${title}" is now a daily habit`);
      changed({ kind: "created", date: once ? date : todayISO() });
    } catch (err) {
      toast(`Couldn't add task: ${err.message}`, { tone: "error" });
      submit.disabled = false;
    } finally {
      submit.textContent = "Add task";
    }
  });

  dlg._sync = sync;
}

export function openAdd({ kind = "daily", date = todayISO() } = {}) {
  if (!dlg) build();
  const form = dlg.querySelector("form");
  form.reset();
  form.elements.kind.value = kind;
  form.elements.date.value = date;
  dlg._sync();
  openDialog(dlg);
  form.elements.title.focus();
}

function dayLabel(date) {
  const rel = relativeDay(date);
  return ["Today", "Yesterday", "Tomorrow"].includes(rel) ? rel.toLowerCase() : fmt(date, { weekday: "short", month: "short", day: "numeric" });
}
