import { api } from "../api.js";
import { credentialsHTML, wireCredentials } from "../authform.js";
import { ding, icon, typewrite } from "../util.js";

export const title = "Player Identification";

export function mount(el, _arg, { registrationOpen = true } = {}) {
  document.body.classList.add("is-welcome");
  let alive = true;

  el.innerHTML = `
    <div class="awaken">
      <section class="sys sys-window step-enter" aria-labelledby="login-title">
        <div class="win-head">
          <span class="box icon-box" aria-hidden="true">${icon("key")}</span>
          <h1 class="box" id="login-title">Identification</h1>
        </div>
        <p class="win-lead" data-text>[Player identification required.]</p>
        ${credentialsHTML("login")}
        ${registrationOpen
          ? `<p class="auth-switch">New Player? <a href="#/welcome">Awaken</a></p>`
          : `<p class="auth-switch">New Players can't join this System.</p>`}
      </section>
    </div>`;
  ding();
  typewrite(el.querySelector("[data-text]"), "[Player identification required.]");

  wireCredentials(el, "login", async (name, password) => {
    const me = await api.login(name, password);
    if (!alive) return;
    document.dispatchEvent(new CustomEvent("tracker:session", { detail: me }));
    const lead = el.querySelector("[data-text]");
    await typewrite(lead, `[Identity confirmed. Welcome back, Player ${me.username}.]`);
    setTimeout(() => { if (alive) location.hash = "#/"; }, 600);
  });

  return {
    unmount() {
      alive = false;
      document.body.classList.remove("is-welcome");
    },
  };
}
