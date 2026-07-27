const MODEL = "gpt-5.6-terra";

function outputText(data) {
  return (data.output || [])
    .filter(item => item.type === "message")
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text || "")
    .join("");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "El asistente aún no está configurado." });
  }

  try {
    const systemPrompt = String(req.body?.systemPrompt || "").slice(0, 6000);
    const messages = Array.isArray(req.body?.messages)
      ? req.body.messages
          .slice(-8)
          .filter(message => ["user", "assistant"].includes(message?.role))
          .map(message => ({
            role: message.role,
            content: String(message.content || "").slice(0, 2000)
          }))
          .filter(message => message.content)
      : [];

    if (!messages.length) return res.status(400).json({ error: "Escribe una pregunta válida." });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: `${systemPrompt}

Reglas obligatorias:
- Responde solamente sobre el análisis de la póliza proporcionado.
- No inventes coberturas ni confirmes que un siniestro será cubierto.
- Si faltan antecedentes, dilo expresamente.
- No entregues asesoría legal, médica, tributaria ni previsional personalizada.
- Invita a revisar el condicionado y resolver dudas con Sebastián cuando corresponda.`,
        input: messages,
        reasoning: { effort: "low" },
        max_output_tokens: 700
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI chat:", response.status, data.error?.code || data.error?.type);
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429
          ? "El asistente alcanzó temporalmente su límite de uso."
          : "No fue posible responder en este momento."
      });
    }

    const reply = outputText(data).trim();
    if (!reply) return res.status(502).json({ error: "El asistente no entregó una respuesta." });

    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Chat:", error instanceof Error ? error.message : "unknown");
    return res.status(500).json({ error: "Ocurrió un error al responder." });
  }
}
