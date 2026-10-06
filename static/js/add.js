import { api, changed } from "./api.js";
import { addDays, closeDialog, fmt, icon, makeWindow, openDialog, relativeDay, toast, todayISO, winHead, wireClose } from "./util.js";

const MAX = 80;
const QUICK_GAPS = [1, 2, 3, 5, 7];
let dlg;

function build() {
  dlg = makeWindow("New quest", { persistent: true });
  dlg.innerHTML = `
    <form class="win-body sys" novalidate>
      ${winHead("New Quest", "plus-small")}

      <div class="field">
        <label for="add-name">Quest</label>
        <input class="input" id="add-name" name="title" autocomplete="off" maxlength="${MAX + 20}"
               placeholder="e.g. Study for 1 hour" aria-describedby="add-count" />
        <div class="field-row"><span></span><span id="add-count">0/${MAX}</span></div>
      </div>

      <fieldset class="field" style="border:0;padding:0;margin:0">
        <legend class="label" style="padding:0;margin-bottom:6px">Type</legend>
        <div class="segmented" data-value="daily">
          <span class="seg-ink" aria-hidden="true"></span>
          <input type="radio" name="kind" id="kind-daily" value="daily" checked />
          <label for="kind-daily">${icon("repeat")} Repeating</label>
          <input type="radio" name="kind" id="kind-once" value="once" />
          <label for="kind-once">${icon("calendar-check")} One day</label>
        </div>
      </fieldset>

      <div class="collapse" data-every-wrap>
        <div>
          <fieldset class="field" style="border:0;padding:0;margin:0">
            <legend class="label" style="padding:0;margin-bottom:6px">Repeat every</legend>
            <div class="gap-picks" data-picks>
              ${QUICK_GAPS.map((n) => `<button class="btn btn-sys btn-sm gap-pick" type="button" data-gap="${n}" aria-pressed="false">${n === 1 ? "Daily" : `${n} days`}</button>`).join("")}
            </div>
            <div class="gap-custom">
              <label for="add-every">Every</label>
              <input class="input" id="add-every" name="every" type="number" inputmode="numeric" min="1" max="365" step="1" value="1"
                     aria-describedby="add-every-err" />
              <span aria-hidden="true">days</span>
            </div>
            <p class="field-error" id="add-every-err" hidden></p>
          </fieldset>
        </div>
      </div>

      <div class="collapse is-collapsed" data-date-wrap>
        <div>
          <div class="field">
            <label for="add-date">Which day?</label>
            <input class="input" type="date" id="add-date" name="date" />
          </div>
        </div>
      </div>

      <p class="helper" data-helper aria-live="polite"></p>

      <button class="btn btn-primary btn-block" type="submit" disabled>Accept quest</button>
    </form>`;
  wireClose(dlg);

  const form = dlg.querySelector("form");
  const { title: name, date: dateInput, every } = form.elements;
  const seg = form.querySelector(".segmented");
  const everyWrap = form.querySelector("[data-every-wrap]");
  const dateWrap = form.querySelector("[data-date-wrap]");
  const submit = form.querySelector("[type=submit]");
  const count = form.querySelector("#add-count");
  const helper = form.querySelector("[data-helper]");
  const everyErr = form.querySelector("#add-every-err");

  // a whole number of days from 1 to 365, or null
  const gap = () => {
    const n = Number(every.value);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
  };

  const short = (iso) => (["Today", "Tomorrow"].includes(relativeDay(iso)) ? relativeDay(iso) : fmt(iso, { weekday: "short", month: "short", day: "numeric" }));

  const sync = () => {
    const kind = form.elements.kind.value;
    const repeating = kind === "daily";
    const len = name.value.trim().length;
    const n = gap();
    seg.dataset.value = kind;
    everyWrap.classList.toggle("is-collapsed", !repeating);
    dateWrap.classList.toggle("is-collapsed", repeating);
    form.querySelectorAll("[data-every-wrap] button, [data-every-wrap] input").forEach((el) => { el.tabIndex = repeating ? 0 : -1; });
    dateInput.tabIndex = repeating ? -1 : 0;
    count.textContent = `${len}/${MAX}`;
    count.classList.toggle("over", len > MAX);
    form.querySelectorAll("[data-gap]").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.gap) === n));

    const badGap = repeating && n === null;
    everyErr.hidden = !badGap;
    everyErr.textContent = badGap ? "Use a whole number of days from 1 to 365." : "";
    every.setAttribute("aria-invalid", badGap);

    submit.disabled = len === 0 || len > MAX || badGap || (!repeating && !dateInput.value);
    if (repeating) {
      // show exactly when it will arrive, so the gap is easy to sanity-check
      const today = todayISO();
      helper.textContent = n === null ? "" : n === 1
        ? "Arrives every day from today. Abandon it any time from Status; past days keep their record."
        : `Arrives every ${n} days: ${[0, n, 2 * n].map((k) => short(addDays(today, k))).join(", ")}…`;
    } else {
      helper.textContent = dateInput.value
        ? `A personal quest for ${fmt(dateInput.value, { weekday: "long", month: "long", day: "numeric" })} only.`
        : "Pick the day this quest belongs to.";
    }
  };

  form.addEventListener("input", sync);
  form.querySelector("[data-picks]").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-gap]");
    if (!pick) return;
    every.value = pick.dataset.gap;
    sync();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    const title = name.value.trim();
    const once = form.elements.kind.value === "once";
    const date = dateInput.value;
    const n = gap() ?? 1;
    submit.disabled = true;
    submit.textContent = "Accepting…";
    try {
      await api.create({
        title,
        is_permanent: !once,
        specific_date: once ? date : null,
        start_date: todayISO(),
        interval_days: once ? 1 : n,
      });
      closeDialog(dlg);
      toast(once
        ? `Quest added for ${dayLabel(date)}: ${title}`
        : n === 1 ? `New Daily Quest: ${title}` : `New quest every ${n} days: ${title}`);
      changed({ kind: "created", date: once ? date : todayISO() });
    } catch (err) {
      toast(`Couldn't add quest: ${err.message}`, { tone: "error" });
      submit.disabled = false;
    } finally {
      submit.textContent = "Accept quest";
    }
  });

  dlg._sync = sync;
}

function dayLabel(date) {
  const rel = relativeDay(date);
  return ["Today", "Yesterday", "Tomorrow"].includes(rel) ? rel.toLowerCase() : fmt(date, { weekday: "short", month: "short", day: "numeric" });
}

export function openAdd({ kind, date = todayISO() } = {}) {
  if (!dlg) build();
  const form = dlg.querySelector("form");
  form.reset();
  form.elements.kind.value = kind || (date === todayISO() ? "daily" : "once");
  form.elements.date.value = date;
  form.elements.every.value = 1;
  dlg._sync();
  openDialog(dlg);
  form.elements.title.focus();
}
