import crypto from "node:crypto";

const CORPORATE_EMAIL = "sebastian.troncoso@zurich.cl";
const FROM = "Capitales Financieros <analisis@informes.capitalesfinancieros.cl>";
const SITE_URL = "https://www.capitalesfinancieros.cl";

function json(res, status, body) {
  return res.status(status).json(body);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0].trim();
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function text(value, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function emailIsValid(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function normalizeAnalysis(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    aseguradora: text(source.aseguradora, 120) || "No identificada",
    tipo_poliza: text(source.tipo_poliza, 120) || "Seguro",
    score: Math.min(100, Math.max(0, Number(source.score) || 0)),
    score_label: text(source.score_label, 160),
    recomendacion: text(source.recomendacion, 1800),
    coberturas: Array.isArray(source.coberturas) ? source.coberturas.slice(0, 20).map(item => ({
      nombre: text(item?.nombre, 200),
      valor: text(item?.valor, 200),
      vigencia: text(item?.vigencia, 250),
      deducible_carencia: text(item?.deducible_carencia, 300),
      exclusiones: text(item?.exclusiones, 500),
      descripcion: text(item?.descripcion, 700)
    })) : [],
    brechas: Array.isArray(source.brechas) ? source.brechas.slice(0, 15).map(item => ({
      titulo: text(item?.titulo, 250),
      descripcion: text(item?.descripcion, 700)
    })) : []
  };
}

function reportHtml(name, analysis, copy = false) {
  const coverageRows = analysis.coberturas.map(item => `<tr>
    <td><strong>${esc(item.nombre)}</strong><br><span>${esc(item.descripcion)}</span></td>
    <td>${esc(item.valor)}</td>
    <td>${esc(item.vigencia)}</td>
    <td>${esc(item.deducible_carencia)}</td>
    <td>${esc(item.exclusiones)}</td>
  </tr>`).join("");
  const gaps = analysis.brechas.map(item =>
    `<li><strong>${esc(item.titulo)}:</strong> ${esc(item.descripcion)}</li>`
  ).join("");

  return `<!doctype html><html><body style="margin:0;background:#f2f5fa;color:#15213d;font-family:Arial,sans-serif">
  <div style="max-width:920px;margin:auto;padding:28px 16px">
    <div style="background:#000068;color:white;padding:24px 28px;border-radius:14px 14px 0 0">
      <div style="font-size:22px;font-weight:700;letter-spacing:.08em">CAPITALES FINANCIEROS</div>
      <div style="color:#9fc7f5;margin-top:6px">Resumen técnico de póliza</div>
    </div>
    <div style="background:white;padding:28px;border-radius:0 0 14px 14px">
      <p>Hola ${esc(name)},</p>
      <p>${copy ? "Te enviamos una copia del" : "Se generó un"} resumen automatizado de la póliza analizada en Capitales Financieros.</p>
      <p><strong>${esc(analysis.aseguradora)} · ${esc(analysis.tipo_poliza)}</strong><br>
      Indicador descriptivo: ${analysis.score}% — ${esc(analysis.score_label)}</p>
      <h2 style="font-size:18px;color:#000068">Cuadro de coberturas</h2>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#eaf2fc;color:#000068;text-align:left">
            <th style="padding:10px;border:1px solid #ccd8e8">Cobertura</th>
            <th style="padding:10px;border:1px solid #ccd8e8">Monto</th>
            <th style="padding:10px;border:1px solid #ccd8e8">Vigencia</th>
            <th style="padding:10px;border:1px solid #ccd8e8">Deducible / carencia</th>
            <th style="padding:10px;border:1px solid #ccd8e8">Exclusiones observables</th>
          </tr></thead>
          <tbody>${coverageRows || `<tr><td colspan="5" style="padding:12px;border:1px solid #ccd8e8">No se identificaron coberturas legibles.</td></tr>`}</tbody>
        </table>
      </div>
      <h2 style="font-size:18px;color:#000068;margin-top:24px">Puntos que conviene revisar</h2>
      <ul style="line-height:1.65">${gaps || "<li>No se identificaron puntos adicionales.</li>"}</ul>
      <h2 style="font-size:18px;color:#000068">Orientación</h2>
      <p style="line-height:1.65">${esc(analysis.recomendacion)}</p>
      <div style="margin-top:24px;padding:16px;background:#f4f7fb;border-left:4px solid #4066b3;font-size:12px;line-height:1.55">
        Este documento es un resumen automatizado, informativo y no oficial. No reemplaza el condicionado general y particular, no constituye una recomendación personalizada y no garantiza la cobertura de un siniestro.
      </div>
      <p style="margin-top:24px"><a href="${SITE_URL}" style="color:#4066b3">capitalesfinancieros.cl</a></p>
    </div>
  </div></body></html>`;
}

async function supabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
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

async function sendEmail(to, subject, html) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.error("Resend:", response.status, data.name || data.message || "unknown");
    throw new Error("email_failed");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Método no permitido." });
  if (!process.env.RESEND_API_KEY || !process.env.TURNSTILE_SECRET_KEY ||
      !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    return json(res, 503, { error: "El envío de informes aún no está configurado." });
  }

  const name = text(req.body?.fullName, 100).replace(/\s+/g, " ");
  const sendCopy = req.body?.sendCopy === true;
  const userEmail = text(req.body?.userEmail, 254).toLowerCase();
  const consent = req.body?.consent === true;
  const turnstileToken = text(req.body?.turnstileToken, 3000);
  const analysis = normalizeAnalysis(req.body?.analysis);

  if (name.length < 3) return json(res, 400, { error: "Ingresa tu nombre y apellido." });
  if (sendCopy && !emailIsValid(userEmail)) return json(res, 400, { error: "Ingresa un correo válido para recibir la copia." });
  if (!consent) return json(res, 400, { error: "Debes autorizar el envío del resumen." });
  if (!turnstileToken) return json(res, 400, { error: "Completa la verificación de seguridad." });
  if (!analysis.coberturas.length) return json(res, 400, { error: "No hay un análisis válido para enviar." });

  let reservationId;
  try {
    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: clientIp(req)
      })
    });
    const verificationResult = await verification.json();
    if (!verificationResult.success) return json(res, 400, { error: "No pudimos validar el CAPTCHA. Inténtalo nuevamente." });

    const bucket = new Date().toISOString().slice(0, 13);
    const fingerprint = crypto.createHmac("sha256", process.env.SUPABASE_SECRET_KEY)
      .update(`${clientIp(req)}|${req.headers["user-agent"] || ""}|${userEmail}`)
      .digest("hex");
    const reservation = await supabase("report_email_sends", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        request_fingerprint: fingerprint,
        send_bucket: bucket
      })
    });
    if (!reservation.ok) {
      return json(res, reservation.status === 409 ? 429 : 503, {
        error: reservation.status === 409
          ? "Ya se envió un informe desde este dispositivo durante la última hora."
          : "No fue posible validar el envío. Inténtalo nuevamente."
      });
    }
    reservationId = (await reservation.json())[0]?.id;

    const subject = `Resumen de póliza — ${analysis.aseguradora}`;
    await sendEmail(CORPORATE_EMAIL, subject, reportHtml(name, analysis, false));
    if (sendCopy) await sendEmail(userEmail, subject, reportHtml(name, analysis, true));

    return json(res, 200, { success: true, copySent: sendCopy });
  } catch (error) {
    if (reservationId) {
      await supabase(`report_email_sends?id=eq.${encodeURIComponent(reservationId)}`, {
        method: "DELETE"
      }).catch(() => {});
    }
    console.error("Report email:", error instanceof Error ? error.message : "unknown");
    return json(res, 502, { error: "No fue posible enviar el informe. Inténtalo nuevamente." });
  }
}
