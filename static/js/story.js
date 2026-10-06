import { api, changed } from "./api.js";
import {
  closeDialog, fmt, haptic, icon, initial, makeDialog, mediaFor, openDialog,
  plural, reducedMotion, replayClass, toast, todayISO,
} from "./util.js";

const STORY_MS = 6000;

export function openStories(habits, startIndex = 0) {
  const list = habits.map((h) => ({ ...h }));
  let index = startIndex;
  let paused = reducedMotion(); // no auto-advance when motion is reduced
  let held = false;
  let advanceTimer;

  const dlg = makeDialog("story");
  dlg.setAttribute("aria-label", "Habit stories");
  dlg.innerHTML = `
    <div class="story-shell">
      <button class="story-arrow prev" type="button" aria-label="Previous habit">${icon("chevron-left")}</button>
      <div class="story-stage" style="--story-ms:${STORY_MS}ms">
        <div class="story-bars" aria-hidden="true">
          ${list.map(() => `<div class="story-bar"><i></i></div>`).join("")}
        </div>
        <div class="story-top">
          <span class="avatar"><span data-initial></span></span>
          <div class="who"><strong data-title></strong><small data-since></small></div>
          <button class="icon-btn" type="button" data-pause></button>
          <button class="icon-btn" type="button" data-close aria-label="Close stories">${icon("x")}</button>
        </div>
        <div class="story-content" aria-live="polite">
          <p class="story-kicker">Daily habit</p>
          <h2 data-heading></h2>
          <div class="story-streak">${icon("flame")}<strong data-streak></strong><span>day streak</span></div>
          <p class="story-status" data-status></p>
          <svg class="big-heart" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-heart"/></svg>
        </div>
        <div class="story-foot">
          <button class="story-cta" type="button" data-toggle></button>
        </div>
      </div>
      <button class="story-arrow next" type="button" aria-label="Next habit">${icon("chevron-right")}</button>
    </div>`;

  const stage = dlg.querySelector(".story-stage");
  const bars = [...dlg.querySelectorAll(".story-bar")];
  const content = dlg.querySelector(".story-content");
  const cta = dlg.querySelector("[data-toggle]");
  const pauseBtn = dlg.querySelector("[data-pause]");
  const prevBtn = dlg.querySelector(".story-arrow.prev");
  const nextBtn = dlg.querySelector(".story-arrow.next");
  const q = (sel) => dlg.querySelector(sel);

  function renderPause() {
    stage.classList.toggle("is-paused", paused || held);
    pauseBtn.innerHTML = icon(paused ? "play" : "pause");
    pauseBtn.setAttribute("aria-label", paused ? "Play stories" : "Pause stories");
  }

  function renderCta(h) {
    cta.classList.toggle("is-done", h.completed_today);
    cta.innerHTML = h.completed_today ? `${icon("check")} Done today, tap to undo` : `${icon("heart")} Mark done`;
    q("[data-status]").textContent = h.completed_today ? "Nice. You showed up today." : "Not done yet today";
    q("[data-streak]").textContent = h.streak;
  }

  function render(animate = true) {
    const h = list[index];
    stage.style.setProperty("--story-bg", mediaFor(h.id));
    q("[data-initial]").textContent = initial(h.title);
    q("[data-title]").textContent = h.title;
    q("[data-since]").textContent = `Since ${fmt(h.start_date, { month: "short", day: "numeric" })} · ${plural(h.total_done, "day")} done`;
    q("[data-heading]").textContent = h.title;
    renderCta(h);
    bars.forEach((bar, i) => {
      bar.classList.toggle("is-seen", i < index);
      bar.classList.remove("is-active");
    });
    void stage.offsetWidth;
    bars[index].classList.add("is-active");
    if (animate) replayClass(content, "swap");
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === list.length - 1;
  }

  const go = (delta) => {
    clearTimeout(advanceTimer);
    const next = index + delta;
    if (next < 0) return;
    if (next >= list.length) { closeDialog(dlg); return; }
    index = next;
    render();
  };

  bars.forEach((bar) =>
    bar.addEventListener("animationend", () => { if (bar.classList.contains("is-active")) go(1); }),
  );

  async function toggle() {
    const h = list[index];
    const next = !h.completed_today;
    h.completed_today = next;
    h.streak = Math.max(0, h.streak + (next ? 1 : -1));
    h.total_done = Math.max(0, h.total_done + (next ? 1 : -1));
    renderCta(h);
    if (next) {
      haptic(12);
      const heart = q(".big-heart");
      replayClass(heart, "play");
      // move on to the next habit like a story would, unless the user paused
      if (!paused) advanceTimer = setTimeout(() => go(1), 900);
    }
    try {
      await api.complete(todayISO(), h.id, next);
    } catch (err) {
      h.completed_today = !next;
      h.streak = Math.max(0, h.streak + (next ? -1 : 1));
      renderCta(h);
      toast(`Couldn't save: ${err.message}`, { tone: "error" });
    }
  }

  // Tap left third = back, rest = forward, hold = pause, drag down = close
  let start = null;
  let holdTimer;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
    holdTimer = setTimeout(() => { held = true; renderPause(); }, 180);
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dy = Math.max(0, e.clientY - start.y);
    if (dy > 6) stage.style.transform = `translateY(${dy * 0.6}px) scale(${1 - Math.min(dy, 300) / 3000})`;
  });
  const end = (e) => {
    if (!start) return;
    clearTimeout(holdTimer);
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const quick = performance.now() - start.t < 250;
    stage.style.transform = "";
    start = null;
    const wasHeld = held;
    held = false;
    renderPause();
    if (dy > 110) { closeDialog(dlg); return; }
    if (!wasHeld && quick && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const rect = stage.getBoundingClientRect();
      go(e.clientX - rect.left < rect.width * 0.32 ? -1 : 1);
    }
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);

  cta.addEventListener("click", toggle);
  prevBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(1));
  pauseBtn.addEventListener("click", () => { paused = !paused; renderPause(); });
  q("[data-close]").addEventListener("click", () => closeDialog(dlg));
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  });
  dlg.addEventListener("close", () => {
    clearTimeout(advanceTimer);
    dlg.remove();
    changed({ kind: "stories" });
  });

  render(false);
  renderPause();
  openDialog(dlg);
  cta.focus();
}

