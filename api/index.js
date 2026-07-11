// Vercel serverless entry point.
//
// All /api/* requests are rewritten to this function (see vercel.json). It simply
// re-exports the Express app, which already defines every /api/* route. Static
// files in public/ are served directly by Vercel's CDN and never reach here.
import app from "../server/index.js";

export default app;
