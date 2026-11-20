const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const accessCookie = "cf_portal_access";
const refreshCookie = "cf_portal_refresh";

function send(res, status, body) {
  return res.status(status).json(body);
}

function cookie(req, key) {
  const prefix = key + "=";
  return (req.headers.cookie ?? "").split(";").map(value => value.trim())
    .find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function saveSession(res, session) {
  const flags = "; Path=/api/portal; HttpOnly; Secure; SameSite=Strict";
  res.setHeader("Set-Cookie", [
    accessCookie + "=" + (session?.access_token ?? "") + "; Max-Age=" + (session?.expires_in ?? 0) + flags,
    refreshCookie + "=" + (session?.refresh_token ?? "") + "; Max-Age=" + (session ? 604800 : 0) + flags
  ]);
}

async function call(path, { token, method = "GET", body, representation = false } = {}) {
  const endpoint = process.env.SUPABASE_URL.replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const headers = { apikey:key, "Content-Type":"application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  if (representation) headers.Prefer = "return=representation";
  const response = await fetch(endpoint + path, {
    method, headers, body:body === undefined ? undefined : JSON.stringify(body),
    signal:AbortSignal.timeout(10000)
  });
  return { status:response.status, ok:response.ok, data:response.status === 204 ? null : await response.json() };
}

async function getSession(req, res) {
  let token = cookie(req, accessCookie);
  const refresh = cookie(req, refreshCookie);
  if (!token && refresh) {
    const response = await call("/auth/v1/token?grant_type=refresh_token", { method:"POST", body:{refresh_token:refresh} });
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) saveSession(res, null);
      return null;
    }
    saveSession(res, response.data);
    token = response.data.access_token;
  }
  if (!token) return null;
  const auth = await call("/auth/v1/user", {token});
  return auth.ok && auth.data.email_confirmed_at ? { token, user:auth.data } : null;
}

function verifyOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || req.headers["sec-fetch-site"] === "cross-site") return false;
  const host = req.headers.host;
  return origin === "https://" + host || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host ?? "") && origin === "http://" + host);
}

async function createSnapshot(input) {
  if (input === undefined || input === null) return null;
  const { annualScenario, monthlyScenario } = await import("../herramientas/impuestos.mjs");
  if (input.type === "annual") return annualScenario(input);
  if (input.type === "monthly") {
    const scenario = monthlyScenario(input);
    if (!scenario.after) throw new Error("Falta el valor oficial de UF para este escenario mensual");
    return scenario;
  }
  throw new Error("Escenario inválido");
}

function requestResult(res, result, error, status = 200) {
  if (result.ok && Array.isArray(result.data) && result.data.length) return send(res, status, {item:result.data[0]});
  return send(res, result.status === 409 ? 409 : 400, {error});
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, {error:"Método no permitido."});
  }
  if (!verifyOrigin(req) || !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) {
    return send(res, 403, {error:"Solicitud no autorizada."});
  }
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)) {
    return send(res, 503, {error:"El acceso a cuentas está pendiente de configuración."});
  }
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, {error:"Solicitud inválida."});
  const {action} = body;
  try {
    if (action === "signup" || action === "signin") {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const password = body.password;
      if (email.length > 254 || !emailPattern.test(email) || typeof password !== "string" ||
          password.length < (action === "signup" ? 12 : 1) || password.length > 72) {
        return send(res, 400, {error:"Revisa el correo y la contraseña. Las cuentas nuevas requieren al menos 12 caracteres."});
      }
      const path = action === "signup" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
      const response = await call(path, {method:"POST", body:{email,password}});
      if (response.status === 429) return send(res, 429, {error:"Demasiados intentos. Intenta más tarde."});
      if (action === "signup" && (response.ok || response.data?.error_code === "user_already_exists")) {
        return send(res, 200, {message:"Revisa tu correo para confirmar la cuenta. Si ya la confirmaste, inicia sesión."});
      }
      if (!response.ok || !response.data.user?.email_confirmed_at || !response.data.access_token) {
        return send(res, 400, {error:action === "signin" ? "Revisa tus credenciales y confirma tu correo." : "No se pudo registrar la cuenta."});
      }
      saveSession(res, response.data);
      return send(res, 200, {message:"Sesión iniciada."});
    }

    const session = await getSession(req, res);
    if (action === "signout") {
      try {
        if (session) await call("/auth/v1/logout?scope=local", {method:"POST",token:session.token});
      } finally {
        saveSession(res, null);
      }
      return send(res, 200, {});
    }
    if (!session) return send(res, 401, {error:"Inicia sesión para acceder a tu cuenta."});

    const {token,user} = session;
    const staff = await call("/rest/v1/cf_staff?select=role&user_id=eq." + user.id, {token});
    if (!staff.ok) return send(res, 503, {error:"El acceso a cuentas está pendiente de configuración."});
    const role = staff.data[0]?.role ?? "client";

    if (action === "dashboard") {
      const [cases, requests] = await Promise.all([
        call("/rest/v1/cf_advisories?select=id,title,summary,scenario,published_at,created_at&order=created_at.desc", {token}),
        call("/rest/v1/cf_agent_requests?select=user_id,email,status,requested_at&order=requested_at.desc", {token})
      ]);
      if (!cases.ok || !requests.ok) return send(res, 503, {error:"No se pudo cargar el panel."});
      return send(res, 200, {user:{id:user.id,email:user.email,role},cases:cases.data,requests:requests.data});
    }
    if (action === "request-agent" && role === "client") {
      const result = await call("/rest/v1/cf_agent_requests", {token, method:"POST", body:{user_id:user.id}, representation:true});
      return requestResult(res, result, "Ya existe una solicitud o no se pudo registrar.", 201);
    }
    if (action === "review-agent" && role === "admin" && uuid.test(body.id ?? "") && ["approved","declined"].includes(body.status)) {
      const result = await call("/rest/v1/cf_agent_requests?user_id=eq." + body.id,
        {token,method:"PATCH",body:{status:body.status},representation:true});
      return requestResult(res, result, "La solicitud ya fue revisada o no está disponible.");
    }
    if (action === "create-case" && role !== "client") {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const summary = typeof body.summary === "string" ? body.summary.trim() : "";
      const client = typeof body.client === "string" ? body.client.trim() : "";
      if (!uuid.test(client) || !title || title.length > 120 || !summary || summary.length > 8000) {
        return send(res, 400, {error:"Completa el código de cliente, el título y el resumen."});
      }
      let scenario;
      try { scenario = await createSnapshot(body.scenario); }
      catch { return send(res, 400, {error:"El escenario tributario es inválido o requiere datos oficiales adicionales."}); }
      const result = await call("/rest/v1/cf_advisories", {token,method:"POST",representation:true,
        body:{client_id:client,title,summary,scenario}});
      return requestResult(res, result, "Comprueba que el código corresponda a una cuenta de cliente confirmada.", 201);
    }
    if (action === "publish-case" && role !== "client" && uuid.test(body.id ?? "")) {
      const result = await call("/rest/v1/cf_advisories?id=eq." + body.id,
        {token,method:"PATCH",body:{published_at:new Date().toISOString()},representation:true});
      return requestResult(res, result, "No se encontró un borrador que puedas publicar.");
    }
    return send(res, 403, {error:"Tu cuenta no tiene acceso a esta acción."});
  } catch {
    return send(res, 502, {error:"El servicio de cuentas no respondió. Intenta nuevamente."});
  }
};
