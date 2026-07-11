import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Import the internal parser directly — pdf-parse's index.js runs a debug file
// read when `module.parent` is undefined (which it is under ESM), crashing on load.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import { PROMPTS, CHAT_GROUNDING, RAG_GROUNDING, TOOL_MODES } from "./prompts.js";
import * as kb from "./rag.js";
import { streamText, friendlyError, hasKey, MODEL } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MAX_DOC_CHARS = 200_000;

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// --- SSE helpers -------------------------------------------------------------

function openSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
}
function send(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Stream a completion over SSE.
async function runQuery(res, { system, prompt, meta }) {
  openSSE(res);
  let aborted = false;
  res.on("close", () => {
    aborted = true;
  });
  if (meta) send(res, "meta", meta);
  try {
    await streamText({
      system,
      prompt,
      onDelta: (t) => {
        if (!aborted) send(res, "delta", { text: t });
      },
      isAborted: () => aborted,
    });
    if (!aborted) send(res, "done", {});
  } catch (err) {
    console.error("[stream error]", err?.message || err);
    if (!aborted) send(res, "error", { message: friendlyError(err) });
  } finally {
    if (!aborted) res.end();
  }
}

function extractJson(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object found");
  return JSON.parse(t.slice(start, end + 1));
}

// --- Routes ------------------------------------------------------------------

// Extract text from an uploaded PDF / DOCX / TXT file.
app.post("/api/extract", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const { originalname = "document", mimetype = "", buffer } = req.file;
    const ext = originalname.toLowerCase().split(".").pop();

    let text = "";
    if (mimetype === "application/pdf" || ext === "pdf") {
      // pdf-parse's bundled PDF.js logs benign "Warning: TT: undefined function"
      // font-hinting messages for many PDFs. Suppress just those while parsing.
      const origWarn = console.warn;
      const origLog = console.log;
      const filter = (orig) => (...args) => {
        if (typeof args[0] === "string" && /^Warning: TT|undefined function/.test(args[0])) return;
        orig.apply(console, args);
      };
      console.warn = filter(origWarn);
      console.log = filter(origLog);
      try {
        const data = await pdfParse(buffer);
        text = data.text || "";
      } finally {
        console.warn = origWarn;
        console.log = origLog;
      }
    } else if (
      ext === "docx" ||
      mimetype.includes("officedocument.wordprocessingml")
    ) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    } else if (ext === "doc") {
      return res.status(415).json({
        error: "Legacy .doc isn't supported — save it as .docx or PDF first.",
      });
    } else {
      text = buffer.toString("utf8");
    }

    text = text.replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) {
      return res.status(422).json({
        error:
          "Couldn't extract any text — the file may be a scanned image with no text layer.",
      });
    }
    res.json({
      filename: originalname,
      text: text.slice(0, MAX_DOC_CHARS),
      chars: text.length,
    });
  } catch (err) {
    console.error("[extract error]", err?.message || err);
    res.status(500).json({ error: "Failed to read that file." });
  }
});

// Single-document Markdown tools: explain | summarize | risks | draft
app.post("/api/tool", async (req, res) => {
  const { mode, document = "", instructions = "" } = req.body ?? {};
  if (!TOOL_MODES.includes(mode)) {
    return res.status(400).json({ error: `Unknown tool mode: ${mode}` });
  }
  const doc = String(document).slice(0, MAX_DOC_CHARS);
  const extra = String(instructions).trim();

  let prompt;
  if (mode === "draft") {
    const description = extra || doc;
    if (!description.trim()) {
      return res.status(400).json({ error: "Describe the document you want drafted." });
    }
    prompt = `Please draft a document based on this request:\n\n${description}`;
  } else {
    if (!doc.trim()) {
      return res.status(400).json({ error: "Paste the document text to analyse." });
    }
    prompt =
      `Here is the document:\n\n"""\n${doc}\n"""` +
      (extra ? `\n\nAdditional instructions from the user: ${extra}` : "");
  }
  await runQuery(res, { system: PROMPTS[mode], prompt });
});

