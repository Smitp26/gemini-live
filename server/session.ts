import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import type { WebSocket } from "ws";
import type { ServerMessage } from "../shared/protocol.js";
import { INPUT_SAMPLE_RATE } from "../shared/protocol.js";
import { functionDeclarations, handlers } from "./tools.js";

const SYSTEM_INSTRUCTION =
  "You are a friendly, concise voice assistant. Keep answers short and conversational. " +
  "Use the provided tools when they help.";

export async function startVoiceSession(client: WebSocket, ai: GoogleGenAI): Promise<void> {
  const send = (msg: ServerMessage) => {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(msg));
  };
  let session: Session | undefined;

  const onMessage = async (msg: LiveServerMessage) => {
    const sc = msg.serverContent;
    if (sc?.interrupted) send({ type: "interrupted" });
    for (const part of sc?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && client.readyState === client.OPEN) {
        client.send(Buffer.from(part.inlineData.data, "base64"), { binary: true });
      }
    }
    if (sc?.inputTranscription?.text) send({ type: "inputTranscript", text: sc.inputTranscription.text });
    if (sc?.outputTranscription?.text) send({ type: "outputTranscript", text: sc.outputTranscription.text });
    if (sc?.turnComplete) send({ type: "turnComplete" });

    if (msg.toolCall?.functionCalls) {
      const functionResponses = [];
      for (const fc of msg.toolCall.functionCalls) {
        const args = (fc.args ?? {}) as Record<string, unknown>;
        let result: unknown;
        try {
          const h = handlers[fc.name ?? ""];
          result = h ? await h(args) : { error: `Unknown tool ${fc.name}` };
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) };
        }
        send({ type: "toolCall", name: fc.name ?? "", args, result });
        functionResponses.push({ id: fc.id, name: fc.name, response: { result } });
      }
      session?.sendToolResponse({ functionResponses });
    }
  };

  // Register before connecting so no client audio arriving during setup is missed.
  client.on("message", (data, isBinary) => {
    if (!session) return;
    if (isBinary) {
      session.sendRealtimeInput({
        audio: {
          data: (data as Buffer).toString("base64"),
          mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
        },
      });
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === "text" && typeof m.text === "string") session.sendRealtimeInput({ text: m.text });
    } catch {
      // ignore malformed client messages
    }
  });
  client.on("close", () => session?.close());

  session = await ai.live.connect({
    model: process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live",
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: SYSTEM_INSTRUCTION,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_VOICE ?? "Puck" } },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [{ functionDeclarations }],
    },
    callbacks: {
      onopen: () => send({ type: "ready" }),
      onmessage: (m) => void onMessage(m).catch((e) => send({ type: "error", message: String(e) })),
      onerror: (e) => send({ type: "error", message: e.message }),
      onclose: (e) => {
        send({ type: "closed", reason: e.reason || "session closed" });
        client.close();
      },
    },
  });
}
