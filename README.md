# ⚖️ AI Legal Document Helper

A web application that uses AI to make legal documents understandable and easier to prepare. It solves four everyday problems:

| Feature | What it does |
|---|---|
| 💬 **Explain** | Explains a contract in plain language — who's involved, what each side must do, and the watch-outs. |
| 📌 **Summarise** | Produces a TL;DR, a key-clause table, and a list of every important date & number. |
| ⚠️ **Spot Risks** | Flags risky or one-sided terms (with 🔴/🟡/🟢 severity) and clauses that appear to be **missing**. |
| 📊 **Risk Score** | A quantified **risk scoreboard**: an overall 0–100 score + per-category bands (liability, termination, payment, IP…), an extracted **obligation/deadline timeline**, and one-click **calendar (.ics) export** of any dated deadlines. |
| 🔀 **Compare** | **Redline two versions** of a contract: a change-by-change table showing *which side each change now favours* (🟦 you / 🟥 them / ⚖️ neutral) and whether risk went ⬆️/⬇️, plus what was added/removed. |
| ✍️ **Draft** | Drafts a first version of a legal document from a plain description, with `[PLACEHOLDERS]` to fill in. |

**File upload** — drag-and-drop or upload **PDF / DOCX / TXT** files into any tool; the app extracts the text for you (a prominent full-screen loader shows progress while larger PDFs are read).

**📚 Knowledge Base (RAG)** — add legal texts (statutes, policies, template contracts) as sources, or send an uploaded document straight to the KB with **＋ Add to Knowledge Base**. Sources are chunked and indexed with **BM25** (keyword retrieval — no embeddings, no API key). Before Lexi answers a chat question, the app retrieves the most relevant passages and grounds the reply in them, showing a **“Grounded on: …”** chip so you can see which sources it used — *so it gets its facts right before answering.*

**Lexi**, an always-available **AI assistant bot** (bottom-right), for follow-up questions and concepts. When a document is loaded, Lexi becomes **document-grounded** — it answers *from your document* and **cites the exact clause/section** (toggleable between grounded and general mode).

> **Not legal advice.** This tool surfaces information to help you understand documents. For anything high-stakes, have a qualified attorney review before you act.

---

## 🔐 API key handling

The AI runs through the official **[Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript)** (`@anthropic-ai/sdk`). The API key is read **only** from the `ANTHROPIC_API_KEY` environment variable — it is never hard-coded or committed:

- **Locally**, it comes from a `.env` file, which is **git-ignored**.
- **On Vercel**, it comes from an **encrypted Environment Variable** in the project settings (never in the repo).

If the key is missing or invalid, the app stays up and every AI request returns a clear, actionable error instead of crashing.

---

## 🚀 Getting started (local)

```bash
# 1. Install dependencies
npm install

# 2. Configure your key
cp .env.example .env
#    then edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# 3. Start the server
npm start          # or: npm run dev  (auto-restart on changes)

# 4. Open the app
#    http://localhost:3000
```

`.env` keys:

```ini
ANTHROPIC_API_KEY=sk-ant-...        # required
PORT=3000                           # optional (local only)
# ANTHROPIC_MODEL=claude-opus-4-8   # optional model override
```

---

## ▲ Deploy to Vercel

This repo is Vercel-ready: static UI in `public/` is served by Vercel's CDN, and the Express API runs as a single serverless function (`api/index.js`, wired via `vercel.json`).

1. **Import the repo** in Vercel (New Project → import this GitHub repo). No build command or framework preset is needed.
2. **Add the environment variable** in Project → Settings → Environment Variables:
   - `ANTHROPIC_API_KEY` = your key (add it to Production, Preview, and Development).
   - *(optional)* `ANTHROPIC_MODEL` = `claude-opus-4-8`.
3. **Deploy.** Every push to the connected branch redeploys automatically.