// Structured risk scoreboard + obligation timeline (returns JSON, not a stream).
app.post("/api/analyze", async (req, res) => {
  const doc = String(req.body?.document ?? "").slice(0, MAX_DOC_CHARS);
  if (!doc.trim()) {
    return res.status(400).json({ error: "Paste or upload a document to analyse." });
  }
  try {
    const { text } = await streamText({
      system: PROMPTS.scoreboard,
      prompt: `Analyse this document and return the JSON assessment:\n\n"""\n${doc}\n"""`,
    });
    let data;
    try {
      data = extractJson(text);
    } catch (e) {
      console.error("[analyze parse error]", e?.message, "\n---\n", text.slice(0, 400));
      return res.status(502).json({
        error: "The AI didn't return valid analysis data. Please try again.",
      });
    }
    res.json(data);
  } catch (err) {
    console.error("[analyze error]", err?.message || err);
    res.status(500).json({ error: friendlyError(err) });
  }
});

// Contract comparison / redline (streaming Markdown).
app.post("/api/compare", async (req, res) => {
  const a = String(req.body?.documentA ?? "").slice(0, MAX_DOC_CHARS);
  const b = String(req.body?.documentB ?? "").slice(0, MAX_DOC_CHARS);
  if (!a.trim() || !b.trim()) {
    return res
      .status(400)
      .json({ error: "Provide both Version A and Version B to compare." });
  }
  const prompt =
    `VERSION A (original):\n\n"""\n${a}\n"""\n\n` +
    `VERSION B (revised):\n\n"""\n${b}\n"""\n\n` +
    `Compare them per your instructions.`;
  await runQuery(res, { system: PROMPTS.compare, prompt });
});

// AI assistant bot — multi-turn chat, optionally grounded in an attached document.
app.post("/api/chat", async (req, res) => {
  const { messages, documentContext } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }
  const clean = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_DOC_CHARS) }));

  if (clean.length === 0 || clean[clean.length - 1].role !== "user") {
    return res.status(400).json({ error: "The last message must be from the user." });
  }

  let system = PROMPTS.chat;

  // RAG: retrieve the most relevant passages from the knowledge base for the
  // latest user turn, so the assistant answers from real sources.
  const lastUser = clean[clean.length - 1].content;
  let usedPassages = [];
  if (!kb.isEmpty()) {
    usedPassages = kb.retrieve(lastUser, 5);
    if (usedPassages.length) system += RAG_GROUNDING(usedPassages);
  }

  if (documentContext?.text) {
    const name = String(documentContext.name || "attached document").slice(0, 120);
    system += CHAT_GROUNDING(name, String(documentContext.text).slice(0, MAX_DOC_CHARS));
  }

  let prompt;
  if (clean.length === 1) {
    prompt = clean[0].content;
  } else {
    const history = clean
      .slice(0, -1)
      .map((m) => `${m.role === "user" ? "User" : "Lexi"}: ${m.content}`)
      .join("\n\n");
    prompt =
      `Conversation so far:\n\n${history}\n\n` +
      `The user now says:\n\n${clean[clean.length - 1].content}`;
  }

  const meta = usedPassages.length
    ? { sources: [...new Set(usedPassages.map((p) => p.sourceName))] }
    : undefined;
  await runQuery(res, { system, prompt, meta });
});

// --- Knowledge base (RAG) ----------------------------------------------------
app.get("/api/kb", (_req, res) => {
  res.json({ sources: kb.listSources() });
});
app.post("/api/kb", (req, res) => {
  const name = String(req.body?.name || "").trim() || "Untitled source";
  const text = String(req.body?.text || "");
  if (text.trim().length < 20) {
    return res.status(400).json({ error: "Provide at least a short passage of text to add." });
  }
  const added = kb.addSource(name, text.slice(0, MAX_DOC_CHARS));
  res.json({ ok: true, source: added });
});
app.delete("/api/kb/:id", (req, res) => {
  const removed = kb.removeSource(req.params.id);
  res.json({ ok: removed });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    keyConfigured: hasKey(),
    kbSources: kb.listSources().length,
  });
});

// On Vercel the app is imported as a serverless handler (see api/index.js), so
// we must NOT bind a port there. Only start a listener for local development.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  ⚖️  Legal Document Helper running at http://localhost:${PORT}`);
    console.log(`      AI: Anthropic API (@anthropic-ai/sdk) — key read from ANTHROPIC_API_KEY`);
    console.log(`      Model: ${MODEL}   Key configured: ${hasKey() ? "yes" : "NO — set ANTHROPIC_API_KEY"}\n`);
  });
}

export default app;
