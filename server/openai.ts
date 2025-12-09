// server/openai.ts
/**
 * Robust OpenAI wrapper for QuickFix backend.
 * - Läs OPENAI_API_KEY från env (obligatorisk)
 * - Stöder askAI (enkla prompts), callOpenAI (generisk), analyzeImage och liveAssistOnImage
 * - Ger tydliga felmeddelanden när API-nyckel saknas
 */

import OpenAI from "openai";

const API_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "";
const API_BASE = process.env.OPENAI_API_BASE || undefined;

let client: OpenAI | null = null;
export const isConfigured = Boolean(API_KEY);

if (isConfigured) {
  client = new OpenAI({
    apiKey: API_KEY,
    baseURL: API_BASE, // optional
  });
} else {
  console.warn(
    "[openai] OPENAI_API_KEY not set. AI features will be disabled until you set the env var."
  );
}

/**
 * askAI: enkel wrapper för textfrågor
 * @param prompt string
 * @returns string (AI-svar)
 */
export async function askAI(prompt: string, opts?: { model?: string; temperature?: number; max_tokens?: number; }) {
  if (!client) throw new Error("AI backend not configured (OPENAI_API_KEY missing)");

  const model = opts?.model || "gpt-4o-mini";
  const temperature = opts?.temperature ?? 0.7;
  const max_tokens = opts?.max_tokens ?? 800;

  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      max_tokens,
    });
    return resp?.choices?.[0]?.message?.content ?? "";
  } catch (err: any) {
    console.error("[openai][askAI] error:", err?.message ?? err);
    throw new Error("OpenAI askAI error: " + (err?.message || String(err)));
  }
}

/**
 * callOpenAI: generell gateway om du i koden vill köra chat.completions eller responses etc.
 * endpoint example: "chat/completions" or use body shaped for client.responses.create
 */
export async function callOpenAI(endpoint: string, body: any) {
  if (!client) throw new Error("AI backend not configured (OPENAI_API_KEY missing)");

  try {
    if (endpoint === "chat/completions") {
      return await client.chat.completions.create(body);
    }
    // fallback to responses.create for generic usage
    return await client.responses.create(body);
  } catch (err: any) {
    console.error("[openai][callOpenAI] error:", err?.message ?? err);
    throw new Error("OpenAI callOpenAI error: " + (err?.message || String(err)));
  }
}

/**
 * analyzeImage: enkel analys via text-call. (Du kan byta till Vision endpoints om tillgängligt.)
 * Returnerar objekt resp (rått OpenAI-svar) — route kan parsa vidare.
 */
export async function analyzeImage(imageBase64: string, opts?: { model?: string }) {
  if (!client) throw new Error("AI backend not configured (OPENAI_API_KEY missing)");
  try {
    const model = opts?.model || "gpt-4o-mini";
    // Här använder vi responses.create med en kort prompt + embedded base64 (enklare).
    const prompt = `Please analyze the image provided as base64. Return JSON with keys: whatISee, likelyIssue, steps (array), safetyNote, overlays (array), spareParts (array). Image: data:image/jpeg;base64,${imageBase64}`;
    const resp = await client.responses.create({
      model,
      input: prompt,
    });
    return resp;
  } catch (err: any) {
    console.error("[openai][analyzeImage] error:", err?.message ?? err);
    throw new Error("OpenAI analyzeImage error: " + (err?.message || String(err)));
  }
}

/**
 * liveAssistOnImage: liknande analyzeImage men kan returnera mer detaljer eller använda andra inställningar
 */
export async function liveAssistOnImage(imageBase64: string, opts?: { model?: string }) {
  return analyzeImage(imageBase64, opts);
}

export default {
  client,
  isConfigured,
  askAI,
  callOpenAI,
  analyzeImage,
  liveAssistOnImage,
};