> **⚠️ Knowledge Base persistence on Vercel.** The RAG store writes to disk, but Vercel's filesystem is read-only except `/tmp`, which is **ephemeral** (wiped on cold starts, not shared across instances). So KB sources added on the deployed site will not survive reliably. For durable KB storage, back `server/rag.js` with a database or blob store (e.g. Vercel KV / Postgres / Blob). Locally, the KB persists to `data/kb.json` as normal.
>
> **⏱️ Function timeout.** `vercel.json` sets `maxDuration: 60s`. Long Opus analyses stream token-by-token to stay under the limit; on the Hobby plan the ceiling may be lower, so very large documents could time out.

---

## 🧱 How it's built

```
Legal-Document-Helper/
├── api/
│   └── index.js       # Vercel serverless entry — re-exports the Express app
├── server/
│   ├── index.js       # Express server + SSE streaming + routes (exports the app)
│   ├── ai.js          # Anthropic SDK wrapper (streaming; key from ANTHROPIC_API_KEY)
│   ├── prompts.js     # System prompts for each AI capability + the chat bot + RAG grounding
│   └── rag.js         # Dependency-free RAG knowledge base (chunking + BM25 retrieval)
├── vercel.json        # Routes /api/* to the function; static public/ served by CDN
├── data/              # KB store (kb.json) — git-ignored, local only
├── public/
│   ├── index.html     # UI: tool tabs + chat widget
│   ├── styles.css     # Light/dark theme
│   └── app.js         # Streaming client, mini Markdown renderer, chat bot
├── .claude/
│   └── skills/        # Superpowers Claude Code skills (dev-time; see below)
├── .env.example
└── package.json
```

- **Backend** — [Express](https://expressjs.com/) exposes:
  - `POST /api/tool` `{ mode, document, instructions }` — streaming Markdown for `explain | summarize | risks | draft`
  - `POST /api/analyze` `{ document }` — returns a **structured JSON** risk scoreboard + obligation timeline
  - `POST /api/compare` `{ documentA, documentB }` — streaming redline analysis
  - `POST /api/chat` `{ messages, documentContext? }` — the assistant bot; retrieves relevant **Knowledge Base** passages (BM25) and grounds the answer in them, streaming a `meta` event naming the sources used, plus optional per-document grounding
  - `GET/POST/DELETE /api/kb` — manage the RAG knowledge base (list / add a source / remove one); persisted to `data/kb.json`
  - `POST /api/extract` (multipart) — extracts text from an uploaded **PDF** (`pdf-parse`) / **DOCX** (`mammoth`) / TXT file
  - AI calls use `messages.stream()` from `@anthropic-ai/sdk` with a purpose-built system prompt, streamed to the browser over **Server-Sent Events**.
- **Frontend** — dependency-free vanilla JS: SSE reader, a small built-in Markdown renderer (incl. tables), a dynamic input area (single vs. two-document), drag-and-drop upload, and a hand-built risk dashboard (accessible **status palette** with numeric scores + text bands, so meaning is never colour-alone) with client-side `.ics` generation.

---

## 🦸 Superpowers skills (`.claude/skills/`)

This repo vendors the [Superpowers](https://github.com/obra/superpowers) skill collection into `.claude/skills/`. These are **Claude Code developer skills** — they help you *build and extend* this project when you open it in Claude Code (brainstorming, writing plans, TDD, systematic debugging, code review, etc.). They are a development aid and are **not** part of the app's runtime AI.

---

## 🔒 Privacy & safety notes

- Document text you paste is sent to Claude (via the Anthropic API) to generate the analysis. Don't paste anything you're not comfortable processing with Claude.
- The AI is instructed to stay grounded in the text you provide, flag uncertainty, and never claim a document is "safe" or "compliant."
- Inputs are capped (200k characters) as a guardrail.

---

## 📜 License

Provided as-is for the Legal Document Helper project. The bundled Superpowers skills retain their own upstream license.
