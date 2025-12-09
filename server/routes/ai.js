// server/routes/ai.js
// Robust, tolerant och säkrare implementation av AI-routes.
// - Försöker återanvända projektets egna wrappers (callOpenAI, askAI, analyzeImage, liveAssistOnImage) om de finns.
// - Innehåller tydliga felmeddelanden och fallback-logs så vi enkelt ser vad som saknas.
// - Exporterar express-router längst ner.

const express = require("express");
const router = express.Router();

// -----------------------------------------------------------------------------
// Försök ladda projektets openai-wrapper (om den finns) och mappa vanliga exports.
// Denna logik gör att filen fungerar även om wrappern inte exporterar exakt samma namn.
// -----------------------------------------------------------------------------
let callOpenAI = undefined;
let askAI = undefined;
let analyzeImage = undefined;
let liveAssistOnImage = undefined;

try {
  // försök använda CommonJS require
  const openaiModule = require("../openai");

  // Det kan exporteras som: module.exports = { callOpenAI, askAI, ... }
  // eller exports.default = { ... } vid transpilerade versioner.
  const mod = openaiModule && openaiModule.default ? openaiModule.default : openaiModule;

  // Trycka in olika varianter
  callOpenAI = mod.callOpenAI || mod.callOpenAIAsync || mod.callOpenAIRequest || undefined;
  askAI = mod.askAI || mod.ask || mod.simpleAsk || undefined;
  analyzeImage = mod.analyzeImage || mod.imageAnalyze || undefined;
  liveAssistOnImage = mod.liveAssistOnImage || mod.liveAssist || undefined;

  // Om mod själv är en function (t.ex. callOpenAI som default export)
  if (!callOpenAI && typeof mod === "function") {
    callOpenAI = mod;
  }

  console.log("ai.js: openai wrapper loaded (some functions mapped).");
} catch (err) {
  // Om require misslyckas så kör vi fallback - vi loggar och fortsätter.
  console.warn("ai.js: ../openai wrapper not loaded or not found. Falling back. Err:", err?.message || err);
}

// -----------------------------------------------------------------------------
// Hjälpare
// -----------------------------------------------------------------------------
function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function makeErrorResponse(res, code, message, details) {
  return res.status(code).json({ error: message, details: details || null });
}

// En liten wrapper som försöker anropa callOpenAI om den finns, annars askAI, annars kastar.
async function askAIWithFallback(promptOrBody) {
  if (callOpenAI) {
    // Förväntar sig (endpoint, body) eller (body) beroende på wrapper.
    try {
      // Om user skickar en string prompt -> skicka som body for chat.
      if (typeof promptOrBody === "string") {
        const body = {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: promptOrBody }],
          temperature: 0.7,
        };
        // many wrappers expect (endpoint, body)
        if (callOpenAI.length >= 2) {
          return await callOpenAI("chat/completions", body);
        } else {
          return await callOpenAI(body);
        }
      } else {
        // promptOrBody is object (body)
        if (callOpenAI.length >= 2) {
          return await callOpenAI("chat/completions", promptOrBody);
        } else {
          return await callOpenAI(promptOrBody);
        }
      }
    } catch (err) {
      throw new Error("callOpenAI failed: " + (err?.message || err));
    }
  }

  if (askAI) {
    try {
      if (typeof promptOrBody === "string") {
        return await askAI(promptOrBody);
      } else {
        // if askAI only accepts string, extract sensible text
        const text = promptOrBody.prompt || (promptOrBody.messages && promptOrBody.messages.map(m => `${m.role}: ${m.content}`).join("\n")) || JSON.stringify(promptOrBody);
        return await askAI(text);
      }
    } catch (err) {
      throw new Error("askAI failed: " + (err?.message || err));
    }
  }

  // Om varken callOpenAI eller askAI finns -> kasta så vi kan hantera upstream.
  throw new Error("AI backend not configured (no callOpenAI/askAI available)");
}

// -----------------------------------------------------------------------------
// ROUTES
// -----------------------------------------------------------------------------

// Simple health-check for this AI router
router.get("/health", (req, res) => {
  const note = (callOpenAI || askAI) ? "wrappers-present" : "fallback-enabled-if-no-wrappers";
  res.json({ status: "ok", service: "ai", note });
});

// POST /api/ai/text  -> text-only quick endpoint (body: { prompt: "..." })
router.post("/text", async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") return makeErrorResponse(res, 400, "prompt is required");

    const answer = await askAIWithFallback(prompt);
    return res.json({ answer });
  } catch (err) {
    console.error("ai.js /text error:", err);
    return makeErrorResponse(res, 500, "AI text request failed", err?.message || String(err));
  }
});

