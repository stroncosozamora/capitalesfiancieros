export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { fileData, mediaType } = req.body;

    const isImage = mediaType.startsWith("image/");
    const contentBlock = isImage
      ? { type: "image", source: { type: "base64", media_type: mediaType, data: fileData } }
      : { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileData } };

    const prompt = `Eres un experto en pólizas de seguros en Chile. Analiza esta póliza y responde ÚNICAMENTE con un JSON válido sin texto adicional ni backticks.

Estructura exacta:
{
  "aseguradora": "nombre o Desconocida",
  "tipo_poliza": "tipo detectado",
  "score": número 0-100,
  "score_label": "etiqueta corta",
  "coberturas": [{"nombre":"","valor":"","descripcion":""}],
  "brechas": [{"titulo":"","descripcion":""}],
  "comparacion": {"actual":["punto débil 1","punto débil 2","punto débil 3"],"mejor":["mejora posible 1","mejora posible 2","mejora posible 3"]},
  "recomendacion": "2-3 oraciones como asesor de Capitales Financieros hablando al cliente"
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: [contentBlock, { type: "text", text: prompt }] }]
      })
    });

    const data = await response.json();

    if (!response.ok || !data.content) {
      console.error("API Error:", JSON.stringify(data));
      return res.status(500).json({ error: data.error?.message || "Error de API Anthropic" });
    }

    const raw = data.content.map(b => b.text || "").join("");
    const result = JSON.parse(raw.replace(/```json|```/g, "").trim());

    return res.status(200).json(result);
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
