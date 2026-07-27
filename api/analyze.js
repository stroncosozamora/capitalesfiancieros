const MODEL = "gpt-5.6-terra";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    aseguradora: { type: "string" },
    tipo_poliza: { type: "string" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    score_label: { type: "string" },
    coberturas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          nombre: { type: "string" },
          valor: { type: "string" },
          descripcion: { type: "string" }
        },
        required: ["nombre", "valor", "descripcion"]
      }
    },
    brechas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          titulo: { type: "string" },
          descripcion: { type: "string" }
        },
        required: ["titulo", "descripcion"]
      }
    },
    comparacion: {
      type: "object",
      additionalProperties: false,
      properties: {
        actual: { type: "array", items: { type: "string" } },
        mejor: { type: "array", items: { type: "string" } }
      },
      required: ["actual", "mejor"]
    },
    recomendacion: { type: "string" }
  },
  required: [
    "aseguradora",
    "tipo_poliza",
    "score",
    "score_label",
    "coberturas",
    "brechas",
    "comparacion",
    "recomendacion"
  ]
};

function outputText(data) {
  return (data.output || [])
    .filter(item => item.type === "message")
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text || "")
    .join("");
}

function base64Bytes(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido." });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "El analizador aún no está configurado." });
  }

  try {
    const fileData = String(req.body?.fileData || "");
    const mediaType = String(req.body?.mediaType || "").toLowerCase();

    if (!fileData || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
      return res.status(400).json({ error: "Adjunta una póliza en formato PDF, JPG o PNG." });
    }
    if (base64Bytes(fileData) > MAX_FILE_BYTES) {
      return res.status(413).json({ error: "El archivo supera el máximo permitido de 10 MB." });
    }

    const documentInput = mediaType === "application/pdf"
      ? {
          type: "input_file",
          filename: "poliza.pdf",
          file_data: `data:application/pdf;base64,${fileData}`,
          detail: "low"
        }
      : {
          type: "input_image",
          image_url: `data:${mediaType};base64,${fileData}`,
          detail: "high"
        };

    const instructions = `Actúa como analista técnico de pólizas de seguros comercializadas en Chile.
Tu tarea es explicar el documento, no emitir una recomendación legal, previsional ni una promesa de cobertura.

Reglas:
- Usa únicamente información visible o extraída del documento.
- No inventes montos, coberturas, exclusiones, vigencias ni condiciones.
- Cuando un dato no sea legible o no esté informado, indica "No identificado en el documento".
- Distingue coberturas, límites, deducibles, carencias, exclusiones y condiciones relevantes.
- El score mide claridad y amplitud de protección observable en el documento; no representa una calificación oficial ni garantiza que la póliza sea adecuada para la persona.
- Las brechas son puntos que conviene revisar con un agente, no afirmaciones de que falte protección.
- Mantén un lenguaje claro, profesional y prudente, adecuado para Chile.
- La recomendación final debe invitar a revisar necesidades y condiciones con Sebastián de Capitales Financieros, sin presionar una contratación.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        instructions,
        input: [{
          role: "user",
          content: [
            documentInput,
            {
              type: "input_text",
              text: "Analiza la póliza adjunta y entrega el resultado solicitado."
            }
          ]
        }],
        reasoning: { effort: "low" },
        max_output_tokens: 3500,
        text: {
          format: {
            type: "json_schema",
            name: "analisis_poliza",
            strict: true,
            schema: analysisSchema
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI analyze:", response.status, data.error?.code || data.error?.type);
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429
          ? "El analizador alcanzó temporalmente su límite de uso. Inténtalo nuevamente."
          : "No fue posible analizar la póliza en este momento."
      });
    }

    const raw = outputText(data);
    if (!raw) return res.status(502).json({ error: "El análisis no entregó un resultado utilizable." });

    return res.status(200).json(JSON.parse(raw));
  } catch (error) {
    console.error("Analyze:", error instanceof Error ? error.message : "unknown");
    return res.status(500).json({ error: "Ocurrió un error al procesar la póliza." });
  }
}
