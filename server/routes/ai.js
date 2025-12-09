const express = require("express");
const OpenAI = require("openai");
const { pool } = require("../db");
const { authMiddleware, optionalAuth } = require("../middleware/auth");
const { awardXp } = require("../services/xp");

const router = express.Router();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

async function callOpenAI(endpoint, body) {
  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured");
  }

  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "OpenAI API error");
  }

  return response.json();
}

router.post("/chat", async (req, res) => {
  try {
    const { messages = [], language } = req.body || {};

    const languageNames = {
      en: "English",
      sv: "Swedish",
      ar: "Arabic",
      de: "German",
      fr: "French",
    };

    const languageName = languageNames[language] || "English";

    const systemPrompt = `You are QuickFix AI, a helpful DIY and home repair assistant.
You give short, practical instructions.
Respond in ${languageName}.`;

    const body = {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.7,
      max_tokens: 500,
    };

    const completion = await callOpenAI("chat/completions", body);
    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";

    return res.json({ answer });

  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({
      error: "Failed to get AI response",
      details: error.message,
    });
  }
});



    const answer = completion.choices[0].message.content.trim();

    res.json({ answer });
  } catch (error) {
    console.error("Ask AI error:", error);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

/**
 * AI Chat endpoint - Fixed to properly handle:
 * 1. Text-only messages with conversation history
 * 2. Image uploads using OpenAI Vision (GPT-4o)
 * 3. Video context (asks user to describe since we can't process video directly)
 *
 * FIX: Ensured proper message formatting for OpenAI API and added
 * better error handling with descriptive error messages.
 */
router.post("/chat", optionalAuth, async (req, res) => {
  try {
    const { messages, language = "en", imageBase64, videoFileName } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array is required" });
    }

    if (!openai) {
      return res.json({
        answer:
          "AI service is not configured. Please check your OpenAI API key.",
      });
    }

    const languageNames = {
      en: "English",
      sv: "Swedish",
      ar: "Arabic",
      de: "German",
      fr: "French",
      ru: "Russian",
    };
    const languageName = languageNames[language] || "English";

    const systemPrompt = `You are QuickFix AI, an experienced and friendly DIY technician assistant for a mobile app called QuickFix.

## Your Personality:
- You are like a helpful neighbor who happens to be a skilled handyman/technician
- Warm, patient, and encouraging - you make users feel confident they can fix things
- You speak naturally, not like a robot or manual

## Smart Question Flow (CRITICAL):
Before giving a full solution, you MUST gather enough information by asking 1-2 targeted follow-up questions. This helps you understand the exact problem.

### When to ask questions:
- The user describes a problem but details are missing (location, symptoms, what they've tried)
- You need to see the issue to diagnose it properly - ask for a photo
- The problem could have multiple causes and you need to narrow it down
- You're unsure about the user's skill level or available tools

### How to structure your response:
1. First, acknowledge their problem briefly (1-2 sentences showing you understand)
2. Then ask 1-2 specific, helpful questions to diagnose better
3. Keep it conversational - like a real technician would ask

### Examples of good follow-up questions:
- "Is the leak coming from the faucet handle, the base, or underneath the sink?"
- "Can you send me a photo of where you see the water dripping?"
- "How long has this been happening? Does it leak constantly or only when the water is running?"
- "Have you noticed any other issues, like low water pressure or strange sounds?"
- "What type of faucet do you have - is it a single handle or two handles?"

### When to give a direct solution (skip questions):
- The user has already provided very detailed information
- They've answered your previous questions and you have enough context
- It's a simple, obvious fix with only one possible solution
- They explicitly say "just tell me how to fix it"

## Response Guidelines:
- Keep responses concise (under 300 words)
- When you DO give solutions, break them into clear numbered steps
- Always mention if something requires professional help or is dangerous
- If user shares an image, analyze it carefully and use what you see to give specific advice
- Respond in ${languageName}

## Image Requests:
When a photo would really help diagnose the issue, explicitly ask:
"Could you take a photo of [specific thing]? That would help me see exactly what's going on."

Remember: A real technician asks questions first, diagnoses second, and fixes last. You should do the same!`;

    const formattedMessages = [{ role: "system", content: systemPrompt }];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || !msg.role) continue;

      let messageContent = "";
      if (typeof msg.content === "string") {
        messageContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        messageContent = msg.content
          .map((c) => {
            if (typeof c === "string") return c;
            if (c?.type === "text" && c?.text) return c.text;
            if (c?.type === "output_text" && c?.text) return c.text;
            return "";
          })
          .filter(Boolean)
          .join(" ");
      } else if (msg.content && typeof msg.content === "object") {
        messageContent =
          msg.content.text || msg.content.output || JSON.stringify(msg.content);
      }

      const isLastUserMessage =
        i === messages.length - 1 && msg.role === "user";

      if (isLastUserMessage && imageBase64) {
        formattedMessages.push({
          role: "user",
          content: [
            {
              type: "text",
              text:
                messageContent ||
                "What can you see in this image? Please help me fix this problem.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "auto",
              },
            },
          ],
        });
      } else if (isLastUserMessage && videoFileName) {
        const videoMessage = `${messageContent}\n\n[Note: The user has uploaded a video file named "${videoFileName}". Since I cannot watch videos directly, please ask the user to describe what's shown in the video, or suggest they take a screenshot of the key moment showing the problem.]`;
        formattedMessages.push({
          role: msg.role,
          content: videoMessage,
        });
      } else {
        formattedMessages.push({
          role: msg.role,
          content: messageContent,
        });
      }
    }

    console.log("[AI Chat] Processing request:", {
      messageCount: formattedMessages.length,
      hasImage: !!imageBase64,
      hasVideo: !!videoFileName,
      model: imageBase64 ? "gpt-4o" : "gpt-4o-mini",
    });

    const completion = await openai.chat.completions.create({
      model: imageBase64 ? "gpt-4o" : "gpt-4o-mini",
      messages: formattedMessages,
      temperature: 0.7,
      max_tokens: 800,
    });

    const answer = completion.choices[0]?.message?.content?.trim();

    if (!answer) {
      return res.status(500).json({ error: "No response from AI" });
    }

    // Award XP for successful AI chat message (non-blocking)
    if (req.userId) {
      awardXp(req.userId, "ai_chat_message").catch((err) => {
        console.log("[XP] Non-blocking XP award error:", err.message);
      });
    }

    res.json({ answer });
  } catch (error) {
    console.error("Chat error:", error.message || error);
    const errorMessage = error.message?.includes("API key")
      ? "OpenAI API key is invalid or expired"
      : "Failed to get AI response. Please try again.";
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * LiveAssist endpoint - Visual troubleshooting with AI
 * Accepts an image and returns a structured repair guide
 */
router.post("/liveassist", optionalAuth, async (req, res) => {
  try {
    const { imageBase64, language = "en" } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "Image is required" });
    }

    if (!openai) {
      return res.status(503).json({
        error:
          "AI service is not configured. Please check your OpenAI API key.",
      });
    }

    const languageNames = {
      en: "English",
      sv: "Swedish",
      ar: "Arabic",
      de: "German",
      fr: "French",
      ru: "Russian",
    };
    const languageName = languageNames[language] || "English";

    const systemPrompt = `You are LiveAssist, an expert visual troubleshooting assistant with integrated RiskScanner AI for the QuickFix app.

Your job is to analyze images of home repair problems and provide:
1. Instant, actionable repair guidance with visual annotations
2. Safety and structural risk assessment (RiskScanner)

## Your Personality:
- You're a friendly, experienced technician who can diagnose problems from photos
- Confident but not condescending - you explain things clearly
- Safety-conscious - always identify and highlight potential dangers

## Response Structure (MUST FOLLOW):
When you see an image, respond with EXACTLY this JSON format. Return ONLY valid JSON, no markdown:

{
  "whatISee": "1-2 sentences describing what's visible in the image",
  "likelyIssue": "1 sentence identifying the most probable problem",
  "steps": [
    {"stepNumber": 1, "text": "First step description"},
    {"stepNumber": 2, "text": "Second step description"},
    {"stepNumber": 3, "text": "Third step description"}
  ],
  "safetyNote": "Optional safety warning, or empty string if none",
  "overlays": [
    {
      "x": 0.3,
      "y": 0.2,
      "width": 0.4,
      "height": 0.3,
      "stepIndex": 1,
      "label": "Brief label for this area"
    }
  ],
  "riskLevel": "low",
  "riskSummary": "Brief overall assessment of safety risks",
  "risks": [
    {
      "label": "Risk name, e.g. Water near electrical outlet",
      "severity": "high",
      "recommendation": "Specific safety action to take"
    }
  ],
  "riskOverlays": [
    {
      "x": 0.5,
      "y": 0.3,
      "width": 0.2,
      "height": 0.2,
      "riskLabel": "Brief label for danger zone",
      "severity": "high"
    }
  ],
  "spareParts": [
    {
      "name": "Standard 1/2 inch ball valve",
      "category": "valve",
      "description": "Controls water flow in the supply line",
      "specs": ["1/2 inch diameter", "Brass construction", "Quarter-turn operation", "Rated for hot and cold water"],
      "compatibility": "Fits standard residential water supply lines",
      "priority": "primary",
      "notes": "Bring old valve to store for exact match",
      "overlayIndex": null
    }
  ]
}

## Overlay Guidelines (for repair overlays):
- Provide 1-3 overlay regions highlighting the key problem areas in the image
- Use NORMALIZED coordinates (0-1 range based on image dimensions):
  - x: horizontal position from left edge (0 = left, 1 = right)
  - y: vertical position from top edge (0 = top, 1 = bottom)
  - width: width of region as fraction of image width
  - height: height of region as fraction of image height
- stepIndex links the overlay to a specific repair step (1-indexed), or null if just highlighting the problem area
- label is a very brief description (2-4 words) of what's highlighted
- If you cannot determine specific coordinates, return an empty overlays array []

## RiskScanner Guidelines:
- riskLevel: Assess overall risk as "low", "medium", or "high"
  - low: Safe for DIY, no immediate dangers
  - medium: Caution needed, some hazards present
  - high: Dangerous, professional help recommended or immediate action required
- riskSummary: 1-2 sentences summarizing the overall safety situation
- risks: Array of specific identified risks. Look for:
  - Electrical hazards (exposed wiring, water near outlets, damaged cords)
  - Water damage (leaks, flooding, moisture)
  - Mold or fungal growth
  - Structural damage (cracks, rot, sagging)
  - Fire hazards (flammable materials near heat, damaged gas lines)
  - Chemical hazards (asbestos, lead paint, toxic substances)
  - Unsafe tool usage or positioning
  - Slip/fall hazards
- Each risk has: label (what it is), severity (low/medium/high), recommendation (what to do)
- riskOverlays: Highlight dangerous areas with coordinates (same format as overlays)
  - Use these to show WHERE the risks are in the image
  - If you cannot determine specific coordinates, return an empty array []

## Spare Parts Finder Guidelines:
- spareParts: Array of replacement parts that may be needed for the repair
- Identify 1-3 key mechanical/technical parts visible in the image that are involved in the problem
- For each part, provide:
  - name: Specific name with size if visible (e.g. "Standard 1/2 inch ball valve")
  - category: Type of part (valve, faucet cartridge, O-ring, connector, hose, pipe fitting, filter, switch, gasket, seal, washer, etc.)
  - description: Brief explanation of what this part does in the system
  - specs: Array of key specifications (size, thread type, material, pressure/temperature rating if relevant)
  - compatibility: What it fits or works with
  - priority: "primary" for the main part to replace, "optional" for secondary parts
  - notes: Helpful hints for finding/buying the right part
  - overlayIndex: Index of the repair overlay that shows this part (1-indexed), or null if not shown
- Focus on generic part descriptions and specifications, NOT specific brands or prices
- If no clear parts can be identified, return an empty spareParts array []

## Guidelines:
- Be specific based on what you actually see in the image
- Keep steps practical and actionable (3-6 steps total)
- If you can't clearly identify the problem, say what you need to see better
- If the repair is dangerous or complex, recommend a professional
- ALWAYS assess risks even if they seem minor - users need to know
- ALWAYS try to identify spare parts when a mechanical/plumbing/electrical component is visible
- Respond in ${languageName}
- IMPORTANT: Return ONLY the JSON object, no additional text or markdown`;

    console.log("[LiveAssist] Processing image analysis request");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please analyze this image and help me fix the problem.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const answer = completion.choices[0]?.message?.content?.trim();

    if (!answer) {
      return res.status(500).json({ error: "No response from AI" });
    }

    // Parse the JSON response
    let summary = "";
    let possibleIssue = "";
    let steps = [];
    let safetyNote = "";
    let overlays = [];
    // RiskScanner fields
    let riskLevel = "low";
    let riskSummary = "";
    let risks = [];
    let riskOverlays = [];
    // Spare Parts Finder fields
    let spareParts = [];

    try {
      // Try to extract JSON from the response (handle cases where AI adds markdown)
      let jsonStr = answer;

      // Remove markdown code blocks if present
      const jsonMatch = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      // Try to find JSON object in the response
      const jsonObjectMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        jsonStr = jsonObjectMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      summary = parsed.whatISee || "";
      possibleIssue = parsed.likelyIssue || "";
      safetyNote = parsed.safetyNote || "";

      // Parse steps
      if (Array.isArray(parsed.steps)) {
        steps = parsed.steps.map((step, idx) => ({
          stepNumber: step.stepNumber || idx + 1,
          text: step.text || "",
        }));
      }

      // Parse overlays with validation
      if (Array.isArray(parsed.overlays)) {
        overlays = parsed.overlays
          .filter((o) => typeof o.x === "number" && typeof o.y === "number")
          .map((o) => ({
            x: Math.max(0, Math.min(1, o.x)),
            y: Math.max(0, Math.min(1, o.y)),
            width: Math.max(0.05, Math.min(1, o.width || 0.2)),
            height: Math.max(0.05, Math.min(1, o.height || 0.2)),
            stepIndex: typeof o.stepIndex === "number" ? o.stepIndex : null,
            label: o.label || "",
          }));
      }

      // Parse RiskScanner fields
      if (
        parsed.riskLevel &&
        ["low", "medium", "high"].includes(parsed.riskLevel.toLowerCase())
      ) {
        riskLevel = parsed.riskLevel.toLowerCase();
      }

      riskSummary = parsed.riskSummary || "";

      // Parse risks array
      if (Array.isArray(parsed.risks)) {
        risks = parsed.risks
          .filter((r) => r.label)
          .map((r) => ({
            label: r.label || "",
            severity: ["low", "medium", "high"].includes(
              r.severity?.toLowerCase(),
            )
              ? r.severity.toLowerCase()
              : "medium",
            recommendation: r.recommendation || "",
          }));
      }

      // Parse risk overlays with validation
      if (Array.isArray(parsed.riskOverlays)) {
        riskOverlays = parsed.riskOverlays
          .filter((o) => typeof o.x === "number" && typeof o.y === "number")
          .map((o) => ({
            x: Math.max(0, Math.min(1, o.x)),
            y: Math.max(0, Math.min(1, o.y)),
            width: Math.max(0.05, Math.min(1, o.width || 0.15)),
            height: Math.max(0.05, Math.min(1, o.height || 0.15)),
            riskLabel: o.riskLabel || "",
            severity: ["low", "medium", "high"].includes(
              o.severity?.toLowerCase(),
            )
              ? o.severity.toLowerCase()
              : "medium",
          }));
      }

      // Parse spare parts with validation
      // overlayIndex is 1-based (matches the displayed marker numbers in the UI)
      if (Array.isArray(parsed.spareParts)) {
        const maxOverlayIndex = overlays.length; // Max valid 1-based index
        spareParts = parsed.spareParts
          .filter((p) => p.name)
          .map((p) => {
            // Coerce and validate overlayIndex to finite positive integer or null
            // overlayIndex is 1-based to match UI display (marker #1, #2, etc.)
            let validOverlayIndex = null;
            if (p.overlayIndex !== null && p.overlayIndex !== undefined) {
              const parsedIdx =
                typeof p.overlayIndex === "number"
                  ? p.overlayIndex
                  : Number(p.overlayIndex);
              // Must be a positive integer within valid range (1 to number of overlays)
              if (
                Number.isFinite(parsedIdx) &&
                parsedIdx >= 1 &&
                parsedIdx <= maxOverlayIndex
              ) {
                validOverlayIndex = Math.floor(parsedIdx);
              }
            }

            return {
              name: p.name || "",
              category: p.category || "part",
              description: p.description || "",
              specs: Array.isArray(p.specs)
                ? p.specs.filter((s) => typeof s === "string")
                : [],
              compatibility: p.compatibility || "",
              priority: ["primary", "optional"].includes(
                p.priority?.toLowerCase(),
              )
                ? p.priority.toLowerCase()
                : "optional",
              notes: p.notes || "",
              overlayIndex: validOverlayIndex,
            };
          });
      }

      console.log("[LiveAssist] Parsed JSON response successfully");
    } catch (parseError) {
      console.log(
        "[LiveAssist] JSON parse failed, falling back to text parsing:",
        parseError.message,
      );

      // Fallback to legacy text parsing for backward compatibility
      const seeMatch = answer.match(
        /\*\*What I See:\*\*\s*\n?([\s\S]*?)(?=\n\*\*|$)/i,
      );
      if (seeMatch) {
        summary = seeMatch[1].trim();
      }

      const issueMatch = answer.match(
        /\*\*Likely Issue:\*\*\s*\n?([\s\S]*?)(?=\n\*\*|$)/i,
      );
      if (issueMatch) {
        possibleIssue = issueMatch[1].trim();
      }

      const stepsMatch = answer.match(
        /\*\*Steps to Fix:\*\*\s*\n?([\s\S]*?)(?=\n\*\*Safety|$)/i,
      );
      if (stepsMatch) {
        const stepsText = stepsMatch[1].trim();
        const stepLines = stepsText
          .split("\n")
          .filter((line) => line.match(/^\d+\./));
        steps = stepLines.map((line, idx) => ({
          stepNumber: idx + 1,
          text: line.replace(/^\d+\.\s*/, "").trim(),
        }));
      }

      const safetyMatch = answer.match(
        /\*\*Safety Note:\*\*\s*\n?([\s\S]*?)$/i,
      );
      if (safetyMatch) {
        safetyNote = safetyMatch[1].trim();
      }

      // No overlays, risk data, or spare parts in fallback mode
      overlays = [];
      riskLevel = "low";
      riskSummary = "";
      risks = [];
      riskOverlays = [];
      spareParts = [];
    }

    console.log("[LiveAssist] Analysis complete:", {
      hasSummary: !!summary,
      hasIssue: !!possibleIssue,
      stepsCount: steps.length,
      overlaysCount: overlays.length,
      riskLevel,
      risksCount: risks.length,
      riskOverlaysCount: riskOverlays.length,
      sparePartsCount: spareParts.length,
    });

    // Award XP for successful LiveAssist scan (non-blocking)
    if (req.userId) {
      awardXp(req.userId, "liveassist_scan").catch((err) => {
        console.log("[XP] Non-blocking XP award error:", err.message);
      });
    }

    res.json({
      success: true,
      analysis: {
        summary,
        possibleIssue,
        steps,
        safetyNote,
        overlays,
        riskLevel,
        riskSummary,
        risks,
        riskOverlays,
        spareParts,
        rawResponse: answer,
      },
    });
  } catch (error) {
    console.error("LiveAssist error:", error.message || error);
    const errorMessage = error.message?.includes("API key")
      ? "OpenAI API key is invalid or expired"
      : "Failed to analyze image. Please try again.";
    res.status(500).json({ error: errorMessage });
  }
});

