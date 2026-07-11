"use strict";

/* ============================================================
 * Markdown renderer (dependency-free, HTML-escaped)
 * ========================================================== */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return t;
}
function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let i = 0;
  const isTableSep = (s) => /^\s*\|?[\s:|-]+\|?\s*$/.test(s) && s.includes("-");

  while (i < lines.length) {
    let line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(escapeHtml(lines[i])); i++; }
      i++;
      html += `<pre><code>${buf.join("\n")}</code></pre>`;
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { html += "<hr />"; i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }

    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const parseRow = (s) =>
        s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const headers = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(parseRow(lines[i])); i++;
      }
      let t = "<table><thead><tr>" + headers.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) t += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      html += t + "</tbody></table>";
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      html += `<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      let items = "";
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items += `<li>${inline(lines[i].replace(/^\s*[-*+]\s+/, ""))}</li>`; i++; }
      html += `<ul>${items}</ul>`;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      let items = "";
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`; i++; }
      html += `<ol>${items}</ol>`;
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const para = [];
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|---|\*\*\*|___)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) { para.push(lines[i]); i++; }
    if (para.length) html += `<p>${inline(para.join(" "))}</p>`;
  }
  return html;
}

/* ============================================================
 * SSE-over-fetch
 * ========================================================== */
async function streamPost(url, body, { onDelta, onError, onMeta }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
    onError(msg);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop();
    for (const chunk of chunks) {
      let event = "message", data = "";
      for (const l of chunk.split("\n")) {
        if (l.startsWith("event:")) event = l.slice(6).trim();
        else if (l.startsWith("data:")) data += l.slice(5).trim();
      }
      if (!data) continue;
      let parsed; try { parsed = JSON.parse(data); } catch (_) { continue; }
      if (event === "delta") onDelta(parsed.text || "");
      else if (event === "meta") { if (onMeta) onMeta(parsed); }
      else if (event === "error") onError(parsed.message || "Unknown error");
    }
  }
}

/* ============================================================
 * Samples
 * ========================================================== */
const SAMPLE_CONTRACT = `SERVICES AGREEMENT

This Services Agreement ("Agreement") is entered into as of the date of last signature below by and between BrightWorks Media Ltd, a company registered in England ("Provider"), and the client identified in the order form ("Client").

1. SERVICES. Provider shall provide social media management services as described in the applicable order form.

2. TERM. This Agreement begins on the Effective Date and continues for an initial term of twelve (12) months. It shall automatically renew for successive twelve (12) month periods unless either party gives written notice of non-renewal at least ninety (90) days before the end of the then-current term.

3. FEES. Client shall pay Provider GBP 2,500 per month, invoiced monthly in advance. Late payments accrue interest at 8% per month. All fees are non-refundable.

4. TERMINATION. Provider may terminate this Agreement at any time for any reason upon 7 days' notice. Client may terminate only for material breach that remains uncured for 30 days.

5. LIABILITY. Provider's total liability under this Agreement shall not exceed the fees paid in the one (1) month preceding the claim. In no event shall Provider be liable for any indirect or consequential damages.

6. INTELLECTUAL PROPERTY. All content, strategies, and materials created by Provider remain the exclusive property of Provider, including after termination.

7. GOVERNING LAW. This Agreement is governed by the laws of England and Wales.`;

