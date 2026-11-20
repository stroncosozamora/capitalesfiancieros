import { api } from "./acceso.mjs";

const status = document.getElementById("tool-status");
try {
  await api("session");
  document.getElementById("tool-content").hidden = false;
  status.hidden = true;
} catch (error) {
  if (error.status === 401) {
    const next = location.pathname.startsWith("/polizas") ? "polizas" : "apv";
    location.replace("/?next=" + next);
  } else {
    status.textContent = error.message;
  }
}
