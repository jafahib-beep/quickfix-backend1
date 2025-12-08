import { Router, Request, Response } from "express";
import { askAI, analyzeImage, liveAssistOnImage } from "../openai";

const router = Router();

// POST /api/ai/text
router.post("/text", async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "prompt is required" });
    }

    const answer = await askAI(prompt);
    res.json({ answer });
  } catch (err) {
    console.error("AI text error:", err);
    res.status(500).json({ error: "AI text request failed" });
  }
});

// POST /api/ai/image
// body: { imageBase64: string }
router.post("/image", async (req: Request, res: Response) => {
  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    const result = await analyzeImage(imageBase64);
    res.json({ result });
  } catch (err) {
    console.error("AI image error:", err);
    res.status(500).json({ error: "AI image request failed" });
  }
});

// POST /api/ai/liveassist
// body: { imageBase64: string }
router.post("/liveassist", async (req: Request, res: Response) => {
  try {
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    const result = await liveAssistOnImage(imageBase64);
    res.json(result);
  } catch (err) {
    console.error("AI liveassist error:", err);
    res.status(500).json({ error: "AI liveassist request failed" });
  }
});

export default router;
