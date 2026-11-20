const accessCookie = "cf_site_access";
const refreshCookie = "cf_site_refresh";

function cookie(req, key) {
  const prefix = key + "=";
  return (req.headers.cookie ?? "").split(";").map(value => value.trim())
    .find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function configured() {
  return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY));
}

function saveSession(res, session) {
  const flags = "; Path=/; HttpOnly; Secure; SameSite=Strict";
  res.setHeader("Set-Cookie", [
    accessCookie + "=" + (session?.access_token ?? "") + "; Max-Age=" + (session?.expires_in ?? 0) + flags,
    refreshCookie + "=" + (session?.refresh_token ?? "") + "; Max-Age=" + (session ? 604800 : 0) + flags,
    "cf_portal_access=; Max-Age=0" + flags.replace("Path=/;", "Path=/api/portal;"),
    "cf_portal_refresh=; Max-Age=0" + flags.replace("Path=/;", "Path=/api/portal;")
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

async function requirePortalSession(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!verifyOrigin(req)) {
    res.status(403).json({error:"Solicitud no autorizada."});
    return false;
  }
  if (!configured()) {
    res.status(503).json({error:"El acceso a cuentas está pendiente de configuración."});
    return false;
  }
  try {
    if (await getSession(req, res)) return true;
    res.status(401).json({error:"Inicia sesión para usar esta herramienta."});
    return false;
  } catch {
    res.status(502).json({error:"El servicio de cuentas no respondió."});
    return false;
  }
}

module.exports = {configured, call, getSession, saveSession, verifyOrigin, requirePortalSession};