const SAMPLE_CONTRACT_B = `SERVICES AGREEMENT (Revised)

This Services Agreement ("Agreement") is entered into as of the date of last signature below by and between BrightWorks Media Ltd, a company registered in England ("Provider"), and the client identified in the order form ("Client").

1. SERVICES. Provider shall provide social media management services as described in the applicable order form, meeting the service levels set out in Schedule 1.

2. TERM. This Agreement begins on the Effective Date and continues for an initial term of twelve (12) months. It shall automatically renew for successive twelve (12) month periods unless either party gives written notice of non-renewal at least thirty (30) days before the end of the then-current term.

3. FEES. Client shall pay Provider GBP 2,500 per month, invoiced monthly in advance. Late payments accrue interest at 1.5% per month. Fees for services not yet delivered are refundable on termination.

4. TERMINATION. Either party may terminate this Agreement for convenience upon thirty (30) days' written notice. Either party may terminate immediately for material breach that remains uncured for 30 days.

5. LIABILITY. Each party's total liability under this Agreement shall not exceed the fees paid in the three (3) months preceding the claim. Neither party shall be liable for any indirect or consequential damages.

6. INTELLECTUAL PROPERTY. All deliverables created for the Client transfer to the Client upon full payment. Provider retains ownership of its pre-existing tools and templates.

7. DATA PROTECTION. Each party shall comply with applicable data protection laws and process personal data only as necessary to perform this Agreement.

8. GOVERNING LAW. This Agreement is governed by the laws of England and Wales, and the parties submit to the exclusive jurisdiction of the English courts.`;

const SAMPLE_DRAFT_REQUEST =
  "A simple one-page mutual non-disclosure agreement (NDA) between two small businesses in California who are exploring a possible partnership. Term of 2 years, covers business plans, financials, and customer data.";

/* ============================================================
 * Mode configuration
 * ========================================================== */
const MODES = {
  explain: {
    inputTitle: "Paste your contract", outTitle: "Plain-language explanation",
    btn: "Explain this document", instructions: true, endpoint: "tool",
    slots: [{ id: "doc", label: "Document", upload: true, sample: SAMPLE_CONTRACT, placeholder: "Paste the full text of your contract or legal document here…" }],
  },
  summarize: {
    inputTitle: "Paste your document", outTitle: "Summary & key clauses",
    btn: "Summarise & highlight clauses", instructions: true, endpoint: "tool",
    slots: [{ id: "doc", label: "Document", upload: true, sample: SAMPLE_CONTRACT, placeholder: "Paste the full text of your document here…" }],
  },
  risks: {
    inputTitle: "Paste your document", outTitle: "Risk & gap analysis",
    btn: "Spot risks & missing terms", instructions: true, endpoint: "tool",
    slots: [{ id: "doc", label: "Document", upload: true, sample: SAMPLE_CONTRACT, placeholder: "Paste the full text of your document here…" }],
  },
  scoreboard: {
    inputTitle: "Score a document's risk", outTitle: "Risk scoreboard",
    btn: "Analyse risk", instructions: false, endpoint: "analyze",
    slots: [{ id: "doc", label: "Document", upload: true, sample: SAMPLE_CONTRACT, placeholder: "Paste the full text of your document here…" }],
  },
  compare: {
    inputTitle: "Compare two versions", outTitle: "Redline comparison",
    btn: "Compare versions", instructions: false, endpoint: "compare",
    slots: [
      { id: "A", label: "Version A — original", upload: true, sample: SAMPLE_CONTRACT, placeholder: "Paste the ORIGINAL version…" },
      { id: "B", label: "Version B — revised", upload: true, sample: SAMPLE_CONTRACT_B, placeholder: "Paste the REVISED version…" },
    ],
  },
  draft: {
    inputTitle: "Describe the document you need", outTitle: "Drafted document",
    btn: "Draft this document", instructions: false, endpoint: "tool",
    slots: [{ id: "doc", label: "What do you need?", upload: false, sample: SAMPLE_DRAFT_REQUEST, placeholder: "e.g. A mutual NDA between Acme Ltd (UK) and a freelance designer, 2-year term, covering product designs and customer lists…" }],
  },
};

const appState = { mode: "explain", primaryDoc: { name: "", text: "" }, groundingEnabled: true };