router.post("/suggest-tags", authMiddleware, async (req, res) => {
  try {
    const { title, description, category } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    if (!OPENAI_API_KEY) {
      const defaultTags = ["DIY", "fix", "home", category || "repair"].filter(
        Boolean,
      );
      return res.json({ tags: defaultTags });
    }

    const prompt = `Generate 5-8 relevant tags for a fix-it/how-to video.
Title: ${title}
Description: ${description || "No description"}
Category: ${category || "general"}

Return only a JSON array of lowercase tags, no other text. Example: ["plumbing", "faucet", "diy", "repair"]`;

    const response = await callOpenAI("chat/completions", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 100,
    });

    const content = response.choices[0].message.content.trim();
    const tags = JSON.parse(content);

    res.json({ tags: tags.slice(0, 8) });
  } catch (error) {
    console.error("Suggest tags error:", error);
    res.json({ tags: ["DIY", "fix", "repair", "how-to"] });
  }
});

router.post("/generate-description", authMiddleware, async (req, res) => {
  try {
    const { title, category, tags } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    if (!OPENAI_API_KEY) {
      return res.json({
        description: `Learn how to ${title.toLowerCase()}. Quick and easy fix!`,
      });
    }

    const prompt = `Write a concise, helpful description (under 200 characters) for a fix-it video:
Title: ${title}
Category: ${category || "general"}
Tags: ${(tags || []).join(", ") || "none"}

The description should be practical, encouraging, and highlight the key benefit. Return only the description text.`;

    const response = await callOpenAI("chat/completions", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: 100,
    });

    const description = response.choices[0].message.content
      .trim()
      .replace(/^["']|["']$/g, "");

    res.json({ description: description.slice(0, 300) });
  } catch (error) {
    console.error("Generate description error:", error);
    res.json({ description: "A quick and helpful fix-it tutorial." });
  }
});

router.post("/moderate-content", authMiddleware, async (req, res) => {
  try {
    const { title, description, tags } = req.body;

    if (!OPENAI_API_KEY) {
      return res.json({ approved: true, reason: null });
    }

    const content = `${title} ${description || ""} ${(tags || []).join(" ")}`;

    const response = await callOpenAI("moderations", {
      input: content,
    });

    const result = response.results[0];

    if (result.flagged) {
      const categories = Object.entries(result.categories)
        .filter(([_, flagged]) => flagged)
        .map(([category]) => category);

      return res.json({
        approved: false,
        reason: `Content flagged for: ${categories.join(", ")}`,
      });
    }

    res.json({ approved: true, reason: null });
  } catch (error) {
    console.error("Moderation error:", error);
    res.json({ approved: true, reason: null });
  }
});

router.post("/generate-guide", optionalAuth, async (req, res) => {
  try {
    const { query, language = "en", includeImages = true } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const languageNames = {
      en: "English",
      sv: "Swedish",
      ar: "Arabic",
      de: "German",
      fr: "French",
      ru: "Russian",
    };
    const languageName = languageNames[language] || "English";

    if (!OPENAI_API_KEY) {
      const fallbackSteps = [
        { stepNumber: 1, text: `Search for "${query}" tutorials online` },
        { stepNumber: 2, text: "Watch video guides from verified experts" },
        {
          stepNumber: 3,
          text: "Follow safety precautions for your specific situation",
        },
        { stepNumber: 4, text: "If unsure, consult a professional" },
      ];
      return res.json({
        query,
        steps: fallbackSteps,
        images: [],
        language,
      });
    }

    const stepsPrompt = `You are a helpful DIY and home repair assistant. Generate a step-by-step guide for the following problem in ${languageName}:

Problem: ${query}

Requirements:
- Generate 3-7 clear, actionable steps
- Each step should be concise (1-2 sentences)
- Focus on practical, safe solutions
- Include any necessary safety warnings
- Be specific about tools or materials needed

Return ONLY a JSON array of objects with "stepNumber" and "text" fields. Example:
[{"stepNumber": 1, "text": "Turn off the water supply valve under the sink."}, {"stepNumber": 2, "text": "..."}]`;

    const stepsResponse = await callOpenAI("chat/completions", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: stepsPrompt }],
      temperature: 0.7,
      max_tokens: 800,
    });

    let steps;
    try {
      const content = stepsResponse.choices[0].message.content.trim();
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      steps = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse steps:", parseError);
      steps = [
        { stepNumber: 1, text: stepsResponse.choices[0].message.content },
      ];
    }

    let images = [];

    if (includeImages && steps.length >= 2) {
      const imagePromptsRequest = `Based on these repair/DIY steps, generate 2-4 image prompts that would help illustrate the key actions. The images should be clear, instructional diagrams or illustrations.

Steps:
${steps.map((s) => `${s.stepNumber}. ${s.text}`).join("\n")}

Requirements for each image prompt:
- Describe a clear instructional illustration or diagram
- Focus on hands performing the action or the tool being used
- Use simple, clean visual style
- No text in the images
- Make prompts specific and visual

Return ONLY a JSON array of objects with "prompt" and "caption" (in ${languageName}) fields. Generate 2-4 prompts. Example:
[{"prompt": "Clean instructional illustration of hands turning off a water valve under a sink, simple diagram style", "caption": "Turn off the water valve"}]`;

      try {
        const imagePromptsResponse = await callOpenAI("chat/completions", {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: imagePromptsRequest }],
          temperature: 0.7,
          max_tokens: 500,
        });

        let imagePrompts;
        const promptContent =
          imagePromptsResponse.choices[0].message.content.trim();
        const promptJsonMatch = promptContent.match(/\[[\s\S]*\]/);
        imagePrompts = promptJsonMatch
          ? JSON.parse(promptJsonMatch[0])
          : JSON.parse(promptContent);

        const imageResults = await Promise.allSettled(
          imagePrompts.slice(0, 4).map(async (item) => {
            const imageResponse = await callOpenAI("images/generations", {
              model: "dall-e-3",
              prompt: `Clean, simple instructional diagram illustration: ${item.prompt}. Style: clear line art, minimal colors, no text or labels, educational diagram style.`,
              n: 1,
              size: "1024x1024",
              quality: "standard",
            });
            return {
              url: imageResponse.data[0].url,
              caption: item.caption,
            };
          }),
        );

        images = imageResults
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value);
      } catch (imageError) {
        console.error("Image generation error:", imageError);
      }
    }

    res.json({
      query,
      steps,
      images,
      language,
    });
  } catch (error) {
    console.error("Generate guide error:", error);
    res.status(500).json({ error: "Failed to generate guide" });
  }
});

