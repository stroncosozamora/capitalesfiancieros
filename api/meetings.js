const CORPORATE_EMAIL = "sebastian.troncoso@zurich.cl";
const FROM = "Capitales Financieros <agenda@informes.capitalesfinancieros.cl>";
const ALLOWED_TOPICS = new Set([
  "Protección y seguros de vida",
  "Ahorro previsional",
  "Revisión de póliza",
  "Protección de salud",
  "Otro"
]);
const ALLOWED_MODES = new Set(["online", "presencial"]);
const ALLOWED_TIMES = new Set([
  "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
  "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"
]);

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function clean(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return false;
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const todayChile = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const max = new Date(`${todayChile}T12:00:00Z`);
  max.setUTCDate(max.getUTCDate() + 45);
  return value >= todayChile && value <= max.toISOString().slice(0, 10);
}

function slotIsFuture(date, time) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (date > today) return true;
  if (date < today) return false;
  const nowMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute > nowMinutes + 30;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T12:00:00Z`));
}

async function verifyTurnstile(token, remoteip) {
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: remoteip || ""
    })
  });
  const data = await response.json();
  return Boolean(data.success);
}

async function supabase(path, options = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

async function sendEmail(payload) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function emailLayout(title, content) {
  return `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Arial,sans-serif;color:#17213c">
  <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden">
    <div style="background:#000068;color:#fff;padding:24px"><b style="letter-spacing:.08em">CAPITALES FINANCIEROS</b></div>
    <div style="padding:26px"><h1 style="font-size:22px;color:#000068">${title}</h1>${content}
    <p style="margin-top:24px;font-size:12px;line-height:1.6;color:#667085">Esta solicitud aún no constituye una reunión confirmada. Sebastián se pondrá en contacto para confirmar el horario y compartir los datos de conexión o ubicación.</p></div>
  </div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const required = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];
  if (req.method === "POST") required.push("TURNSTILE_SECRET_KEY", "RESEND_API_KEY");
  if (required.some(key => !process.env[key])) {
    return json(res, 503, { error: "La agenda aún no está configurada." });
  }

  if (req.method === "GET") {
    const from = clean(req.query?.from, 10);
    const to = clean(req.query?.to, 10);
    if (!validDate(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return json(res, 400, { error: "Rango de fechas inválido." });
    }
    try {
      const query = `meeting_requests?select=meeting_date,meeting_time&status=in.(pending,confirmed)&meeting_date=gte.${from}&meeting_date=lte.${to}`;
      const response = await supabase(query);
      if (!response.ok) throw new Error(`Supabase ${response.status}`);
      const rows = await response.json();
      return json(res, 200, {
        occupied: rows.map(row => ({
          date: row.meeting_date,
          time: String(row.meeting_time).slice(0, 5)
        }))
      });
    } catch (error) {
      console.error("Meeting availability:", error instanceof Error ? error.message : "unknown");
      return json(res, 503, { error: "No fue posible consultar la disponibilidad." });
    }
  }

  if (req.method !== "POST") return json(res, 405, { error: "Método no permitido." });

  const fullName = clean(req.body?.fullName, 100);
  const email = clean(req.body?.email, 254).toLowerCase();
  const phone = clean(req.body?.phone, 30);
  const topic = clean(req.body?.topic, 80);
  const meetingMode = clean(req.body?.meetingMode, 20).toLowerCase();
  const notes = clean(req.body?.notes, 800);
  const meetingDate = clean(req.body?.meetingDate, 10);
  const meetingTime = clean(req.body?.meetingTime, 5);
  const consent = req.body?.consent === true;
  const turnstileToken = clean(req.body?.turnstileToken, 2048);

  if (fullName.length < 3) return json(res, 400, { error: "Ingresa tu nombre y apellido." });
  if (!validEmail(email)) return json(res, 400, { error: "Ingresa un correo válido." });
  if (!ALLOWED_TOPICS.has(topic)) return json(res, 400, { error: "Selecciona un motivo válido." });
  if (!ALLOWED_MODES.has(meetingMode)) return json(res, 400, { error: "Selecciona la modalidad." });
  if (!validDate(meetingDate) || !ALLOWED_TIMES.has(meetingTime) || !slotIsFuture(meetingDate, meetingTime)) {
    return json(res, 400, { error: "Selecciona un horario disponible." });
  }
  if (!consent) return json(res, 400, { error: "Debes autorizar el uso de tus datos." });
  if (!turnstileToken) return json(res, 400, { error: "Completa la verificación de seguridad." });

  try {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (!await verifyTurnstile(turnstileToken, ip)) {
      return json(res, 400, { error: "No pudimos validar la verificación de seguridad." });
    }

    const recentQuery = `meeting_requests?select=id&email=eq.${encodeURIComponent(email)}&status=in.(pending,confirmed)&created_at=gte.${encodeURIComponent(new Date(Date.now() - 86400000).toISOString())}`;
    const recent = await supabase(recentQuery);
    if (!recent.ok) throw new Error(`Supabase rate limit ${recent.status}`);
    if ((await recent.json()).length >= 3) {
      return json(res, 429, { error: "Ya existen varias solicitudes recientes asociadas a este correo. Espera la confirmación de Sebastián." });
    }

    const reservation = await supabase("meeting_requests", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        meeting_date: meetingDate,
        meeting_time: `${meetingTime}:00`,
        full_name: fullName,
        email,
        phone: phone || null,
        topic,
        meeting_mode: meetingMode,
        notes: notes || null
      })
    });
    if (!reservation.ok) {
      if (reservation.status === 409) {
        return json(res, 409, { error: "Ese horario acaba de ser solicitado. Elige otro bloque." });
      }
      throw new Error(`Supabase ${reservation.status}`);
    }
    const [created] = await reservation.json();
    const dateLabel = formatDate(meetingDate);
    const modeLabel = meetingMode === "online" ? "Reunión online" : "Reunión presencial";
    const details = `<table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb"><b>Fecha</b></td><td>${escapeHtml(dateLabel)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb"><b>Hora</b></td><td>${escapeHtml(meetingTime)} (Chile)</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb"><b>Modalidad</b></td><td>${escapeHtml(modeLabel)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb"><b>Motivo</b></td><td>${escapeHtml(topic)}</td></tr>
    </table>`;

    const corporate = await sendEmail({
      from: FROM,
      to: [CORPORATE_EMAIL],
      reply_to: email,
      subject: `Nueva solicitud de reunión · ${fullName} · ${meetingDate} ${meetingTime}`,
      html: emailLayout("Nueva solicitud de reunión", `<p><b>${escapeHtml(fullName)}</b> solicitó una reunión.</p>${details}<p><b>Correo:</b> ${escapeHtml(email)}<br><b>Teléfono:</b> ${escapeHtml(phone || "No informado")}<br><b>Comentario:</b> ${escapeHtml(notes || "Sin comentario adicional")}</p>`)
    });
    if (!corporate.ok) {
      if (created?.id) await supabase(`meeting_requests?id=eq.${created.id}`, { method: "DELETE" });
      throw new Error(`Resend corporate ${corporate.status}`);
    }

    const receipt = await sendEmail({
      from: FROM,
      to: [email],
      reply_to: CORPORATE_EMAIL,
      subject: "Recibimos tu solicitud de reunión",
      html: emailLayout("Solicitud recibida", `<p>Hola ${escapeHtml(fullName)}, recibimos tu solicitud con los siguientes datos:</p>${details}<p>Sebastián revisará la disponibilidad y te contactará para confirmar.</p>`)
    });
    if (!receipt.ok) console.error("Resend requester:", receipt.status);

    return json(res, 200, {
      success: true,
      requestId: created?.id || null,
      message: "Solicitud recibida. Sebastián confirmará el horario por correo o WhatsApp."
    });
  } catch (error) {
    console.error("Meeting request:", error instanceof Error ? error.message : "unknown");
    return json(res, 500, { error: "No fue posible registrar la solicitud. Inténtalo nuevamente." });
  }
}