const els = {
  tabs: document.querySelectorAll(".tab"),
  inputTitle: document.getElementById("input-title"),
  outputTitle: document.getElementById("output-title"),
  slots: document.getElementById("input-slots"),
  instructionsRow: document.getElementById("instructions-row"),
  instructions: document.getElementById("instructions"),
  runBtn: document.getElementById("run-btn"),
  runLabel: document.querySelector(".run-label"),
  output: document.getElementById("output"),
  hint: document.getElementById("input-hint"),
  copyBtn: document.getElementById("copy-btn"),
  fileInput: document.getElementById("file-input"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlay-title"),
  overlaySub: document.getElementById("overlay-sub"),
};

/* ---------- Full-screen loading overlay ---------- */
function showOverlay(title, sub) {
  els.overlayTitle.textContent = title || "Working…";
  els.overlaySub.textContent = sub || "";
  els.overlay.hidden = false;
}
function hideOverlay() { els.overlay.hidden = true; }

let running = false;
let rawOutput = "";
let lastDashboard = null;
let pendingUploadSlot = null;

/* ---------- Slot rendering + file upload ---------- */
const slotFiles = {}; // slotId -> filename

function getSlotValue(id) {
  const ta = els.slots.querySelector(`textarea[data-slot="${id}"]`);
  return ta ? ta.value.trim() : "";
}

function updatePrimaryDoc() {
  const cfg = MODES[appState.mode];
  const primaryId = cfg.slots[0].id; // 'doc' or 'A'
  const text = getSlotValue(primaryId);
  const prevText = appState.primaryDoc.text;
  appState.primaryDoc = { name: slotFiles[primaryId] || "your document", text };
  if (text && text !== prevText) appState.groundingEnabled = true;
  updateChatGround();
}

function buildSlots(mode) {
  const cfg = MODES[mode];
  els.slots.innerHTML = "";
  slotFiles.doc = slotFiles.A = slotFiles.B = undefined;

  for (const spec of cfg.slots) {
    const slot = document.createElement("div");
    slot.className = "doc-slot";
    slot.dataset.slotWrap = spec.id;

    const actions = [];
    if (spec.upload) actions.push(`<button class="ghost-btn" data-act="upload" data-slot="${spec.id}">📎 Upload</button>`);
    if (spec.sample) actions.push(`<button class="ghost-btn" data-act="sample" data-slot="${spec.id}">Sample</button>`);
    actions.push(`<button class="ghost-btn" data-act="clear" data-slot="${spec.id}">Clear</button>`);

    slot.innerHTML = `
      <div class="slot-head">
        <span class="slot-label">${escapeHtml(spec.label)}</span>
        <div class="slot-actions">${actions.join("")}</div>
      </div>
      <textarea class="doc-input" data-slot="${spec.id}" spellcheck="false" placeholder="${escapeHtml(spec.placeholder)}"></textarea>
      <div class="slot-meta" data-meta="${spec.id}"></div>`;
    els.slots.appendChild(slot);

    const ta = slot.querySelector("textarea");
    ta.addEventListener("input", () => { updatePrimaryDoc(); });
    ta.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runActive();
    });

    // Drag & drop
    if (spec.upload) {
      slot.addEventListener("dragover", (e) => { e.preventDefault(); slot.classList.add("dragover"); });
      slot.addEventListener("dragleave", () => slot.classList.remove("dragover"));
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        slot.classList.remove("dragover");
        const f = e.dataTransfer?.files?.[0];
        if (f) uploadFile(spec.id, f);
      });
    }
  }
}

async function uploadFile(slotId, file) {
  const meta = els.slots.querySelector(`[data-meta="${slotId}"]`);
  const ta = els.slots.querySelector(`textarea[data-slot="${slotId}"]`);
  if (meta) meta.innerHTML = `<span class="file-chip">⏳ Reading ${escapeHtml(file.name)}…</span>`;
  showOverlay(`Reading “${file.name}”…`, "Extracting text — larger PDFs can take a few seconds.");
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/api/extract", { method: "POST", body: form });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Upload failed");
    ta.value = j.text;
    slotFiles[slotId] = j.filename;
    if (meta) {
      meta.innerHTML =
        `<span class="file-chip">📄 ${escapeHtml(j.filename)}</span> · ${j.chars.toLocaleString()} chars ` +
        `<button class="link-btn" data-act="tokb" data-slot="${slotId}">＋ Add to Knowledge Base</button>`;
    }
    updatePrimaryDoc();
  } catch (err) {
    if (meta) meta.innerHTML = `<span style="color:var(--danger)">⚠️ ${escapeHtml(err.message || "Upload failed")}</span>`;
  } finally {
    hideOverlay();
  }
}

