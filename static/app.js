const state = {
  viewYear: null,
  viewMonth: null, // 0-indexed
  selectedDate: null, // "YYYY-MM-DD"
  calendarData: {}, // date -> {total, done}
};

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return toISODate(new Date());
}

function init() {
  const today = new Date();
  state.viewYear = today.getFullYear();
  state.viewMonth = today.getMonth();
  state.selectedDate = todayISO();

  document.getElementById("prevMonth").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => shiftMonth(1));
  document.getElementById("addTaskForm").addEventListener("submit", onAddTask);

  loadMonth();
  loadDay(state.selectedDate);
}

function shiftMonth(delta) {
  state.viewMonth += delta;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
  loadMonth();
}

async function loadMonth() {
  const start = new Date(state.viewYear, state.viewMonth, 1);
  const end = new Date(state.viewYear, state.viewMonth + 1, 0);
  const res = await fetch(`/api/calendar?start=${toISODate(start)}&end=${toISODate(end)}`);
  const data = await res.json();
  state.calendarData = {};
  data.forEach((d) => { state.calendarData[d.date] = d; });
  renderCalendar(start, end);
}

function renderCalendar(start, end) {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";

  const monthLabel = start.toLocaleString(undefined, { month: "long", year: "numeric" });
  document.getElementById("monthLabel").textContent = monthLabel;

  ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((label) => {
    const el = document.createElement("div");
    el.textContent = label;
    el.style.textAlign = "center";
    el.style.fontSize = "0.75rem";
    el.style.color = "var(--muted)";
    grid.appendChild(el);
  });

  const leadingBlanks = start.getDay();
  for (let i = 0; i < leadingBlanks; i++) {
    const blank = document.createElement("div");
    blank.className = "day-cell empty";
    grid.appendChild(blank);
  }

  const today = todayISO();
  for (let day = 1; day <= end.getDate(); day++) {
    const dateObj = new Date(state.viewYear, state.viewMonth, day);
    const iso = toISODate(dateObj);
    const cell = document.createElement("div");
    cell.className = "day-cell";
    if (iso === today) cell.classList.add("today");
    if (iso === state.selectedDate) cell.classList.add("selected");

    const num = document.createElement("div");
    num.textContent = day;
    cell.appendChild(num);

    const summary = state.calendarData[iso];
    const dot = document.createElement("div");
    dot.className = "day-dot";
    if (summary && summary.total > 0) {
      if (summary.done === summary.total) dot.classList.add("done-all");
      else if (summary.done > 0) dot.classList.add("done-partial");
    }
    cell.appendChild(dot);

    cell.addEventListener("click", () => {
      state.selectedDate = iso;
      renderCalendar(start, end);
      loadDay(iso);
    });

    grid.appendChild(cell);
  }
}

async function loadDay(iso) {
  const res = await fetch(`/api/days/${iso}`);
  const data = await res.json();
  renderDay(data);
}

function renderDay(data) {
  const label = document.getElementById("dayLabel");
  const dateObj = new Date(data.date + "T00:00:00");
  label.textContent = dateObj.toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const list = document.getElementById("taskList");
  list.innerHTML = "";

  if (data.tasks.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No tasks for this day yet.";
    empty.style.color = "var(--muted)";
    list.appendChild(empty);
    return;
  }

  data.tasks.forEach((task) => {
    const li = document.createElement("li");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.addEventListener("change", () => toggleCompletion(task.id, checkbox.checked));
    li.appendChild(checkbox);

    const title = document.createElement("span");
    title.className = "title" + (task.completed ? " completed" : "");
    title.textContent = task.title;
    li.appendChild(title);

    if (task.is_permanent) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "daily";
      li.appendChild(badge);
    }

    const del = document.createElement("button");
    del.className = "delete-btn";
    del.textContent = "✕";
    del.title = task.is_permanent ? "Stop this permanent task" : "Delete this task";
    del.addEventListener("click", () => deleteTask(task.id));
    li.appendChild(del);

    list.appendChild(li);
  });
}

async function toggleCompletion(taskId, completed) {
  await fetch(`/api/days/${state.selectedDate}/tasks/${taskId}/completion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completed }),
  });
  loadDay(state.selectedDate);
  loadMonth();
}

async function deleteTask(taskId) {
  await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
  loadDay(state.selectedDate);
  loadMonth();
}

async function onAddTask(e) {
  e.preventDefault();
  const titleInput = document.getElementById("taskTitle");
  const permanentInput = document.getElementById("taskPermanent");

  const title = titleInput.value.trim();
  if (!title) return;

  const isPermanent = permanentInput.checked;

  await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      is_permanent: isPermanent,
      specific_date: isPermanent ? null : state.selectedDate,
    }),
  });

  titleInput.value = "";
  permanentInput.checked = false;
  loadDay(state.selectedDate);
  loadMonth();
}

init();
