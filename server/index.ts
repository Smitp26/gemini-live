import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { WebSocketServer } from "ws";
import { startVoiceSession } from "./session.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Missing GEMINI_API_KEY (copy .env.example to .env)");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });
const port = Number(process.env.PORT ?? 8080);

// Serves the built client (dist/client) in production; in dev, Vite serves it.
// Works from both server/ (tsx) and dist/server/server/ (compiled).
const here = fileURLToPath(new URL(".", import.meta.url));
const clientDir = join(here, here.includes(join("dist", "server")) ? "../../client" : "../dist/client");
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^[/\\]+/, "");
  if (rel.startsWith("..")) {
    res.writeHead(400).end();
    return;
  }
  try {
    const body = await readFile(join(clientDir, rel));
    res.writeHead(200, { "Content-Type": mime[extname(rel)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (client) => {
  startVoiceSession(client, ai).catch((e) => {
    console.error("Session failed:", e);
    client.send(JSON.stringify({ type: "error", message: e instanceof Error ? e.message : String(e) }));
    client.close();
  });
});

server.listen(port, () => console.log(`Voice agent server on http://localhost:${port}`));