els.slots.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.slot;
  const act = btn.dataset.act;
  const ta = els.slots.querySelector(`textarea[data-slot="${id}"]`);
  const meta = els.slots.querySelector(`[data-meta="${id}"]`);
  if (act === "upload") {
    pendingUploadSlot = id;
    els.fileInput.value = "";
    els.fileInput.click();
  } else if (act === "sample") {
    const spec = MODES[appState.mode].slots.find((s) => s.id === id);
    ta.value = spec.sample;
    slotFiles[id] = undefined;
    if (meta) meta.innerHTML = "";
    updatePrimaryDoc();
    ta.focus();
  } else if (act === "clear") {
    ta.value = "";
    slotFiles[id] = undefined;
    if (meta) meta.innerHTML = "";
    updatePrimaryDoc();
    ta.focus();
  } else if (act === "tokb") {
    const text = ta ? ta.value.trim() : "";
    const name = slotFiles[id] || "Pasted document";
    if (text.length < 20) return;
    btn.disabled = true;
    btn.textContent = "Adding…";
    kbAddSource(name, text)
      .then(() => { btn.textContent = "✓ In Knowledge Base"; })
      .catch((err) => { btn.disabled = false; btn.textContent = `⚠️ ${err.message || "Failed"}`; });
  }
});

els.fileInput.addEventListener("change", () => {
  const f = els.fileInput.files?.[0];
  if (f && pendingUploadSlot) uploadFile(pendingUploadSlot, f);
});

/* ---------- Mode switching ---------- */
function applyMode(mode) {
  appState.mode = mode;
  const cfg = MODES[mode];
  els.tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.mode === mode));
  els.inputTitle.textContent = cfg.inputTitle;
  els.outputTitle.textContent = cfg.outTitle;
  els.runLabel.textContent = cfg.btn;
  els.instructionsRow.style.display = cfg.instructions ? "" : "none";
  els.hint.textContent = "";
  els.hint.classList.remove("error");
  buildSlots(mode);
  showEmpty();
  updatePrimaryDoc();
}

function showEmpty() {
  els.output.className = "output";
  els.output.innerHTML = `<div class="empty-state">
      <div class="empty-emoji">📄</div>
      <p>Your result will appear here.</p>
      <p class="empty-sub">Fill in the left panel and press the button.</p>
    </div>`;
  els.copyBtn.hidden = true;
}
function resetOutput() { rawOutput = ""; els.output.className = "output"; els.output.innerHTML = ""; els.copyBtn.hidden = true; }

/* ============================================================
 * Run dispatch
 * ========================================================== */
function runActive() {
  if (running) return;
  const cfg = MODES[appState.mode];
  if (cfg.endpoint === "analyze") return runScoreboard();
  if (cfg.endpoint === "compare") return runCompare();
  return runTool();
}

function setRunning(on) {
  running = on;
  els.runBtn.disabled = on;
}

async function runTool() {
  const mode = appState.mode;
  const doc = getSlotValue("doc");
  const instructions = MODES[mode].instructions ? els.instructions.value.trim() : "";
  if (!doc) {
    els.hint.textContent = mode === "draft" ? "Describe the document you want drafted." : "Paste or upload a document first.";
    els.hint.classList.add("error");
    return;
  }
  els.hint.classList.remove("error");
  els.hint.textContent = "";
  setRunning(true);
  resetOutput();
  els.output.className = "output md is-streaming";
  const render = () => { els.output.innerHTML = renderMarkdown(rawOutput); els.output.scrollTop = els.output.scrollHeight; };
  try {
    await streamPost("/api/tool", { mode, document: doc, instructions }, {
      onDelta: (t) => { rawOutput += t; render(); },
      onError: (m) => { rawOutput += `\n\n> ⚠️ **${m}**`; render(); },
    });
  } finally {
    finishStream();
  }
}

