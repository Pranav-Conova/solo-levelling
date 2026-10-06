import { api, changed } from "../api.js";
import { openAdd } from "../add.js";
import { openStories } from "../story.js";
import {
  actionSheet, addDays, burst, confetti, esc, fmt, haptic, heat, icon, initial, mediaFor,
  reducedMotion, replayClass, ring, setRing, toast, todayISO, userName, withUndo,
} from "../util.js";

export const title = "Home";

export function mount(el) {
  const date = todayISO();
  let day = null;
  let habits = [];
  let stats = null;
  let week = [];
  const seen = new Set(); // ids already rendered, so refreshes don't replay entrance animations
  let alive = true;

  el.innerHTML = `
    <div class="home">
      <div class="feed-col">
        <div class="stories" role="list" aria-label="Daily habits" data-stories>
          ${Array.from({ length: 5 }, () => `<div class="story"><span class="story-ring skeleton" style="border-radius:50%"></span><span class="skeleton" style="width:48px;height:10px"></span></div>`).join("")}
        </div>
        <div class="day-head">
          <div class="day-head-row">
            <h1>Today</h1>
            <p data-count aria-live="polite"></p>
          </div>
          <p>${esc(fmt(date, { weekday: "long", month: "long", day: "numeric" }))}</p>
          <div class="progress" role="progressbar" aria-label="Today's progress" aria-valuemin="0" aria-valuemax="100" data-progress><i></i></div>
        </div>
        <div class="feed" data-feed>
          ${`<div class="post"><div class="post-head"><span class="skeleton" style="width:36px;height:36px;border-radius:50%"></span><span class="skeleton" style="width:40%;height:12px"></span></div><div class="skeleton" style="aspect-ratio:16/10;border-radius:0"></div><div style="height:56px"></div></div>`.repeat(2)}
        </div>
      </div>
      <aside class="rail" aria-label="Your progress"><div class="rail-inner" data-rail></div></aside>
    </div>`;

  const storiesEl = el.querySelector("[data-stories]");
  const feedEl = el.querySelector("[data-feed]");
  const railEl = el.querySelector("[data-rail]");
  const habitById = (id) => habits.find((h) => h.id === id);

  // ---------- stories ----------
  function sortedHabits() {
    return [...habits].sort((a, b) => a.completed_today - b.completed_today);
  }

  function renderStories() {
    const list = sortedHabits();
    storiesEl.innerHTML = `
      <div class="story story-add${seen.has("add") ? " static" : ""}" role="listitem">
        <button class="story-ring" type="button" data-add-habit aria-label="Add a daily habit">
          <span>${icon("plus-small")}</span>
          <i class="story-done-badge" aria-hidden="true">${icon("plus-small")}</i>
        </button>
        <span class="story-name">New habit</span>
      </div>
      ${list.map((h, i) => `
        <div class="story${h.completed_today ? " is-done" : ""}${seen.has(`s${h.id}`) ? " static" : ""}" role="listitem" style="--i:${i + 1}" data-story="${h.id}">
          <button class="story-ring" type="button" data-open-story="${i}"
                  aria-label="${esc(h.title)}, ${h.completed_today ? "done today" : "not done yet"}, ${h.streak} day streak">
            <span>${esc(initial(h.title))}</span>
            <i class="story-done-badge" aria-hidden="true">${icon("check")}</i>
          </button>
          <span class="story-name" aria-hidden="true">${esc(h.title)}</span>
        </div>`).join("")}`;
    seen.add("add");
    list.forEach((h) => seen.add(`s${h.id}`));

    storiesEl.querySelector("[data-add-habit]").addEventListener("click", () => openAdd({ kind: "daily" }));
    storiesEl.querySelectorAll("[data-open-story]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const startAt = Number(btn.dataset.openStory);
        if (reducedMotion()) { openStories(list, startAt); return; }
        btn.classList.add("is-loading"); // Instagram's spinning ring while a story "loads"
        setTimeout(() => { btn.classList.remove("is-loading"); openStories(list, startAt); }, 320);
      }),
    );
  }

  function syncStory(task) {
    const story = storiesEl.querySelector(`[data-story="${task.id}"]`);
    const h = habitById(task.id);
    if (!story || !h) return;
    story.classList.toggle("is-done", task.completed);
    story.querySelector("button").setAttribute("aria-label", `${h.title}, ${task.completed ? "done today" : "not done yet"}, ${h.streak} day streak`);
  }

  // ---------- header ----------
  function renderHead() {
    const done = day.tasks.filter((t) => t.completed).length;
    const total = day.tasks.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    el.querySelector("[data-count]").textContent = total ? (done === total ? "All done" : `${done} of ${total} done`) : "";
    const bar = el.querySelector("[data-progress]");
    bar.setAttribute("aria-valuenow", pct);
    bar.style.setProperty("--p", total ? done / total : 0);
    const ringEl = railEl.querySelector("[data-today-ring]");
    if (ringEl) {
      setRing(ringEl.querySelector(".ring"), done, total);
      ringEl.querySelector("strong").textContent = `${pct}%`;
      ringEl.querySelector("small").textContent = total ? `${done} of ${total} tasks today` : "No tasks yet today";
    }
    return { done, total };
  }

  // ---------- feed ----------
  function metaHTML(t) {
    if (t.is_permanent) {
      const streak = habitById(t.id)?.streak ?? 0;
      return `<strong>${streak} day streak</strong><span class="muted">${t.completed ? " · done today" : " · double-tap to complete"}</span>`;
    }
    return t.completed ? `<strong>Completed</strong>` : `<span class="muted">Double-tap the card to complete</span>`;
  }

  function postHTML(t, i) {
    return `
      <article class="post${t.completed ? " is-done" : ""}${seen.has(t.id) ? " static" : ""}" data-id="${t.id}" style="--i:${i}">
        <header class="post-head">
          <span class="avatar"><span>${esc(initial(t.title))}</span></span>
          <div class="post-who">
            <strong>${esc(t.title)}</strong>
            <small>${t.is_permanent ? "Daily habit" : "Today only"}</small>
          </div>
          <button class="icon-btn" type="button" data-more aria-label="More options for ${esc(t.title)}">${icon("more")}</button>
        </header>
        <div class="post-media" style="--media-bg:${mediaFor(t.id)}" data-media>
          <h2>${esc(t.title)}</h2>
          <span class="done-stamp" aria-hidden="true">${icon("check")} Done</span>
          <svg class="big-heart" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-heart"/></svg>
        </div>
        <div class="post-actions">
          <button class="icon-btn like-btn" type="button" data-like aria-pressed="${t.completed}"
                  aria-label="Mark ${esc(t.title)} as done">${icon("heart")}</button>
        </div>
        <p class="post-meta" data-meta>${metaHTML(t)}</p>
      </article>`;
  }

  function renderFeed() {
    if (!day.tasks.length) {
      feedEl.innerHTML = `
        <div class="empty">
          <div class="empty-art">${icon("sparkle")}</div>
          <h3>Start your first quest</h3>
          <p>Add a daily habit or something just for today.</p>
          <button class="btn btn-primary" type="button" data-empty-add>Create a task</button>
        </div>`;
      feedEl.querySelector("[data-empty-add]").addEventListener("click", () => openAdd());
      return;
    }
    feedEl.innerHTML = day.tasks.map(postHTML).join("");
    day.tasks.forEach((t) => seen.add(t.id));
  }

  function updatePost(post, t) {
    post.classList.toggle("is-done", t.completed);
    post.querySelector("[data-like]").setAttribute("aria-pressed", t.completed);
    post.querySelector("[data-meta]").innerHTML = metaHTML(t);
  }

  async function setDone(t, post, next, { viaDoubleTap = false } = {}) {
    const before = renderHead();
    const habit = habitById(t.id);
    t.completed = next;
    if (habit) {
      habit.completed_today = next;
      habit.streak = Math.max(0, habit.streak + (next ? 1 : -1));
    }
    updatePost(post, t);
    syncStory(t);
    const after = renderHead();

    if (next) {
      haptic(12);
      const like = post.querySelector("[data-like]");
      replayClass(like, "pop");
      burst(like);
      replayClass(post, "just-done");
      if (viaDoubleTap) replayClass(post.querySelector(".big-heart"), "play");
      if (after.total && after.done === after.total && before.done < after.total) perfectDay();
    }

    try {
      await api.complete(date, t.id, next);
      changed({ kind: "completion", source: "home" });
    } catch (err) {
      t.completed = !next;
      if (habit) {
        habit.completed_today = !next;
        habit.streak = Math.max(0, habit.streak + (next ? -1 : 1));
      }
      updatePost(post, t);
      syncStory(t);
      renderHead();
      toast(`Couldn't save: ${err.message}`, { tone: "error" });
    }
  }

  function perfectDay() {
    toast("Perfect day! Every task done (+20 XP)");
    confetti(document.body);
  }

  function removePost(t, post) {
    const isHabit = t.is_permanent;
    actionSheet(t.title, [
      {
        label: isHabit ? "Stop this habit" : "Delete task",
        danger: true,
        run: () => {
          post.classList.add("is-leaving");
          const hide = () => { post.hidden = true; };
          post.addEventListener("animationend", hide, { once: true });
          if (reducedMotion()) hide();
          const idx = day.tasks.indexOf(t);
          day.tasks.splice(idx, 1);
          renderHead();
          withUndo(isHabit ? "Habit stopped. Past days keep their history." : "Task deleted", {
            commit: async () => {
              try {
                await (isHabit ? api.archive(t.id) : api.remove(t.id));
                changed({ kind: "removed", source: "home" });
                if (isHabit) { habits = habits.filter((h) => h.id !== t.id); renderStories(); }
              } catch (err) {
                toast(`Couldn't remove: ${err.message}`, { tone: "error" });
                load();
              }
            },
            undo: () => {
              day.tasks.splice(idx, 0, t);
              post.hidden = false;
              post.classList.remove("is-leaving", "static");
              replayClass(post, "post");
              renderHead();
            },
          });
        },
      },
      ...(isHabit ? [{ label: "View in profile", run: () => { location.hash = "#/profile/habits"; } }] : []),
    ]);
  }

  // event delegation keeps the feed cheap to re-render
  let lastTap = { id: null, t: 0 };
  feedEl.addEventListener("click", (e) => {
    const post = e.target.closest(".post[data-id]");
    if (!post) return;
    const t = day.tasks.find((x) => x.id === Number(post.dataset.id));
    if (!t) return;
    if (e.target.closest("[data-like]")) setDone(t, post, !t.completed);
    else if (e.target.closest("[data-more]")) removePost(t, post);
  });
  feedEl.addEventListener("pointerup", (e) => {
    const media = e.target.closest("[data-media]");
    if (!media || e.pointerType === "mouse" && e.button !== 0) return;
    const post = media.closest(".post");
    const id = Number(post.dataset.id);
    const now = performance.now();
    if (lastTap.id === id && now - lastTap.t < 320) {
      lastTap = { id: null, t: 0 };
      const t = day.tasks.find((x) => x.id === id);
      if (!t) return;
      // like Instagram, double-tap only ever completes; it never un-completes
      if (t.completed) replayClass(media.querySelector(".big-heart"), "play");
      else setDone(t, post, true, { viaDoubleTap: true });
    } else {
      lastTap = { id, t: now };
    }
  });

  // ---------- right rail (desktop) ----------
  function renderRail() {
    const pct = stats ? Math.max(0, Math.min(1, (stats.xp - stats.level_start_xp) / (stats.next_level_xp - stats.level_start_xp))) : 0;
    railEl.innerHTML = `
      <div class="mini-profile">
        <span class="avatar"><span>${esc(initial(userName()))}</span></span>
        <div><strong>${esc(userName())}</strong><small>Level ${stats.level} · Rank ${stats.rank}</small></div>
        <a class="btn btn-ghost" href="#/profile">View</a>
      </div>
      <div class="rail-card">
        <p class="section-title">Today</p>
        <div class="ring-wrap" data-today-ring>${ring()}<div><strong>0%</strong><small></small></div></div>
      </div>
      <div class="rail-card">
        <p class="section-title">Last 7 days</p>
        <div class="week">
          ${week.map((d) => `
            <a href="#/calendar/${d.date}" class="${d.date === date ? "is-today" : ""}"
               aria-label="${esc(fmt(d.date, { weekday: "long", month: "short", day: "numeric" }))}: ${d.done} of ${d.total} done">
              <i class="h${heat(d.done, d.total)}"></i>${esc(fmt(d.date, { weekday: "narrow" }))}
            </a>`).join("")}
        </div>
      </div>
      <div class="rail-card">
        <p class="section-title">Level ${stats.level} progress</p>
        <div class="progress" style="--p:${pct}"><i></i></div>
        <small style="color:var(--text-2);font-size:13px">${stats.next_level_xp - stats.xp} XP to level ${stats.level + 1}</small>
      </div>
      <p class="rail-foot">Tip: double-tap any card to complete it. &copy; ${new Date().getFullYear()} Solo Levelling</p>`;
  }

  // ---------- data ----------
  async function load() {
    try {
      const [d, h, s, w] = await Promise.all([api.day(date), api.habits(), api.stats(), api.calendar(addDays(date, -6), date)]);
      if (!alive) return;
      day = d; habits = h; stats = s; week = w;
      renderStories();
      renderFeed();
      renderRail();
      renderHead();
    } catch (err) {
      feedEl.innerHTML = `<div class="empty"><h3>Couldn't load your day</h3><p>${esc(err.message)}</p><button class="btn btn-secondary" type="button" data-retry>Try again</button></div>`;
      feedEl.querySelector("[data-retry]").addEventListener("click", load);
    }
  }

  async function refreshSide() {
    const [s, w] = await Promise.all([api.stats(), api.calendar(addDays(date, -6), date)]);
    if (!alive) return;
    stats = s; week = w;
    renderRail();
    renderHead();
  }

  load();

  return {
    refresh(detail) {
      if (detail.source === "home") refreshSide().catch(() => {});
      else load();
    },
    unmount() { alive = false; },
  };
}
