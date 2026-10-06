import { ding, esc, icon, pref, reducedMotion, setPref, typewrite } from "../util.js";

export const title = "Awakening";

// The first-run sequence, told the way the System speaks to Jinwoo in the anime
const STEPS = {
  offer: {
    text: "You have acquired the qualifications to be a Player. Will you accept?",
    actions: [["Accept", "accepted"], ["Decline", "decline"]],
  },
  decline: {
    penalty: true,
    text: "If you choose not to accept, your heart will stop in 0.02 seconds. Will you accept?",
    actions: [["Accept", "accepted"]],
  },
  accepted: { text: "Congratulations on becoming a Player.", auto: "name" },
  name: { text: "Please enter your name, Player.", form: true },
  quest: {
    text: "[Daily Quest has arrived.]",
    actions: [["Open Quest Info", "done"]],
  },
};

export function mount(el) {
  document.body.classList.add("is-welcome");
  let alive = true;
  let timer;
  let current = 0; // bumps on every step so an interrupted step stops where it is

  el.innerHTML = `
    <div class="awaken">
      <button class="btn btn-text skip-intro" type="button" data-skip>Skip intro</button>
      <div data-stage></div>
    </div>`;
  const stage = el.querySelector("[data-stage]");
  const skipBtn = el.querySelector("[data-skip]");
  skipBtn.addEventListener("click", () => { clearTimeout(timer); show("name"); });

  async function show(key) {
    if (!alive) return;
    const mine = ++current;
    clearTimeout(timer);
    if (key === "done") { setPref("awakened", "1"); location.hash = "#/"; return; }
    const step = STEPS[key];
    skipBtn.hidden = key === "name" || key === "quest"; // the name step can't be skipped: Status needs it
    stage.innerHTML = `
      <section class="sys sys-window step-enter${step.penalty ? " penalty" : ""}" aria-live="polite">
        <div class="win-head">
          <span class="box icon-box" aria-hidden="true">${icon("alert")}</span>
          <h1 class="box">${step.penalty ? "Warning" : "Notification"}</h1>
        </div>
        <p class="win-lead" data-text></p>
        <div data-after hidden>
          ${step.form ? `
            <form data-name style="display:grid;gap:12px">
              <div class="field">
                <label for="hunter-name">Name</label>
                <input class="input" id="hunter-name" maxlength="30" autocomplete="nickname" value="${esc(pref("name", ""))}" required />
              </div>
              <button class="btn btn-primary btn-block" type="submit">Confirm</button>
            </form>` : ""}
          ${step.actions ? `
            <div class="awaken-actions${step.actions.length === 1 ? " single" : ""}">
              ${step.actions.map(([label, next], i) => `<button class="btn ${i ? "btn-sys" : "btn-primary"}" type="button" data-next="${next}">${label}</button>`).join("")}
            </div>` : ""}
        </div>
      </section>`;
    ding(step.penalty ? "penalty" : "notice");

    // let the window unfold before the System starts "speaking"
    await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 500));
    if (mine !== current) return;
    await typewrite(stage.querySelector("[data-text]"), step.text);
    if (!alive || mine !== current) return;

    if (step.auto) { timer = setTimeout(() => show(step.auto), reducedMotion() ? 600 : 1200); return; }
    const after = stage.querySelector("[data-after]");
    after.hidden = false;
    after.classList.add("fade-late");
    (after.querySelector("input") || after.querySelector("button")).focus();
  }

  stage.addEventListener("click", (e) => {
    const next = e.target.closest("[data-next]");
    if (next) { show(next.dataset.next); return; }
    // tapping the window while the System is "speaking" reveals the whole line
    if (!e.target.closest("button, input")) stage.querySelector("[data-text]")?._finish?.();
  });
  stage.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = stage.querySelector("#hunter-name").value.trim();
    if (!name) { stage.querySelector("#hunter-name").focus(); return; }
    setPref("name", name);
    document.dispatchEvent(new CustomEvent("tracker:changed", { detail: { kind: "name" } }));
    STEPS.quest.text = `Welcome, Player ${name}. [Daily Quest has arrived.]`;
    show("quest");
  });

  // a moment of darkness first, like the anime
  timer = setTimeout(() => show("offer"), reducedMotion() ? 0 : 700);

  return {
    unmount() {
      alive = false;
      clearTimeout(timer);
      document.body.classList.remove("is-welcome");
    },
  };
}
