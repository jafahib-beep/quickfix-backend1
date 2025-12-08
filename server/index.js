/**
 * QuickFix Backend Server
 * =======================
 *
 * HOW TO RUN:
 *   node server/index.js
 *
 * The server runs on port 3001 by default (configurable via BACKEND_PORT env var).
 * It connects to the PostgreSQL database using DATABASE_URL environment variable.
 *
 * MAIN ENDPOINTS:
 *
 *   GET /api/health
 *     - Returns { status: "ok", timestamp: "..." } if server is running
 *     - Use this to check if the backend is available
 *
 *   POST /api/ai/chat
 *     - Main AI chat endpoint
 *     - Body: { messages: [{role, content}...], language?, imageBase64?, videoFileName? }
 *     - Uses GPT-4o for image analysis, GPT-4o-mini for text-only
 *     - Returns: { answer: "..." }
 *
 *   Other endpoints: /api/auth/*, /api/videos/*, /api/users/*, /api/toolbox/*,
 *                    /api/notifications/*, /api/community/*
 *
 * ENVIRONMENT VARIABLES:
 *   - DATABASE_URL: PostgreSQL connection string (required)
 *   - OPENAI_API_KEY: OpenAI API key for AI features (optional but required for AI)
 *   - SESSION_SECRET: JWT secret for authentication
 *   - BACKEND_PORT: Server port (default: 3001)
 */

const express = require("express");
const path = require("path");
const { initializeDatabase } = require("./db");

const authRoutes = require("./routes/auth");
const videoRoutes = require("./routes/videos");
const userRoutes = require("./routes/users");
const toolboxRoutes = require("./routes/toolbox");
const notificationRoutes = require("./routes/notifications");
const aiRoutes = require("./routes/ai");
const communityRoutes = require("./routes/community");
const reportsRoutes = require("./routes/reports");
const { router: blockRoutes } = require("./routes/block");

const app = express();
const PORT = process.env.PORT || process.env.BACKEND_PORT || 5000;

// 🔍 Logga alla requests som kommer in till backend
app.use((req, res, next) => {
  console.log("[BACKEND]", req.method, req.url);
  next();
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept",
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/users", userRoutes);
app.use("/api/toolbox", toolboxRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/community", communityRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api", blockRoutes);

app.get("/api/categories", (req, res) => {
  res.json([
    { key: "all", label: "All" },
    { key: "home", label: "Home" },
    { key: "car", label: "Car" },
    { key: "electronics", label: "Electronics" },
    { key: "tools", label: "Tools" },
    { key: "cleaning", label: "Cleaning" },
    { key: "garden", label: "Garden" },
    { key: "plumbing", label: "Plumbing" },
    { key: "electrical", label: "Electrical" },
    { key: "appliances", label: "Appliances" },
    { key: "other", label: "Other" },
  ]);
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

async function startServer() {
  try {
    await initializeDatabase();
    console.log("Database initialized");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
