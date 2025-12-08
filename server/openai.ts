import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🔹 Enkel text-chat
export async function askAI(prompt: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return response.choices[0].message.content ?? "";
}

// 🔹 Bildanalys – tar en base64-bild och ger beskrivning + fix-steg
export async function analyzeImage(base64Image: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `
Du är en expert på felsökning i hemmet.
1) Beskriv kort vad du ser.
2) Identifiera troliga problem.
3) Ge tydliga steg-för-steg hur man löser det.
Svara på svenska.`,
          },
          {
            type: "image_url",
            image_url: `data:image/jpeg;base64,${base64Image}`,
          },
        ],
      },
    ],
  });

  return response.choices[0].message.content ?? "";
}

// 🔹 LiveAssist – samma som bildanalys men mer fokus på "var" felet sitter
export async function liveAssistOnImage(base64Image: string) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `
Du är en visuell assistent.

1) Förklara EXAKT var problemet är på bilden (t.ex. "nere till vänster", "vid den röda kabeln", "runt skruven").
2) Beskriv hur användaren kan hitta samma punkt på sin riktiga produkt.
3) Ge sedan steg-för-steg hur man löser felet.

Svara kort och tydligt på svenska.`,
          },
          {
            type: "image_url",
            image_url: `data:image/jpeg;base64,${base64Image}`,
          },
        ],
      },
    ],
  });

  const text = response.choices[0].message.content ?? "";

  // Här kan vi senare lägga till riktiga koordinater / bounding box.
  // Nu returnerar vi bara texten.
  return {
    explanation: text,
  };
}
