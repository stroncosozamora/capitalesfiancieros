import crypto from "node:crypto";

function visitorHash(req) {
  const raw = `${String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()}|${req.headers["user-agent"] || ""}`;
  return crypto.createHmac("sha256", process.env.SUPABASE_SECRET_KEY).update(raw).digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  const recommendationId = String(req.body?.recommendationId || "");
  if (!/^[0-9a-f-]{36}$/i.test(recommendationId)) return res.status(400).json({ error: "Recomendación inválida." });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return res.status(503).json({ error: "El servicio de recomendaciones aún no está configurado." });

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
  const approved = await fetch(
    `${url}/rest/v1/recommendations?select=id&id=eq.${recommendationId}&status=eq.approved&limit=1`,
    { headers }
  );
  if (!approved.ok) return res.status(500).json({ error: "No fue posible validar la recomendación." });
  if (!(await approved.json()).length) return res.status(404).json({ error: "Recomendación no disponible." });

  const response = await fetch(`${url}/rest/v1/recommendation_likes`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ recommendation_id: recommendationId, visitor_hash: visitorHash(req) })
  });
  if (response.status === 409) return res.status(200).json({ success: true, alreadyLiked: true });
  if (!response.ok) return res.status(500).json({ error: "No fue posible registrar el me gusta." });
  return res.status(201).json({ success: true, alreadyLiked: false });
}
