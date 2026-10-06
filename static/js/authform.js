import { icon } from "./util.js";

const NAME_RULE = /^[A-Za-z0-9_.-]{3,30}$/;

/** Username + password fields for the awakening (register) and identification (login) windows. */
export function credentialsHTML(mode) {
  const register = mode === "register";
  return `
    <form class="auth-form" method="post" novalidate data-cred>
      <div class="field">
        <label for="cred-name">Name</label>
        <input class="input" id="cred-name" name="username" autocomplete="username" autocapitalize="none"
               spellcheck="false" maxlength="30" required aria-describedby="cred-name-help cred-name-err" />
        <p class="field-help" id="cred-name-help">${register ? "3–30 letters, numbers, dots, dashes or underscores. This is your Player name." : ""}</p>
        <p class="field-error" id="cred-name-err" hidden></p>
      </div>
      <div class="field">
        <label for="cred-pass">Password</label>
        <div class="pw-wrap">
          <input class="input" id="cred-pass" name="password" type="password" required
                 autocomplete="${register ? "new-password" : "current-password"}" maxlength="128"
                 aria-describedby="cred-pass-help cred-pass-err" />
          <button class="icon-btn pw-toggle" type="button" data-toggle-pw aria-label="Show password" aria-pressed="false">${icon("eye")}</button>
        </div>
        <p class="field-help" id="cred-pass-help">${register ? "At least 8 characters." : ""}</p>
        <p class="field-error" id="cred-pass-err" hidden></p>
      </div>
      <p class="form-error" role="alert" data-form-error hidden></p>
      <button class="btn btn-primary btn-block" type="submit">${register ? "Become a Player" : "Enter"}</button>
    </form>`;
}

/**
 * Validates, shows errors next to the field they belong to, and calls `submit(name, password)`.
 * `submit` should throw an Error with `.status` from the API; 409 points at the name, 401 at the password.
 */
export function wireCredentials(root, mode, submit) {
  const form = root.querySelector("[data-cred]");
  const nameEl = form.elements.username;
  const passEl = form.elements.password;
  const button = form.querySelector("[type=submit]");
  const formError = form.querySelector("[data-form-error]");
  const label = button.textContent;
  const register = mode === "register";

  const setError = (input, message) => {
    const el = form.querySelector(`#${input.id}-err`);
    el.textContent = message || "";
    el.hidden = !message;
    input.setAttribute("aria-invalid", message ? "true" : "false");
  };

  const check = () => {
    const name = nameEl.value.trim();
    const pass = passEl.value;
    const errors = [];
    if (!name) errors.push([nameEl, "Enter your Player name."]);
    else if (register && !NAME_RULE.test(name)) errors.push([nameEl, "Use 3–30 letters, numbers, dots, dashes or underscores."]);
    if (!pass) errors.push([passEl, "Enter your password."]);
    else if (register && pass.length < 8) errors.push([passEl, "Use at least 8 characters."]);
    setError(nameEl, errors.find(([el]) => el === nameEl)?.[1]);
    setError(passEl, errors.find(([el]) => el === passEl)?.[1]);
    return errors;
  };

  // validate after the Player leaves a field, not on every keystroke
  [nameEl, passEl].forEach((el) => el.addEventListener("blur", () => { if (el.value) check(); }));
  [nameEl, passEl].forEach((el) => el.addEventListener("input", () => { if (el.getAttribute("aria-invalid") === "true") check(); }));

  form.querySelector("[data-toggle-pw]").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const show = passEl.type === "password";
    passEl.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", show);
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    btn.innerHTML = icon(show ? "eye-off" : "eye");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.hidden = true;
    const errors = check();
    if (errors.length) { errors[0][0].focus(); return; }
    button.disabled = true;
    button.textContent = register ? "Awakening…" : "Identifying…";
    try {
      await submit(nameEl.value.trim(), passEl.value);
    } catch (err) {
      if (err.status === 409) { setError(nameEl, err.message); nameEl.focus(); }
      else if (err.status === 401) { setError(passEl, err.message); passEl.select(); }
      else { formError.textContent = err.message; formError.hidden = false; }
      button.disabled = false;
      button.textContent = label;
    }
  });

  nameEl.focus();
}
