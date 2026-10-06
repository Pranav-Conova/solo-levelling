import { todayISO } from "./util.js";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      // the server rejects state-changing calls without this header (CSRF guard)
      "X-Requested-With": "fetch",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    keepalive: method !== "GET", // lets deferred deletes finish if the tab closes
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => `${d.loc?.at(-1) ?? "field"}: ${d.msg}`).join("; ")
      : data.detail;
    // a session that expired mid-use sends the Player back to the login window
    if (res.status === 401 && !url.startsWith("/api/auth/")) {
      document.dispatchEvent(new CustomEvent("tracker:unauthorized"));
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  return res.json();
}

export const api = {
  me: () => request("GET", "/api/auth/me"),
  register: (username, password) => request("POST", "/api/auth/register", { username, password }),
  login: (username, password) => request("POST", "/api/auth/login", { username, password }),
  logout: () => request("POST", "/api/auth/logout"),
  changePassword: (current_password, new_password) => request("POST", "/api/auth/password", { current_password, new_password }),

  day: (date) => request("GET", `/api/days/${date}`),
  calendar: (start, end) => request("GET", `/api/calendar?start=${start}&end=${end}`),
  habits: () => request("GET", `/api/habits?today=${todayISO()}`),
  stats: () => request("GET", `/api/stats?today=${todayISO()}`),
  create: (body) => request("POST", "/api/tasks", body),
  complete: (date, id, completed) => request("POST", `/api/days/${date}/tasks/${id}/completion`, { completed }),
  remove: (id) => request("DELETE", `/api/tasks/${id}`),
  archive: (id) => request("POST", `/api/tasks/${id}/archive?on=${todayISO()}`),

  applications: () => request("GET", "/api/applications"),
  createApplication: (body) => request("POST", "/api/applications", body),
  updateApplication: (id, body) => request("PATCH", `/api/applications/${id}`, body),
  deleteApplication: (id) => request("DELETE", `/api/applications/${id}`),
};

// Views listen for this to refresh after any mutation made elsewhere
export const changed = (detail = {}) => document.dispatchEvent(new CustomEvent("tracker:changed", { detail }));
