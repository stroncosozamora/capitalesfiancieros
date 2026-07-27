import crypto from "node:crypto";

const json = (res, status, body) => res.status(status).json(body);
const env = () => ({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SECRET_KEY,
  turnstile: process.env.TURNSTILE_SECRET_KEY
});

function configured() {
  const { url, key, turnstile } = env();
  return Boolean(url && key && turnstile);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0].trim();
}

function fingerprint(req, extra = "") {
  const { key } = env();
  return crypto.createHmac("sha256", key)
    .update(`${clientIp(req)}|${req.headers["user-agent"] || ""}|${extra}`)
    .digest("hex");
}

async function supabase(path, options = {}) {
  const { url, key } = env();
  return fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
}

export default async function handler(req, res) {
  if (!configured()) return json(res, 503, { error: "El servicio de recomendaciones aún no está configurado." });

  if (req.method === "GET") {
    try {
      const response = await supabase(
        "recommendations?select=id,full_name,opinion,official_reply,likes_count,published_at&status=eq.approved&order=published_at.desc&limit=50"
      );
      if (!response.ok) return json(res, 500, { error: "No fue posible cargar las recomendaciones." });
      return json(res, 200, { recommendations: await response.json() });
    } catch (error) {
      console.error("recommendations GET:", error);
      return json(res, 500, { error: "No fue posible cargar las recomendaciones." });
    }
  }

  if (req.method !== "POST") return json(res, 405, { error: "Método no permitido." });

  try {
    const { fullName, email, opinion, consent, turnstileToken } = req.body || {};
    const name = String(fullName || "").trim().replace(/\s+/g, " ");
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const text = String(opinion || "").trim();
    if (name.length < 5 || name.length > 100) return json(res, 400, { error: "Ingresa tu nombre y apellido." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      return json(res, 400, { error: "Ingresa un correo válido." });
    }
    if (text.length < 20 || text.length > 1200) {
      return json(res, 400, { error: "La opinión debe tener entre 20 y 1.200 caracteres." });
    }
    if (consent !== true) return json(res, 400, { error: "Debes autorizar la publicación de tu nombre y opinión." });
    if (!turnstileToken) return json(res, 400, { error: "Completa la verificación de seguridad." });

    const { turnstile } = env();
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: turnstile, response: turnstileToken, remoteip: clientIp(req) })
    });
    const verificationResult = await verification.json();
    if (!verificationResult.success) return json(res, 400, { error: "No pudimos validar el CAPTCHA. Inténtalo nuevamente." });

    const requestFingerprint = fingerprint(req, normalizedEmail);
    const recent = await supabase(
      `recommendations?select=id&request_fingerprint=eq.${requestFingerprint}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}&limit=1`
    );
    if (!recent.ok) return json(res, 503, { error: "No fue posible validar el envío. Inténtalo nuevamente." });
    if ((await recent.json()).length) {
      return json(res, 429, { error: "Ya recibimos una recomendación desde estos datos durante las últimas 24 horas." });
    }

    const inserted = await supabase("recommendations", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        full_name: name,
        email: normalizedEmail,
        opinion: text,
        consent_given: true,
        request_fingerprint: requestFingerprint
      })
    });
    if (!inserted.ok) return json(res, 500, { error: "No fue posible guardar tu recomendación." });
    return json(res, 201, { success: true });
  } catch (error) {
    console.error("recommendations:", error);
    return json(res, 500, { error: "Ocurrió un error inesperado." });
  }
}
