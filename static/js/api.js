import { todayISO } from "./util.js";

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    keepalive: method !== "GET", // lets deferred deletes finish if the tab closes
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  day: (date) => request("GET", `/api/days/${date}`),
  calendar: (start, end) => request("GET", `/api/calendar?start=${start}&end=${end}`),
  habits: () => request("GET", `/api/habits?today=${todayISO()}`),
  stats: () => request("GET", `/api/stats?today=${todayISO()}`),
  create: (body) => request("POST", "/api/tasks", body),
  complete: (date, id, completed) => request("POST", `/api/days/${date}/tasks/${id}/completion`, { completed }),
  remove: (id) => request("DELETE", `/api/tasks/${id}`),
  archive: (id) => request("POST", `/api/tasks/${id}/archive?on=${todayISO()}`),
};

// Views listen for this to refresh after any mutation made elsewhere
export const changed = (detail = {}) => document.dispatchEvent(new CustomEvent("tracker:changed", { detail }));
