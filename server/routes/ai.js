// server/routes/ai.js
// Ny, robust och säker implementation av AI-routes.
// - Försöker återanvända projektets egna wrappers (callOpenAI, askAI, analyzeImage, liveAssistOnImage).
// - Innehåller fallback-responsers så servern startar även om wrappers saknas.
// - Tydlig felhantering och loggning så vi snabbt hittar eventuella problem.
//
// Commit/ersätt hela server/routes/ai.js med denna fil.

const express = require("express");
const router = express.Router();

/**
 * Försök ladda projektets egna openai-wrappers (om de finns).
 * Stöder flera vanliga exportformer.
 */
let callOpenAI = undefined; // generic wrapper that may accept (endpoint, body) or (body)
let askAI = undefined; // simple askAI(prompt) -> string
let analyzeImage = undefined;
let liveAssistOnImage = undefined;

try {
  const openaiModule = require("../openai");
  // common shapes:
  // module.exports = { callOpenAI, askAI, analyzeImage, liveAssistOnImage }
  // or exports.callOpenAI = ...
  // or default export function
  callOpenAI = openaiModule.callOpenAI || openaiModule.default || openaiModule;
  askAI = openaiModule.askAI || openaiModule.ask || openaiModule.defaultAsk || undefined;
  analyzeImage = openaiModule.analyzeImage || undefined;
  liveAssistOnImage = openaiModule.liveAssistOnImage || undefined;
} catch (err) {
  // Om fil saknas eller exportformat är annorlunda, fortsätt ändå — vi har fallback.
  console.warn("ai.js: ../openai module could not be loaded or doesn't export expected functions. Using fallback handlers. Error:", err && err.message);
}

/* -------------------------
   Helpers
   ------------------------- */

// Säker JSON-parse utan att kasta
function safeParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

// Robust wrapper som försöker anropa callOpenAI/askAI på olika sätt
async function safeCallAI(bodyOrPrompt, opts = {}) {
  // Om callOpenAI finns, försök använda den
  if (typeof callOpenAI === "function") {
    try {
      // callOpenAI kan acceptera ("chat/completions", body) eller bara body/prompt
      if (opts.endpoint) {
        return await callOpenAI(opts.endpoint, bodyOrPrompt);
      } else {
        return await callOpenAI(bodyOrPrompt);
      }
    } catch (err) {
      console.error("safeCallAI: callOpenAI failed:", err);
      throw err;
    }
  }

  // Om askAI finns: enkel text-prompt
  if (typeof askAI === "function") {
    try {
      if (typeof bodyOrPrompt === "string") {
        return { text: await askAI(bodyOrPrompt) };
      } else if (typeof bodyOrPrompt === "object" && bodyOrPrompt.prompt) {
        return { text: await askAI(bodyOrPrompt.prompt) };
      } else {
        // fallback
        return { text: await askAI(String(bodyOrPrompt)) };
      }
    } catch (err) {
      console.error("safeCallAI: askAI failed:", err);
      throw err;
    }
  }

  // Inget AI-backend tillgängligt
  throw new Error("AI backend not configured (no callOpenAI/askAI found)");
}

// Organiserat svarformat för overlays/spareParts/risks
function formatOverlay(item) {
  // item kan vara redan ett objekt eller en sträng; försök normalisera
  if (!item) return null;
  if (typeof item === "string") {
    const parsed = safeParseJSON(item);
    if (parsed) return parsed;
    // som fallback - returnera string som label
    return { label: String(item) };
  }
  return item;
}

/* -------------------------
   Routes
   ------------------------- */

// Healthcheck
router.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ai", note: "fallback-enabled-if-no-wrappers" });
});

/**
 * POST /api/ai/chat
 * - Accepts: { prompt?: string, messages?: [{role, content}], language?: "sv"/"en"... }
 * - Returns: { answer: string }
 * This is a compact chat alias for frontends that call /chat.
 */
