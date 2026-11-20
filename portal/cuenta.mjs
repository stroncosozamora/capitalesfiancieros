import { money } from "../herramientas/impuestos.mjs";
import { api } from "./acceso.mjs";

const get = id => document.getElementById(id);
const notice = get("notice");
let portalUser = null;

if (location.hash.includes("access_token=")) history.replaceState(null, "", location.pathname + location.search);

const roles = {admin:"Administrador",agent:"Agente",client:"Cliente"};
const titles = {admin:"Administración",agent:"Panel de agente",client:"Mis asesorías"};
const intros = {
  admin:"Accede a las herramientas, revisa las asesorías y gestiona las solicitudes de agentes.",
  agent:"Usa las herramientas para preparar una asesoría y compartirla con tu cliente.",
  client:"Usa las herramientas o consulta las asesorías publicadas para ti."
};

function renderView() {
  if (!portalUser) return;
  const casesView = location.hash === "#asesorias";
  get("welcome").hidden = casesView;
  get("asesorias").hidden = !casesView;
  get("page-title").textContent = casesView ? titles[portalUser.role] : "Bienvenida a Capitales Financieros";
  get("home-link").toggleAttribute("aria-current", !casesView);
  get("cases-link").toggleAttribute("aria-current", casesView);
  get(casesView ? "cases-link" : "home-link").setAttribute("aria-current","page");
}

function element(tag,text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function pendingScenario() {
  try { return JSON.parse(sessionStorage.getItem("cf-advisory-scenario")); }
  catch { return null; }
}

function updateAttach() {
  const scenario = pendingScenario();
  get("attach-field").hidden = !scenario;
  get("attach-label").textContent = scenario?.type === "annual" ? "Adjuntar escenario anual · AT 2026" : "Adjuntar escenario mensual · 2026";
}

function task(button, operation) {
  return async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    notice.textContent = "";
    try { await operation(); }
    catch (error) {
      if (error.status === 401) location.replace("/");
      notice.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

function renderCases(cases, role) {
  const list = get("cases");
  list.replaceChildren();
  if (!cases.length) list.append(element("li", "Todavía no hay asesorías para mostrar."));
  for (const advisory of cases) {
    const item = element("li", "");
    item.className = "card";
    const summary = element("p",advisory.summary);
    summary.className = "summary-text";
    item.append(element("h3",advisory.title),
      element("p",advisory.published_at ? "Publicada" : "Borrador"),summary);
    const scenario = advisory.scenario;
    if (scenario && Number.isFinite(scenario.before?.tax) && Number.isFinite(scenario.after?.tax) && Number.isFinite(scenario.savings)) {
      item.append(element("p",String(scenario.period)),
        element("p","Impuesto base " + money(scenario.before.tax) + " · Con APV B " + money(scenario.after.tax)),
        element("p","Disminución estimada " + money(scenario.savings)));
      if (Number.isFinite(scenario.bonus)) item.append(element("p","Bonificación fiscal estimada en régimen A " + money(scenario.bonus)));
    }
    if (!advisory.published_at && role !== "client") {
      const publish = element("button","Publicar para el cliente");
      publish.addEventListener("click",task(publish,async () => {
        if (!window.confirm("¿Publicar esta asesoría para que tu cliente pueda verla?")) return;
        await api("publish-case",{id:advisory.id});
        await loadDashboard("Asesoría publicada.");
      }));
      item.append(publish);
    }
    list.append(item);
  }
}

function renderRequests(requests) {
  const list = get("requests");
  list.replaceChildren();
  const pending = requests.filter(request => request.status === "pending");
  if (!pending.length) list.append(element("li","No hay solicitudes pendientes."));
  for (const request of pending) {
    const item = element("li","");
    const actions = element("div","");
    actions.className = "actions";
    item.append(element("p",request.email),actions);
    for (const [label,status] of [["Aprobar","approved"],["Rechazar","declined"]]) {
      const button = element("button",label);
      button.addEventListener("click",task(button,async () => {
        await api("review-agent",{id:request.user_id,status});
        await loadDashboard("Solicitud revisada.");
      }));
      actions.append(button);
    }
    list.append(item);
  }
}

async function loadDashboard(message = "") {
  try {
    const {user,cases,requests} = await api("dashboard");
    portalUser = user;
    get("identity").textContent = roles[user.role] + " · " + user.email;
    get("welcome-text").textContent = intros[user.role];
    get("advisory-link").textContent = user.role === "client" ? "Ver mis asesorías" : "Ir a asesorías";
    get("main-menu").hidden = false;
    get("page-title").hidden = false;
    renderView();
    get("dashboard").hidden = false;
    get("client-section").hidden = user.role !== "client";
    get("staff-section").hidden = user.role === "client";
    get("admin-section").hidden = user.role !== "admin";
    if (user.role === "admin") renderRequests(requests);
    if (user.role === "client") {
      get("client-code").textContent = user.id;
      const status = requests[0]?.status;
      get("request-agent").hidden = Boolean(status);
      get("request-status").textContent = status === "pending" ? "Tu solicitud está pendiente de revisión."
        : status === "declined" ? "Tu solicitud de acceso de agente fue rechazada." : "";
    }
    updateAttach();
    renderCases(cases,user.role);
    notice.textContent = message;
  } catch (error) {
    if (error.status === 401) location.replace("/");
    else notice.textContent = error.message;
  }
}

window.addEventListener("hashchange",renderView);
get("signout").addEventListener("click",task(get("signout"),async () => {
  try { await api("signout"); }
  finally {
    try { sessionStorage.removeItem("cf-advisory-scenario"); } catch {}
    location.replace("/");
  }
}));
get("request-agent").addEventListener("click",task(get("request-agent"),async () => {
  await api("request-agent");
  await loadDashboard("Solicitud recibida.");
}));
get("copy-code").addEventListener("click",task(get("copy-code"),async () => {
  await navigator.clipboard.writeText(portalUser.id);
  notice.textContent = "Código copiado.";
}));
get("case-form").addEventListener("submit",task(get("save-case"),async () => {
  const scenario = get("attach-scenario").checked ? pendingScenario() : null;
  await api("create-case",{client:get("recipient-code").value,title:get("case-title").value,summary:get("case-summary").value,scenario});
  if (scenario) {
    try { sessionStorage.removeItem("cf-advisory-scenario"); } catch {}
  }
  get("case-form").reset();
  await loadDashboard("Borrador guardado.");
}));

loadDashboard();
