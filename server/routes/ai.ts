import { Router, Request, Response } from "express";
import { askAI, callOpenAI, analyzeImage, liveAssistOnImage, isConfigured } from "../openai";

const router = Router();

/**
 * HEALTH CHECK
 */
router.get("/health", (req: Request, res: Response) => {
  if (!isConfigured) {
    return res.status(500).json({
      status: "error",
      service: "ai",
      note: "OpenAI key missing",
    });
  }

  res.json({
    status: "ok",
    service: "ai",
    note: "ready",
  });
});

/**
 * POST /api/ai/chat
 */
router.post("/chat", async (req: Request, res: Response) => {
  try {
    if (!isConfigured)
      return res.status(500).json({ error: "AI backend not configured (missing API key)" });

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array is required" });
    }

    const last = messages[messages.length - 1];
    const userText = last?.content || "";

    const answer = await askAI(userText);

    return res.json({ answer });

  } catch (err: any) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({
      error: "AI chat failed",
      details: err?.message || String(err),
    });
  }
});

/**
 * POST /api/ai/image
 */
router.post("/image", async (req: Request, res: Response) => {
  try {
    if (!isConfigured)
      return res.status(500).json({ error: "AI backend not configured" });

    const { imageBase64 } = req.body;

    if (!imageBase64)
      return res.status(400).json({ error: "imageBase64 is required" });

    const result = await analyzeImage(imageBase64);

    res.json({ result });

  } catch (err: any) {
    res.status(500).json({
      error: "AI image failed",
      details: err?.message || String(err),
    });
  }
});

/**
 * POST /api/ai/liveassist
 */
router.post("/liveassist", async (req: Request, res: Response) => {
  try {
    if (!isConfigured)
      return res.status(500).json({ error: "AI not configured" });

    const { imageBase64 } = req.body;

    if (!imageBase64)
      return res.status(400).json({ error: "imageBase64 is required" });

    const result = await liveAssistOnImage(imageBase64);

    res.json({ result });

  } catch (err: any) {
    res.status(500).json({
      error: "AI liveassist failed",
      details: err?.message || String(err),
    });
  }
});

export default router;