router.post("/chat", async (req, res) => {
  try {
    const { prompt, messages, language } = req.body || {};

    // convert messages -> simple prompt if needed
    let finalPrompt = prompt;
    if (!finalPrompt && Array.isArray(messages)) {
      finalPrompt = messages.map(m => `${m.role || "user"}: ${m.content || ""}`).join("\n");
    }
    if (!finalPrompt) {
      return res.status(400).json({ error: "prompt or messages array required" });
    }

    // build a simple body for callOpenAI if needed
    const bodyForAI = (typeof finalPrompt === "string" && finalPrompt.length < 4000)
      ? { prompt: finalPrompt, language }
      : { prompt: String(finalPrompt), language };

    const aiResp = await safeCallAI(bodyForAI, { endpoint: "chat/completions" }).catch(e => { throw e; });

    // aiResp shape may vary. Try standard fields.
    let answer = "";
    if (!aiResp) {
      answer = "AI backend returned empty response";
    } else if (typeof aiResp === "string") {
      answer = aiResp;
    } else if (aiResp.text) {
      answer = aiResp.text;
    } else if (aiResp.choices && Array.isArray(aiResp.choices) && aiResp.choices[0]) {
      // OpenAI-compatible
      if (aiResp.choices[0].message && aiResp.choices[0].message.content) {
        answer = aiResp.choices[0].message.content;
      } else if (aiResp.choices[0].text) {
        answer = aiResp.choices[0].text;
      } else {
        answer = JSON.stringify(aiResp.choices[0]);
      }
    } else {
      // final fallback
      answer = JSON.stringify(aiResp).slice(0, 2000);
    }

    return res.json({ answer: String(answer).trim() });
  } catch (err) {
    console.error("POST /chat error:", err);
    return res.status(500).json({ error: "AI chat failed", details: err && err.message });
  }
});

/**
 * POST /api/ai/image
 * - Accepts: { imageBase64: string, meta?: {...} }
 * - Returns a structured analysis: { overlays: [...], spareParts: [...], risks: {...}, raw?: ... }
 *
 * If analyzeImage() wrapper exists in project, delegates to it. Otherwise uses safeCallAI to return a friendly fallback.
 */
router.post("/image", async (req, res) => {
  try {
    const { imageBase64, meta } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 (base64 string) is required" });
    }

    // If project has dedicated function, delegate to it
    if (typeof analyzeImage === "function") {
      try {
        const result = await analyzeImage(imageBase64, meta);
        return res.json({ result });
      } catch (innerErr) {
        console.error("analyzeImage wrapper threw:", innerErr);
        // fall through to fallback processing
      }
    }

    // Fallback: ask AI to analyze and return a safe JSON structure
    const prompt = [
      "You are an image analysis assistant that outputs JSON ONLY.",
      "Given the image (base64) and optional meta, return a JSON object:",
      " { overlays: [{label,x,y,width,height,stepIndex}], spareParts: [{name,sku,confidence}], risks: {level, items:[{title,desc}]}, summary:string }",
      "If you cannot analyze the image, return an informative JSON explaining that.",
      "Respond only with JSON - no explanation text."
    ].join("\n");

    const body = {
      prompt: `${prompt}\n\nImage base64 (shortened): ${imageBase64.slice(0, 200)}...`,
      meta: meta || {}
    };

    const aiResp = await safeCallAI(body, { endpoint: "responses" }).catch(e => { throw e; });

    // aiResp may contain text or choices.
    let textOut = null;
    if (!aiResp) {
      return res.json({ overlays: [], spareParts: [], risks: { level: "unknown", items: [] }, summary: "No AI response" });
    } else if (typeof aiResp === "string") {
      textOut = aiResp;
    } else if (aiResp.text) {
      textOut = aiResp.text;
    } else if (aiResp.output && typeof aiResp.output === "string") {
      textOut = aiResp.output;
    } else if (aiResp.choices && aiResp.choices[0] && (aiResp.choices[0].message || aiResp.choices[0].text)) {
      textOut = aiResp.choices[0].message ? aiResp.choices[0].message.content || aiResp.choices[0].message : aiResp.choices[0].text;
    } else {
      textOut = JSON.stringify(aiResp);
    }

    // Extract JSON from response (AI sometimes wraps text)
    let parsed = safeParseJSON(textOut);
    if (!parsed) {
      // try to extract first {...} block
      const start = textOut.indexOf("{");
      const end = textOut.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const maybe = textOut.slice(start, end + 1);
        parsed = safeParseJSON(maybe);
      }
    }

    if (!parsed) {
      // fallback generic structure
      return res.json({
        overlays: [],
        spareParts: [],
        risks: { level: "unknown", items: [] },
        summary: "Could not parse AI JSON output. Raw: " + (String(textOut).slice(0, 1000))
      });
    }

    // Normalisera overlays/spareParts
    const overlays = Array.isArray(parsed.overlays) ? parsed.overlays.map(formatOverlay).filter(Boolean) : [];
    const spareParts = Array.isArray(parsed.spareParts) ? parsed.spareParts : [];
    const risks = parsed.risks || { level: parsed.riskLevel || "unknown", items: parsed.risks?.items || [] };
    const summary = parsed.summary || parsed.summary_text || parsed.summaryString || "";

    return res.json({ overlays, spareParts, risks, summary, raw: parsed });
  } catch (err) {
    console.error("POST /image error:", err);
    return res.status(500).json({ error: "AI image analysis failed", details: err && err.message });
  }
});