router.post("/semantic-search", optionalAuth, async (req, res) => {
  try {
    const { query, category, limit = 20 } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    if (!OPENAI_API_KEY) {
      let sqlQuery = `
        SELECT v.*, u.display_name as author_name, u.avatar_url as author_avatar,
               EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND user_id = $1) as is_liked,
               EXISTS(SELECT 1 FROM video_saves WHERE video_id = v.id AND user_id = $1) as is_saved
        FROM videos v
        JOIN users u ON v.author_id = u.id
        WHERE v.is_flagged = false
        AND (v.title ILIKE $2 OR v.description ILIKE $2 OR $3 = ANY(v.tags))
      `;

      const params = [req.userId || null, `%${query}%`, query.toLowerCase()];

      if (category && category !== "all") {
        sqlQuery += ` AND v.category = $4`;
        params.push(category);
      }

      sqlQuery += ` ORDER BY v.likes_count DESC, v.created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await pool.query(sqlQuery, params);

      const videos = result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        category: row.category,
        tags: row.tags,
        videoUrl: row.video_url,
        thumbnailUrl: row.thumbnail_url,
        duration: row.duration,
        likesCount: row.likes_count,
        commentsEnabled: row.comments_enabled,
        authorId: row.author_id,
        authorName: row.author_name,
        authorAvatar: row.author_avatar,
        isLiked: row.is_liked,
        isSaved: row.is_saved,
        createdAt: row.created_at,
      }));

      return res.json(videos);
    }

    const embeddingResponse = await callOpenAI("embeddings", {
      model: "text-embedding-3-small",
      input: query,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    let sqlQuery = `
      SELECT v.*, u.display_name as author_name, u.avatar_url as author_avatar,
             EXISTS(SELECT 1 FROM video_likes WHERE video_id = v.id AND user_id = $1) as is_liked,
             EXISTS(SELECT 1 FROM video_saves WHERE video_id = v.id AND user_id = $1) as is_saved,
             1 - (v.embedding <=> $2::vector) as similarity
      FROM videos v
      JOIN users u ON v.author_id = u.id
      WHERE v.is_flagged = false AND v.embedding IS NOT NULL
    `;

    const params = [req.userId || null, `[${queryEmbedding.join(",")}]`];

    if (category && category !== "all") {
      sqlQuery += ` AND v.category = $3`;
      params.push(category);
    }

    sqlQuery += ` ORDER BY similarity DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(sqlQuery, params);

    const videos = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      tags: row.tags,
      videoUrl: row.video_url,
      thumbnailUrl: row.thumbnail_url,
      duration: row.duration,
      likesCount: row.likes_count,
      commentsEnabled: row.comments_enabled,
      authorId: row.author_id,
      authorName: row.author_name,
      authorAvatar: row.author_avatar,
      isLiked: row.is_liked,
      isSaved: row.is_saved,
      similarity: row.similarity,
      createdAt: row.created_at,
    }));

    res.json(videos);
  } catch (error) {
    console.error("Semantic search error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
