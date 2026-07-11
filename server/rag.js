// Lightweight, dependency-free RAG knowledge base.
//
// Stores legal source documents split into overlapping chunks and retrieves the
// most relevant chunks for a query using BM25 (a classic, embedding-free ranking
// function). This lets the chat assistant ground its answers in the actual text
// of the sources — "getting its facts right" — without any external API or key.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// On Vercel the project filesystem is read-only; only /tmp is writable (and it is
// ephemeral — wiped between cold starts and not shared across instances). Locally
// we persist under the project's data/ directory.
const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "ldh-data")
  : path.join(__dirname, "..", "data");
const STORE_PATH = path.join(DATA_DIR, "kb.json");

const CHUNK_SIZE = 1100; // characters
const CHUNK_OVERLAP = 150;

// --- Tokenisation ------------------------------------------------------------
const STOPWORDS = new Set(
  ("a an and are as at be by for from has he in is it its of on that the to was were will with " +
    "this which or any shall be under such person who any may").split(" ")
);
function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// --- Chunking ----------------------------------------------------------------
function chunkText(text) {
  const clean = String(text).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + CHUNK_SIZE, clean.length);
    // prefer to break on a paragraph/sentence boundary near the end
    if (end < clean.length) {
      const slice = clean.slice(i, end);
      const brk = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (brk > CHUNK_SIZE * 0.5) end = i + brk + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = end - CHUNK_OVERLAP;
    if (i < 0) i = 0;
  }
  return chunks;
}

// --- Store -------------------------------------------------------------------
// Shape: { sources: [{ id, name, addedAt, chunks: [{ text, tf: {term:count}, len }] }] }
let store = { sources: [] };
let idCounter = 1;

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      const maxId = store.sources.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0);
      idCounter = maxId + 1;
    }
  } catch (err) {
    console.error("[rag] failed to load store:", err?.message || err);
    store = { sources: [] };
  }
}
function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store));
  } catch (err) {
    console.error("[rag] failed to persist store:", err?.message || err);
  }
}
load();

export function addSource(name, text) {
  const pieces = chunkText(text);
  const chunks = pieces.map((t) => {
    const toks = tokenize(t);
    const tf = {};
    for (const tok of toks) tf[tok] = (tf[tok] || 0) + 1;
    return { text: t, tf, len: toks.length };
  });
  const source = {
    id: String(idCounter++),
    name: String(name || "Untitled source").slice(0, 200),
    addedAt: new Date().toISOString(),
    chunks,
  };
  store.sources.push(source);
  persist();
  return { id: source.id, name: source.name, chunks: chunks.length, addedAt: source.addedAt };
}

export function listSources() {
  return store.sources.map((s) => ({
    id: s.id,
    name: s.name,
    chunks: s.chunks.length,
    addedAt: s.addedAt,
  }));
}

export function removeSource(id) {
  const before = store.sources.length;
  store.sources = store.sources.filter((s) => s.id !== String(id));
  persist();
  return store.sources.length < before;
}

export function isEmpty() {
  return store.sources.every((s) => s.chunks.length === 0);
}

// --- BM25 retrieval ----------------------------------------------------------
const K1 = 1.5;
const B = 0.75;

export function retrieve(query, k = 5) {
  const qTerms = [...new Set(tokenize(query))];
  if (qTerms.length === 0) return [];

  // Flatten all chunks with their source.
  const all = [];
  for (const s of store.sources) {
    for (let ci = 0; ci < s.chunks.length; ci++) {
      all.push({ source: s, chunk: s.chunks[ci], ci });
    }
  }
  if (all.length === 0) return [];

  const N = all.length;
  const avgLen = all.reduce((sum, e) => sum + (e.chunk.len || 0), 0) / N || 1;

  // document frequency per query term
  const df = {};
  for (const term of qTerms) {
    let count = 0;
    for (const e of all) if (e.chunk.tf[term]) count++;
    df[term] = count;
  }

  const scored = all.map((e) => {
    let score = 0;
    for (const term of qTerms) {
      const f = e.chunk.tf[term] || 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - df[term] + 0.5) / (df[term] + 0.5));
      const denom = f + K1 * (1 - B + (B * (e.chunk.len || 0)) / avgLen);
      score += idf * ((f * (K1 + 1)) / denom);
    }
    return { ...e, score };
  });

  return scored
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((e) => ({
      sourceId: e.source.id,
      sourceName: e.source.name,
      text: e.chunk.text,
      score: Number(e.score.toFixed(3)),
    }));
}