async function runCompare() {
  const a = getSlotValue("A");
  const b = getSlotValue("B");
  if (!a || !b) {
    els.hint.textContent = "Provide both Version A and Version B.";
    els.hint.classList.add("error");
    return;
  }
  els.hint.classList.remove("error");
  els.hint.textContent = "";
  setRunning(true);
  resetOutput();
  els.output.className = "output md is-streaming";
  const render = () => { els.output.innerHTML = renderMarkdown(rawOutput); els.output.scrollTop = els.output.scrollHeight; };
  try {
    await streamPost("/api/compare", { documentA: a, documentB: b }, {
      onDelta: (t) => { rawOutput += t; render(); },
      onError: (m) => { rawOutput += `\n\n> ⚠️ **${m}**`; render(); },
    });
  } finally {
    finishStream();
  }
}

function finishStream() {
  setRunning(false);
  els.output.classList.remove("is-streaming");
  if (rawOutput.trim()) {
    els.output.innerHTML = renderMarkdown(rawOutput);
    els.copyBtn.hidden = false;
  } else {
    showEmpty();
  }
}

/* ============================================================
 * Scoreboard dashboard
 * ========================================================== */
function bandFromScore(score) {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}
function bandVar(band) {
  return { low: "var(--band-low)", medium: "var(--band-medium)", high: "var(--band-high)", critical: "var(--band-critical)" }[band] || "var(--band-medium)";
}
const TL_ICON = { deadline: "⏰", renewal: "🔁", payment: "💷", notice: "✉️", term: "📅" };

async function runScoreboard() {
  const doc = getSlotValue("doc");
  if (!doc) { els.hint.textContent = "Paste or upload a document to score."; els.hint.classList.add("error"); return; }
  els.hint.classList.remove("error");
  els.hint.textContent = "";
  setRunning(true);
  els.copyBtn.hidden = true;
  els.output.className = "output";
  els.output.innerHTML = `<div class="dash-loading"><div class="spinner"></div><p>Analysing risk & extracting obligations…</p><p class="empty-sub">This runs a structured assessment — a few seconds.</p></div>`;
  showOverlay("Analysing document risk…", "Scoring clauses and extracting obligations & deadlines.");
  try {
    const res = await fetch("/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: doc }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Analysis failed");
    lastDashboard = j;
    renderDashboard(j);
  } catch (err) {
    els.output.innerHTML = `<div class="dash-error">⚠️ ${escapeHtml(err.message || "Analysis failed")}</div>`;
  } finally {
    setRunning(false);
    hideOverlay();
  }
}

