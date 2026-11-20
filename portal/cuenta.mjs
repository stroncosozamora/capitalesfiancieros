import { money } from "../herramientas/impuestos.mjs";

const get = id => document.getElementById(id);
const notice = get("notice");
let signingUp = false;
let portalUser = null;

if (location.hash) history.replaceState(null, "", location.pathname + location.search);

async function api(action, payload = {}) {
  const response = await fetch("/api/portal", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,action})});
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "No se pudo completar la acción.");
    error.status = response.status;
    throw error;
  }
  return data;
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
      if (error.status === 401) showAuth();
      notice.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

function showAuth(message = "") {
  portalUser = null;
  get("dashboard").hidden = true;
  get("cases").replaceChildren();
  get("requests").replaceChildren();
  get("case-form").reset();
  get("auth-section").hidden = false;
  get("page-title").textContent = "Portal de asesorías";
  notice.textContent = message;
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
    const titles = {admin:"Administración",agent:"Panel de agente",client:"Mis asesorías"};
    get("page-title").textContent = titles[user.role];
    get("identity").textContent = user.email;
    get("auth-section").hidden = true;
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
    showAuth(error.status === 401 ? "" : error.message);
  }
}

get("auth-toggle").addEventListener("click",() => {
  signingUp = !signingUp;
  get("auth-title").textContent = signingUp ? "Crear cuenta" : "Iniciar sesión";
  get("auth-submit").textContent = signingUp ? "Registrarme" : "Ingresar";
  get("auth-toggle").textContent = signingUp ? "Ya tengo cuenta" : "Crear cuenta";
  get("auth-help").hidden = !signingUp;
  get("password").minLength = signingUp ? 12 : 1;
  get("password").autocomplete = signingUp ? "new-password" : "current-password";
});
get("auth-form").addEventListener("submit",task(get("auth-submit"),async () => {
  const response = await api(signingUp ? "signup" : "signin",{email:get("email").value,password:get("password").value});
  get("password").value = "";
  if (signingUp) {
    get("auth-toggle").click();
    notice.textContent = response.message;
  } else {
    await loadDashboard();
  }
}));
get("signout").addEventListener("click",task(get("signout"),async () => {
  try { await api("signout"); }
  finally {
    try { sessionStorage.removeItem("cf-advisory-scenario"); } catch {}
    showAuth();
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