// POST /api/ai/chat -> messages array in body (OpenAI/chat shape)
router.post("/chat", async (req, res) => {
  try {
    const { messages, language = "en", imageBase64, videoFileName } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return makeErrorResponse(res, 400, "Messages array is required");
    }

    // Build request body in a way callOpenAI/askAI accepts
    const body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are QuickFix AI, a helpful DIY and home repair assistant. Respond in ${language}. Keep answers short and practical.` },
        ...messages.map(m => ({ role: m.role || "user", content: m.content || "" }))
      ],
      temperature: 0.7,
      max_tokens: 800,
    };

    // If image provided, attach simple image hint (some wrappers may handle it)
    if (imageBase64) {
      body.attachments = body.attachments || [];
      body.attachments.push({ type: "image_base64", data: imageBase64 });
    }

    // Call the AI wrapper
    const completion = await askAIWithFallback(body);

    // Attempt to normalize response - different wrappers return different shapes
    let answer = "";
    if (!completion) {
      return makeErrorResponse(res, 502, "AI chat failed", "no response from backend");
    }

    // Common shapes: { choices: [{ message: { content: "..." } }] } or string
    if (typeof completion === "string") {
      answer = completion;
    } else if (completion?.choices && Array.isArray(completion.choices) && completion.choices.length > 0) {
      const c = completion.choices[0];
      answer = (c.message && c.message.content) || c.text || c.content || "";
    } else if (completion?.result) {
      answer = completion.result;
    } else if (completion?.answer) {
      answer = completion.answer;
    } else {
      // fallback to JSON stringify
      answer = JSON.stringify(completion).slice(0, 2000);
    }

    return res.json({ answer });
  } catch (err) {
    console.error("ai.js /chat error:", err);
    return makeErrorResponse(res, 500, "AI chat failed", err?.message || String(err));
  }
});

// POST /api/ai/image -> analyze an image (body: { imageBase64: "data..." })
router.post("/image", async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) return makeErrorResponse(res, 400, "imageBase64 is required");

    if (!analyzeImage) {
      // If no analyzeImage wrapper, try using askAIWithFallback with prompt describing image.
      try {
        const fallbackPrompt = `Analyze this image (base64 omitted) and provide short repair guidance.`;
        const fallbackAnswer = await askAIWithFallback(fallbackPrompt);
        return res.json({ result: fallbackAnswer, fallback: true });
      } catch (err) {
        return makeErrorResponse(res, 503, "AI service is not configured. Please check your OpenAI API key.", err?.message || String(err));
      }
    }

    const result = await analyzeImage(imageBase64);
    return res.json({ result });
  } catch (err) {
    console.error("ai.js /image error:", err);
    return makeErrorResponse(res, 500, "AI image request failed", err?.message || String(err));
  }
});

// POST /api/ai/liveassist -> visual troubleshooting endpoint (image => structured JSON)
// body: { imageBase64: "...", language: "en" }
router.post("/liveassist", async (req, res) => {
  try {
    const { imageBase64, language = "en" } = req.body || {};
    if (!imageBase64) return makeErrorResponse(res, 400, "imageBase64 is required");

    if (!liveAssistOnImage) {
      // fallback: use askAIWithFallback and ask for JSON response
      const body = {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: `You are LiveAssist: analyze the image and return ONLY a JSON object with fields: whatISee, likelyIssue, steps (array), safetyNote, overlays (array). Respond in ${language}` },
          { role: "user", content: `Image provided (base64 omitted). Provide structured JSON only.` }
        ],
        temperature: 0.0,
        max_tokens: 1200,
      };
      try {
        const completion = await askAIWithFallback(body);
        const text = typeof completion === "string" ? completion : (completion?.choices?.[0]?.message?.content || JSON.stringify(completion));
        // Try parse JSON
        const parsed = safeJsonParse(text);
        if (parsed) return res.json({ result: parsed, fallback: true });
        // If not JSON, return the raw text as fallback
        return res.json({ result: text, fallback: true });
      } catch (err) {
        return makeErrorResponse(res, 503, "AI liveassist not configured (no wrapper).", err?.message || String(err));
      }
    }

    const structured = await liveAssistOnImage(imageBase64, language);
    return res.json({ result: structured });
  } catch (err) {
    console.error("ai.js /liveassist error:", err);
    return makeErrorResponse(res, 500, "AI liveassist failed", err?.message || String(err));
  }
});

// -----------------------------------------------------------------------------
// Export the router
// -----------------------------------------------------------------------------
module.exports = router;