function renderDashboard(data) {
  const overall = data.overall || {};
  const oScore = Math.max(0, Math.min(100, Number(overall.score) || 0));
  const oBand = overall.band || bandFromScore(oScore);
  const oColor = bandVar(oBand);

  const cats = Array.isArray(data.categories) ? data.categories.slice() : [];
  cats.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

  const timeline = Array.isArray(data.timeline) ? data.timeline : [];
  const missing = Array.isArray(data.missing) ? data.missing : [];

  let html = `<div class="dashboard">`;

  // Hero
  html += `<div class="dash-hero" style="--band:${oColor}">
      <div class="hero-gauge" style="--pct:${oScore};--band:${oColor}"><span class="gauge-num">${oScore}</span></div>
      <div class="hero-body">
        ${data.documentType ? `<p class="doc-type">${escapeHtml(data.documentType)}</p>` : ""}
        <p class="hero-band">${escapeHtml(oBand)} risk</p>
        <p class="hero-summary">${escapeHtml(overall.summary || "")}</p>
      </div>
    </div>`;

  // Categories
  if (cats.length) {
    html += `<div><p class="dash-section-title">Risk by category</p>`;
    for (const c of cats) {
      const score = Math.max(0, Math.min(100, Number(c.score) || 0));
      const band = c.band || bandFromScore(score);
      const color = bandVar(band);
      html += `<div class="cat-row">
          <div class="cat-row-head">
            <span class="cat-name">${escapeHtml(c.name || "—")}</span>
            <span class="cat-score">${score}/100 <span class="band-pill" style="background:${color}">${escapeHtml(band)}</span></span>
          </div>
          <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${score}%;background:${color}"></div></div>
          ${c.note ? `<p class="cat-note">${escapeHtml(c.note)}</p>` : ""}
        </div>`;
    }
    html += `</div>`;
  }

  // Timeline
  if (timeline.length) {
    const datedCount = timeline.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date || "")).length;
    html += `<div><p class="dash-section-title">Key dates & obligations</p><ul class="timeline">`;
    for (const t of timeline) {
      const icon = TL_ICON[t.type] || "•";
      const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(t.date || "");
      const dateHtml = hasDate
        ? `<span class="tl-date">${escapeHtml(t.date)}</span>`
        : `<span class="tl-date relative">${escapeHtml(t.timing || "—")}</span>`;
      html += `<li class="tl-item">
          <span class="tl-icon">${icon}</span>
          <div class="tl-body">
            <div class="tl-label">${escapeHtml(t.label || "—")}</div>
            <div class="tl-meta">${[hasDate ? escapeHtml(t.timing || "") : "", t.clause ? escapeHtml(t.clause) : ""].filter(Boolean).join(" · ")}</div>
          </div>
          ${dateHtml}
        </li>`;
    }
    html += `</ul><div class="dash-actions">
        <button class="ics-btn" id="ics-btn" ${datedCount ? "" : "disabled"}>📅 Export ${datedCount || ""} date${datedCount === 1 ? "" : "s"} to calendar (.ics)</button>
      </div></div>`;
  }

  // Missing
  if (missing.length) {
    html += `<div><p class="dash-section-title">Notably missing</p><div class="missing-chips">`;
    for (const m of missing) html += `<span class="missing-chip">❓ ${escapeHtml(m)}</span>`;
    html += `</div></div>`;
  }

  html += `<p class="empty-sub" style="text-align:center;margin-top:6px">Scores are an AI estimate of risk to the reviewing party, not legal advice.</p>`;
  html += `</div>`;
  els.output.className = "output";
  els.output.innerHTML = html;

  const icsBtn = document.getElementById("ics-btn");
  if (icsBtn) icsBtn.addEventListener("click", () => exportICS(timeline));
}

function exportICS(timeline) {
  const dated = timeline.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date || ""));
  if (!dated.length) return;
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const addDay = (ymd) => {
    const d = new Date(ymd + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  };
  let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Legal Document Helper//EN\r\nCALSCALE:GREGORIAN\r\n";
  dated.forEach((t, idx) => {
    const start = t.date.replace(/-/g, "");
    ics += "BEGIN:VEVENT\r\n";
    ics += `UID:ldh-${idx}-${start}@legal-document-helper\r\n`;
    ics += `DTSTAMP:${stamp}\r\n`;
    ics += `DTSTART;VALUE=DATE:${start}\r\n`;
    ics += `DTEND;VALUE=DATE:${addDay(t.date)}\r\n`;
    ics += `SUMMARY:${esc(t.label)}\r\n`;
    ics += `DESCRIPTION:${esc([t.timing, t.clause].filter(Boolean).join(" · "))}\r\n`;
    ics += "END:VEVENT\r\n";
  });
  ics += "END:VCALENDAR\r\n";
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "legal-deadlines.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Wire tool UI ---------- */
els.tabs.forEach((tab) =>
  tab.addEventListener("click", () => { if (!running) applyMode(tab.dataset.mode); })
);
els.runBtn.addEventListener("click", runActive);
els.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(rawOutput);
    els.copyBtn.textContent = "Copied!";
    setTimeout(() => (els.copyBtn.textContent = "Copy"), 1500);
  } catch (_) {}
});

/* ============================================================
 * AI assistant bot (chat) — with optional document grounding
 * ========================================================== */
