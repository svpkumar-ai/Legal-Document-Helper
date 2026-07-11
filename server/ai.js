// AI layer — calls Claude through the official Anthropic SDK.
//
// The API key is read from the ANTHROPIC_API_KEY environment variable only.
// It is NEVER hard-coded or committed: locally it comes from a .env file (which
// is git-ignored); on Vercel it comes from an encrypted project environment
// variable. If the key is absent, requests fail with a clear message.

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const MAX_TOKENS = 8192;

let client = null;

export function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!hasKey()) {
    const err = new Error("ANTHROPIC_API_KEY is not configured on the server.");
    err.code = "NO_KEY";
    throw err;
  }
  if (!client) {
    client = new Anthropic(); // picks up ANTHROPIC_API_KEY from the environment
  }
  return client;
}

// Turn any error into a user-facing message. Distinguishes a missing/invalid key
// from other failures so the operator knows exactly what to fix.
export function friendlyError(err) {
  if (err?.code === "NO_KEY") {
    return "The server is missing its ANTHROPIC_API_KEY. Add it in the Vercel project settings (or a local .env) and redeploy.";
  }
  const status = err?.status;
  if (status === 401 || /invalid x-api-key|authentication/i.test(String(err?.message))) {
    return "The configured ANTHROPIC_API_KEY was rejected (401). Check the key value in your environment settings.";
  }
  if (status === 429) {
    return "Rate limit or quota reached on the Anthropic API. Please wait a moment and try again.";
  }
  return `The AI request failed: ${String(err?.message || err)}`;
}

// Stream a completion. Calls onDelta(textChunk) as text arrives; returns the
// full accumulated text. Streaming keeps the connection alive on long requests
// (which also avoids serverless response timeouts).
export async function streamText({ system, prompt, onDelta, isAborted }) {
  const anthropic = getClient();
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  let full = "";
  stream.on("text", (delta) => {
    if (isAborted?.()) {
      try { stream.abort(); } catch (_) {}
      return;
    }
    full += delta;
    onDelta?.(delta);
  });

  await stream.finalMessage();
  return { text: full };
}
