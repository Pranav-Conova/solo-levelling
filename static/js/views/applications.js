import { api } from "../api.js";
import {
  closeDialog, esc, fmt, haptic, icon, makeWindow, openDialog, particles, reducedMotion,
  replayClass, toast, todayISO, winHead, wireClose, withUndo,
} from "../util.js";

export const title = "Applications";

const STATUSES = [
  ["applied", "Applied"],
  ["interviewing", "Interviewing"],
  ["offer", "Offer"],
  ["rejected", "Rejected"],
  ["withdrawn", "Withdrawn"],
];
const LABEL = Object.fromEntries(STATUSES);
const CHANNELS = ["LinkedIn", "Company website", "Referral", "Naukri", "Indeed", "Wellfound", "Recruiter", "Email", "Campus placement", "Job fair"];

export function mount(el, arg) {
  let apps = [];
  let filter = LABEL[arg] ? arg : "all";
  let alive = true;

  el.innerHTML = `
    <div class="page">
      <div class="page-title"><div class="win-head">
        <span class="box icon-box" aria-hidden="true">${icon("briefcase")}</span><h1 class="box">Applications</h1>
      </div></div>
      <section class="sys sys-window apps" aria-label="Job applications">
        <div class="apps-top">
          <p class="win-lead" style="text-align:left">[Every role you apply for, in one place.]</p>
          <button class="btn btn-primary" type="button" data-new>${icon("plus-small", "icon-sm")} Add application</button>
        </div>
        <div class="apps-filters" role="group" aria-label="Filter by status" data-filters></div>
        <ul class="apps-list" data-list aria-live="polite">
          ${'<li class="skeleton" style="height:84px"></li>'.repeat(3)}
        </ul>
      </section>
    </div>
    <datalist id="via-options">${CHANNELS.map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>`;

  const listEl = el.querySelector("[data-list]");
  const filtersEl = el.querySelector("[data-filters]");

  // ---------- rendering ----------
  function renderFilters() {
    const count = (s) => apps.filter((a) => s === "all" || a.status === s).length;
    filtersEl.innerHTML = [["all", "All"], ...STATUSES].map(([value, label]) => `
      <button class="btn btn-sys btn-sm apps-filter s-${value}" type="button" data-filter="${value}" aria-pressed="${filter === value}">
        ${label}<span class="apps-count">${count(value)}</span>
      </button>`).join("");
  }

  const statusSelect = (a) => `
    <span class="status-pick s-${a.status}">
      <label class="sr-only" for="app-st-${a.id}">Status for ${esc(a.company)}</label>
      <select id="app-st-${a.id}" data-status>
        ${STATUSES.map(([v, l]) => `<option value="${v}"${v === a.status ? " selected" : ""}>${l}</option>`).join("")}
      </select>
      ${icon("chevron-right", "status-caret")}
    </span>`;

  const rowHTML = (a, i) => `
    <li class="app-row" data-id="${a.id}" style="--i:${i}">
      <div class="app-main">
        <strong class="app-company">${esc(a.company)}</strong>
        <span class="app-role">${esc(a.role)}</span>
        <span class="app-meta">${a.applied_via ? `via ${esc(a.applied_via)} · ` : ""}Applied ${esc(dateLabel(a.applied_on))}</span>
      </div>
      <div class="app-side">
        ${statusSelect(a)}
        <button class="icon-btn" type="button" data-edit aria-label="Edit ${esc(a.company)} application">${icon("more-v")}</button>
      </div>
    </li>`;

  function render(quiet = false) {
    renderFilters();
    const shown = apps.filter((a) => filter === "all" || a.status === filter);
    if (!apps.length) {
      listEl.innerHTML = `
        <li class="empty">
          <h3>No applications yet</h3>
          <p>Log each role you apply for: the company, the role, how you applied and where it stands.</p>
          <button class="btn btn-primary" type="button" data-new>Add your first application</button>
        </li>`;
      return;
    }
    listEl.innerHTML = shown.length
      ? shown.map(rowHTML).join("")
      : `<li class="empty-line">No applications marked “${esc(LABEL[filter])}”.</li>`;
    if (quiet) listEl.querySelectorAll(".app-row").forEach((r) => r.classList.add("static"));
  }

  // ---------- interactions ----------
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-new]")) { openEditor(null); return; }
    const f = e.target.closest("[data-filter]");
    if (f) {
      filter = f.dataset.filter;
      history.replaceState(null, "", filter === "all" ? "#/jobs" : `#/jobs/${filter}`);
      render(true);
      return;
    }
    const edit = e.target.closest("[data-edit]");
    if (edit) openEditor(apps.find((a) => a.id === Number(edit.closest(".app-row").dataset.id)));
  });

  // change status straight from the list
  el.addEventListener("change", async (e) => {
    const select = e.target.closest("[data-status]");
    if (!select) return;
    const row = select.closest(".app-row");
    const a = apps.find((x) => x.id === Number(row.dataset.id));
    const before = a.status;
    a.status = select.value;
    const pick = select.closest(".status-pick");
    pick.className = `status-pick s-${a.status}`;
    replayClass(pick, "bump");
    renderFilters();
    if (a.status === "offer") { haptic(20); particles(row, 24); }
    try {
      await api.updateApplication(a.id, { status: a.status });
      toast(a.status === "offer" ? `Offer received from ${a.company}!` : `${a.company}: ${LABEL[a.status]}`);
      if (filter !== "all" && a.status !== filter) setTimeout(() => alive && render(true), 600);
    } catch (err) {
      a.status = before;
      select.value = before;
      pick.className = `status-pick s-${before}`;
      renderFilters();
      toast(`Couldn't update status: ${err.message}`, { tone: "error" });
    }
  });

  function remove(a) {
    const idx = apps.indexOf(a);
    const row = listEl.querySelector(`.app-row[data-id="${a.id}"]`);
    row?.classList.add("is-leaving");
    const drop = () => { apps.splice(apps.indexOf(a), 1); render(true); };
    if (reducedMotion() || !row) drop(); else setTimeout(drop, 260);
    withUndo(`Application deleted: ${a.company}`, {
      commit: async () => {
        try {
          await api.deleteApplication(a.id);
        } catch (err) {
          toast(`Couldn't delete: ${err.message}`, { tone: "error" });
          load();
        }
      },
      undo: () => { if (!apps.includes(a)) apps.splice(idx, 0, a); render(true); },
    });
  }

  // ---------- add / edit window ----------
  function openEditor(existing) {
    const a = existing || { company: "", role: "", status: "applied", applied_via: "", applied_on: todayISO() };
    const dlg = makeWindow(existing ? "Edit application" : "New application");
    dlg.innerHTML = `
      <form class="win-body sys auth-form" method="post" novalidate>
        ${winHead(existing ? "Application" : "New Application", "briefcase")}
        <div class="field">
          <label for="app-company">Company name</label>
          <input class="input" id="app-company" name="company" maxlength="80" autocomplete="organization" required
                 value="${esc(a.company)}" aria-describedby="app-company-err" />
          <p class="field-error" id="app-company-err" hidden></p>
        </div>
        <div class="field">
          <label for="app-role">Role</label>
          <input class="input" id="app-role" name="role" maxlength="80" autocomplete="organization-title" required
                 value="${esc(a.role)}" placeholder="e.g. Backend Engineer" aria-describedby="app-role-err" />
          <p class="field-error" id="app-role-err" hidden></p>
        </div>
        <div class="field">
          <label for="app-status">Status</label>
          <select class="input" id="app-status" name="status">
            ${STATUSES.map(([v, l]) => `<option value="${v}"${v === a.status ? " selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="app-via">How did you apply?</label>
          <input class="input" id="app-via" name="applied_via" maxlength="60" list="via-options" autocomplete="off"
                 value="${esc(a.applied_via || "")}" placeholder="e.g. LinkedIn, Referral, Company website" />
        </div>
        <div class="field">
          <label for="app-date">Applied on</label>
          <input class="input" id="app-date" name="applied_on" type="date" value="${esc(a.applied_on)}" />
        </div>
        <p class="form-error" role="alert" data-form-error hidden></p>
        <button class="btn btn-primary btn-block" type="submit">${existing ? "Save changes" : "Add application"}</button>
        ${existing ? `<div class="win-foot"><button class="btn btn-text btn-danger" type="button" data-delete>${icon("trash", "icon-sm")} Delete application</button></div>` : ""}
      </form>`;
    wireClose(dlg);
    const form = dlg.querySelector("form");
    const f = form.elements;
    const button = form.querySelector("[type=submit]");

    const setError = (input, msg) => {
      const box = form.querySelector(`#${input.id}-err`);
      box.textContent = msg || "";
      box.hidden = !msg;
      input.setAttribute("aria-invalid", msg ? "true" : "false");
    };

    // once a field has been flagged, clear the message as soon as it's fixed
    [f.company, f.role].forEach((input) => input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true" && input.value.trim()) setError(input, "");
    }));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {
        company: f.company.value.trim(),
        role: f.role.value.trim(),
        status: f.status.value,
        applied_via: f.applied_via.value.trim() || null,
        applied_on: f.applied_on.value || todayISO(),
      };
      setError(f.company, body.company ? "" : "Enter the company name.");
      setError(f.role, body.role ? "" : "Enter the role you applied for.");
      if (!body.company) { f.company.focus(); return; }
      if (!body.role) { f.role.focus(); return; }
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        const saved = existing
          ? await api.updateApplication(existing.id, body)
          : await api.createApplication(body);
        if (existing) Object.assign(existing, saved);
        else apps.unshift(saved);
        apps.sort((x, y) => y.applied_on.localeCompare(x.applied_on) || y.id - x.id);
        closeDialog(dlg);
        if (!existing && filter !== "all" && saved.status !== filter) filter = "all";
        render(true);
        listEl.querySelector(`.app-row[data-id="${saved.id}"]`)?.classList.remove("static");
        toast(existing ? `Updated: ${saved.company}` : `Application logged: ${saved.company}`);
      } catch (err) {
        const box = form.querySelector("[data-form-error]");
        box.textContent = err.message;
        box.hidden = false;
        button.disabled = false;
        button.textContent = existing ? "Save changes" : "Add application";
      }
    });

    form.querySelector("[data-delete]")?.addEventListener("click", () => { closeDialog(dlg); remove(existing); });
    openDialog(dlg);
    f.company.focus();
  }

  // ---------- data ----------
  async function load() {
    try {
      apps = await api.applications();
      if (alive) render();
    } catch (err) {
      listEl.innerHTML = `<li class="empty"><h3>The System is unreachable</h3><p>${esc(err.message)}</p>
        <button class="btn btn-sys" type="button" data-retry>Try again</button></li>`;
      listEl.querySelector("[data-retry]").addEventListener("click", load);
    }
  }
  load();

  return { unmount() { alive = false; } };
}

function dateLabel(iso) {
  const today = todayISO();
  if (iso === today) return "today";
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return fmt(iso, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