const chat = {
  toggle: document.getElementById("chat-toggle"),
  window: document.getElementById("chat-window"),
  close: document.getElementById("chat-close"),
  ground: document.getElementById("chat-ground"),
  log: document.getElementById("chat-log"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("chat-input"),
  send: document.getElementById("chat-send"),
};

let chatHistory = [];
let chatBusy = false;
let chatOpen = false;

const SUGGESTIONS = [
  "What is an indemnity clause, in plain English?",
  "What should I check before signing an NDA?",
  "Explain 'liquidated damages' with an example.",
];

function updateChatGround() {
  const el = chat.ground;
  if (!chatOpen) return;
  if (!appState.primaryDoc.text) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  if (appState.groundingEnabled) {
    el.innerHTML = `<span>📎</span><span class="cg-name">Answering from: ${escapeHtml(appState.primaryDoc.name)}</span><button class="cg-toggle" type="button">detach</button>`;
    el.querySelector(".cg-toggle").onclick = () => { appState.groundingEnabled = false; updateChatGround(); };
  } else {
    el.innerHTML = `<span>💬</span><span class="cg-name" style="color:var(--text-soft)">General mode</span><button class="cg-toggle" type="button">use my document</button>`;
    el.querySelector(".cg-toggle").onclick = () => { appState.groundingEnabled = true; updateChatGround(); };
  }
}

function renderIntro() {
  chat.log.innerHTML = `<div class="chat-intro">
      👋 Hi, I'm <strong>Lexi</strong>. Ask me anything about legal documents, or load one on the left and I'll answer <em>from that document</em> with citations.
      <div class="chat-suggestions">
        ${SUGGESTIONS.map((s) => `<button class="suggestion" type="button">${escapeHtml(s)}</button>`).join("")}
      </div>
      <p style="margin-top:14px;font-size:12px;opacity:.75">I share information, not legal advice.</p>
    </div>`;
  chat.log.querySelectorAll(".suggestion").forEach((b, idx) =>
    b.addEventListener("click", () => { chat.input.value = SUGGESTIONS[idx]; chat.form.requestSubmit(); })
  );
}

function addMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "msg-bubble" + (role === "assistant" ? " md" : "");
  bubble.textContent = text;
  wrap.appendChild(bubble);
  chat.log.appendChild(wrap);
  chat.log.scrollTop = chat.log.scrollHeight;
  return bubble;
}

function openChat() {
  chat.window.hidden = false;
  chat.toggle.style.display = "none";
  chatOpen = true;
  if (chatHistory.length === 0) renderIntro();
  updateChatGround();
  chat.input.focus();
}
function closeChat() { chat.window.hidden = true; chat.toggle.style.display = ""; chatOpen = false; }

chat.toggle.addEventListener("click", openChat);
chat.close.addEventListener("click", closeChat);
chat.input.addEventListener("input", () => {
  chat.input.style.height = "auto";
  chat.input.style.height = Math.min(chat.input.scrollHeight, 120) + "px";
});
chat.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chat.form.requestSubmit(); }
});

chat.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (chatBusy) return;
  const text = chat.input.value.trim();
  if (!text) return;
  if (chatHistory.length === 0) chat.log.innerHTML = "";

  chat.input.value = "";
  chat.input.style.height = "auto";
  addMessage("user", text);
  chatHistory.push({ role: "user", content: text });

  chatBusy = true;
  chat.send.disabled = true;
  const bubble = addMessage("assistant", "");
  bubble.classList.add("is-streaming");
  let acc = "";
  const render = () => { bubble.innerHTML = renderMarkdown(acc); chat.log.scrollTop = chat.log.scrollHeight; };

  const body = { messages: chatHistory };
  if (appState.groundingEnabled && appState.primaryDoc.text) {
    body.documentContext = appState.primaryDoc;
  }

  let sources = [];
  try {
    await streamPost("/api/chat", body, {
      onDelta: (t) => { acc += t; render(); },
      onMeta: (m) => { if (Array.isArray(m.sources)) sources = m.sources; },
      onError: (m) => { acc += `\n\n> ⚠️ **${m}**`; render(); },
    });
  } finally {
    bubble.classList.remove("is-streaming");
    if (sources.length) {
      const cite = document.createElement("div");
      cite.className = "msg-sources";
      cite.innerHTML = `📚 Grounded on: ${sources.map((s) => `<span>${escapeHtml(s)}</span>`).join("")}`;
      bubble.parentElement.appendChild(cite);
    }
    if (!acc.trim()) { acc = "_(no response)_"; render(); }
    chatHistory.push({ role: "assistant", content: acc });
    chatBusy = false;
    chat.send.disabled = false;
    chat.input.focus();
  }
});