/**
 * POST /api/ai/liveassist
 * - Accepts: { imageBase64, requestType, meta }
 * - If liveAssistOnImage exists, delegates; otherwise returns a minimal fallback.
 */
router.post("/liveassist", async (req, res) => {
  try {
    const { imageBase64, requestType, meta } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    if (typeof liveAssistOnImage === "function") {
      try {
        const result = await liveAssistOnImage(imageBase64, { requestType, meta });
        return res.json(result);
      } catch (inner) {
        console.error("liveAssistOnImage wrapper threw:", inner);
        // fall through to fallback
      }
    }

    // fallback behavior: quick summarization + suggested next steps
    const prompt = [
      "You are a live assist tool. Given an image (base64) and optional meta,",
      "return JSON: { summary:string, steps:[{title,desc}], urgent:boolean }",
      "Respond with JSON only."
    ].join("\n");

    const body = {
      prompt: `${prompt}\n\nImage base64 (short): ${imageBase64.slice(0, 200)}...`,
      meta: meta || {}
    };

    const aiResp = await safeCallAI(body, { endpoint: "responses" }).catch(e => { throw e; });
    let textOut = aiResp && (aiResp.text || aiResp.output || JSON.stringify(aiResp)) || "";

    let parsed = safeParseJSON(textOut);
    if (!parsed) {
      const start = textOut.indexOf("{");
      const end = textOut.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        const maybe = textOut.slice(start, end + 1);
        parsed = safeParseJSON(maybe);
      }
    }

    if (!parsed) {
      // fallback generic reply
      return res.json({
        summary: "Live assist not fully configured; fallback response.",
        steps: [{ title: "Inspect image", desc: "Ensure the image shows the problem area clearly." }],
        urgent: false,
      });
    }

    return res.json(parsed);
  } catch (err) {
    console.error("POST /liveassist error:", err);
    return res.status(500).json({ error: "AI liveassist failed", details: err && err.message });
  }
});

/**
 * Generic endpoint to test AI call using project's wrapper
 * POST /api/ai/test-call
 * body: { prompt }
 */
router.post("/test-call", async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    try {
      const aiResp = await safeCallAI({ prompt }, { endpoint: "chat/completions" });
      return res.json({ raw: aiResp });
    } catch (err) {
      console.error("test-call failed:", err);
      return res.status(500).json({ error: "AI test-call failed", details: err && err.message });
    }
  } catch (err) {
    console.error("POST /test-call error:", err);
    return res.status(500).json({ error: "Server error", details: err && err.message });
  }
});

// Export router (CommonJS)
module.exports = router;
