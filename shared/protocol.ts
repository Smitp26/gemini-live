export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;

// Client -> server JSON messages (binary frames are raw PCM16 mic audio @16kHz)
export type ClientMessage = { type: "text"; text: string };

// Server -> client JSON messages (binary frames are raw PCM16 model audio @24kHz)
export type ServerMessage =
  | { type: "ready" }
  | { type: "interrupted" }
  | { type: "turnComplete" }
  | { type: "inputTranscript"; text: string }
  | { type: "outputTranscript"; text: string }
  | { type: "toolCall"; name: string; args: unknown; result?: unknown }
  | { type: "error"; message: string }
  | { type: "closed"; reason: string };