/* ============================================================
 * Knowledge Base (RAG sources)
 * ========================================================== */
const kbEls = {
  btn: document.getElementById("kb-btn"),
  count: document.getElementById("kb-count"),
  panel: document.getElementById("kb-panel"),
  close: document.getElementById("kb-close"),
  name: document.getElementById("kb-name"),
  text: document.getElementById("kb-text"),
  addBtn: document.getElementById("kb-add-btn"),
  list: document.getElementById("kb-list"),
};

let kbSources = [];

function setKbCount(n) {
  if (!kbEls.count) return; // header KB button was removed
  kbEls.count.textContent = String(n);
  kbEls.count.classList.toggle("has", n > 0);
}

async function kbRefresh() {
  try {
    const res = await fetch("/api/kb");
    const j = await res.json();
    kbSources = j.sources || [];
  } catch (_) {
    kbSources = [];
  }
  setKbCount(kbSources.length);
  renderKbList();
}

function renderKbList() {
  if (!kbSources.length) {
    kbEls.list.innerHTML = `<li class="kb-empty">No sources yet. Add legal texts (statutes, policies, template contracts) so Lexi can ground its answers in them.</li>`;
    return;
  }
  kbEls.list.innerHTML = kbSources
    .map(
      (s) => `<li class="kb-item">
        <div class="kb-item-body">
          <span class="kb-item-name">📄 ${escapeHtml(s.name)}</span>
          <span class="kb-item-meta">${s.chunks} chunk${s.chunks === 1 ? "" : "s"}</span>
        </div>
        <button class="link-btn danger" data-kb-del="${escapeHtml(s.id)}">Remove</button>
      </li>`
    )
    .join("");
}

// Used both by the panel and the "Add to Knowledge Base" slot button.
async function kbAddSource(name, text) {
  const res = await fetch("/api/kb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || "Could not add source");
  await kbRefresh();
  return j.source;
}

async function kbRemove(id) {
  await fetch(`/api/kb/${encodeURIComponent(id)}`, { method: "DELETE" });
  await kbRefresh();
}

function openKb() { kbEls.panel.hidden = false; kbRefresh(); }
function closeKb() { kbEls.panel.hidden = true; }

if (kbEls.btn) kbEls.btn.addEventListener("click", () => { if (kbEls.panel.hidden) openKb(); else closeKb(); });
kbEls.close.addEventListener("click", closeKb);
kbEls.panel.addEventListener("click", (e) => {
  if (e.target === kbEls.panel) closeKb(); // click backdrop to close
  const del = e.target.closest("[data-kb-del]");
  if (del) kbRemove(del.getAttribute("data-kb-del"));
});

kbEls.addBtn.addEventListener("click", async () => {
  const name = kbEls.name.value.trim() || "Untitled source";
  const text = kbEls.text.value.trim();
  if (text.length < 20) {
    kbEls.text.focus();
    kbEls.addBtn.textContent = "Paste more text…";
    setTimeout(() => (kbEls.addBtn.textContent = "Add source"), 1500);
    return;
  }
  kbEls.addBtn.disabled = true;
  kbEls.addBtn.textContent = "Adding…";
  try {
    await kbAddSource(name, text);
    kbEls.name.value = "";
    kbEls.text.value = "";
    kbEls.addBtn.textContent = "✓ Added";
  } catch (err) {
    kbEls.addBtn.textContent = `⚠️ ${err.message || "Failed"}`;
  } finally {
    setTimeout(() => {
      kbEls.addBtn.disabled = false;
      kbEls.addBtn.textContent = "Add source";
    }, 1200);
  }
});

kbRefresh();

// Initial tool render — runs last, after every const/let above is initialised.
applyMode("explain");
