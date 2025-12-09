// server/openai.ts
// Minimal, robust OpenAI wrapper used by ai.js

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Generic wrapper for chat completions
export async function callOpenAI(endpoint: string, body: any) {
  if (!client) throw new Error("OpenAI client not initialized");

  const result = await client.chat.completions.create(body);
  return result;
}

// Simple text-chat helper
export async function askAI(prompt: string, opts: any = {}) {
  const model = "gpt-4o-mini";

  const messages = [
    {
      role: "system",
      content: `You are QuickFix AI, a helpful DIY and repair assistant. Respond in ${opts.language || "en"}.`
    },
    { role: "user", content: prompt }
  ];

  const completion = await client.chat.completions.create({
    model,
    messages,
    max_tokens: 600,
    temperature: 0.7
  });

  return completion.choices?.[0]?.message?.content || "";
}

// Image analysis using OpenAI vision
export async function analyzeImage(imageBase64: string) {
  if (!imageBase64) throw new Error("No image provided");

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this image and describe the problem" },
          { type: "image_url", image_url: `data:image/jpeg;base64,${imageBase64}` }
        ]
      }
    ]
  });

  return {
    description: completion.choices[0].message.content
  };
}

// Live assist wrapped in same image logic
export async function liveAssistOnImage(imageBase64: string, opts: any = {}) {
  if (!imageBase64) throw new Error("No image provided");

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `You are a live assist technician. Respond in ${opts.language || "en"}.` },
          { type: "image_url", image_url: `data:image/jpeg;base64,${imageBase64}` }
        ]
      }
    ]
  });

  return {
    advice: completion.choices[0].message.content
  };
}

export default {
  callOpenAI,
  askAI,
  analyzeImage,
  liveAssistOnImage
};
