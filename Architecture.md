# Architecture

Gemini Live voice agent: a browser client, a Node relay server, and Google's Gemini Live API. Audio streams both ways over WebSockets.

```
Browser (client/)                Node server (server/)              Google
┌──────────────────┐  WebSocket  ┌────────────────────┐  Live API   ┌──────────────┐
│ Mic → Worklet    │──PCM16 16k─▶│ session.ts         │──audio/pcm─▶│ Gemini Live  │
│ AudioPlayer      │◀─PCM16 24k──│  relay + tool loop │◀─audio/text─│ model        │
│ UI transcript    │◀──JSON─────│ tools.ts (handlers)│◀─toolCall───│              │
└──────────────────┘   /ws       └────────────────────┘             └──────────────┘
```

In development, Vite serves the UI on `:5173` and proxies `/ws` to the server on `:8080` (see `vite.config.ts`). In production, the server serves the built `dist/client` itself.

## Project structure

| Path | Purpose |
|---|---|
| `server/index.ts` | HTTP static server, WebSocket endpoint `/ws`, starts one voice session per connection |
| `server/session.ts` | Opens the Gemini Live session, relays audio/text, runs the tool-call loop |
| `server/tools.ts` | Tool declarations (schemas) and handlers (code) |
| `shared/protocol.ts` | Sample rates and typed JSON messages shared by client and server |
| `client/src/main.ts` | UI, WebSocket handling, transcript rendering, start/stop |
| `client/src/player.ts` | Gapless PCM playback and barge-in flush |
| `client/public/capture-worklet.js` | Mic downsampling to 16 kHz PCM16 |

## Conversation flow

1. **Start.** The user clicks Start. The client creates an `AudioPlayer`, requests mic permission and opens `ws://host/ws`.
2. **Session setup.** The server accepts the socket and calls `startVoiceSession`, which opens a Gemini Live session with audio response mode, system prompt, voice, input/output transcription and tool declarations. On connect it sends `{type:"ready"}`.
3. **Mic capture.** On `ready`, the client starts the mic. The AudioWorklet downsamples to 16 kHz, converts to 16-bit PCM and posts ~40 ms chunks (640 samples). Each chunk goes to the server as a binary frame.
4. **Relay to Gemini.** The server base64-encodes each binary frame and calls `session.sendRealtimeInput({ audio })`. Typed text goes as JSON `{type:"text"}` and is sent with `sendRealtimeInput({ text })`.
5. **Gemini's reply.** Gemini streams audio chunks, transcripts, and `interrupted` / `turnComplete` events. The server forwards audio as binary frames and everything else as JSON.
6. **Playback.** `AudioPlayer` converts each PCM16 chunk (24 kHz) to an audio buffer and schedules chunks back-to-back for gapless playback.
7. **Barge-in.** When the user speaks over the agent, Gemini sends `interrupted`. The client calls `flush()`, which stops all queued audio immediately.
8. **Tool calls.** When the model requests a tool, the server runs the matching handler and returns the result with `sendToolResponse`. Gemini then speaks the answer, and the UI shows the call as a "tool" line.

## Wire protocol

Defined in `shared/protocol.ts`.

- **Binary frames, client → server:** raw PCM16 mic audio at 16 kHz.
- **Binary frames, server → client:** raw PCM16 model audio at 24 kHz.
- **JSON, client → server:** `{ type: "text", text }`
- **JSON, server → client:** `ready`, `interrupted`, `turnComplete`, `inputTranscript`, `outputTranscript`, `toolCall`, `error`, `closed`

## Built-in vs user-defined

### Built-in (libraries, browser, Gemini)

| What | Provided by | Role |
|---|---|---|
| Speech recognition, reasoning, speech synthesis | Gemini Live model | All the intelligence. No STT/TTS code exists in this repo. |
| Voice activity detection and interruption | Gemini Live (server-side) | Detects speech start/stop and emits `interrupted`. |
| Transcripts | Gemini, via `inputAudioTranscription` / `outputAudioTranscription` | Enabled in config only. |
| Function calling | Gemini | The model decides when to call a tool and with what arguments. |
| `GoogleGenAI`, `ai.live.connect`, `sendRealtimeInput`, `sendToolResponse`, `Modality`, `Type` | `@google/genai` | SDK for the Live API. |
| `WebSocketServer` | `ws` | WebSocket endpoint. |
| `getUserMedia`, `AudioContext`, `AudioWorklet`, `WebSocket` | Browser | Mic, audio processing, playback, transport. |
| Vite, tsx, concurrently | Tooling | Dev server, TypeScript runner, running both processes. |

### User-defined (this repo)

| What | File | Role |
|---|---|---|
| Relay / session logic | `server/session.ts` | Bridges browser and Gemini, forwards audio and JSON, runs the tool loop. |
| System prompt, voice, model choice | `server/session.ts`, `.env` | Personality and `GEMINI_VOICE` / `GEMINI_LIVE_MODEL`. |
| Tools `get_current_time`, `roll_dice` | `server/tools.ts` | Declaration (schema the model sees) plus handler (code that runs). |
| Static file server and path-traversal guard | `server/index.ts` | Serves the built client and rejects `..` paths. |
| Wire protocol | `shared/protocol.ts` | Shared constants and message types. |
| Downsampler / PCM encoder | `client/public/capture-worklet.js` | Resamples the mic to 16 kHz Int16. |
| Gapless player and flush | `client/src/player.ts` | Schedules chunks and cancels them on interruption. |
| UI and message handling | `client/src/main.ts` | Renders transcripts and tool calls, handles start/stop and text input. |

## Configuration

Set in `.env` (copy from `.env.example`; never commit real keys):

| Variable | Purpose | Default |
|---|---|---|
| `GEMINI_API_KEY` | Gemini API key (required) | none |
| `GEMINI_LIVE_MODEL` | Live model name | `gemini-3.8-live` |
| `GEMINI_VOICE` | Prebuilt voice | `Puck` |
| `PORT` | Server port | `8080` |

## Extending: adding a tool

1. Add a `FunctionDeclaration` (name, description, parameters) to `functionDeclarations` in `server/tools.ts`.
2. Add a handler with the same name to `handlers`. It receives the model's arguments and returns a JSON-serializable result.

Nothing else changes; `session.ts` dispatches by name and returns unknown-tool errors to the model.

## Design notes and limitations

- The API key stays on the server. The browser never talks to Gemini directly.
- Sample rates are dictated by Gemini: 16 kHz in, 24 kHz out.
- Conversation history lives only inside the Gemini session and ends when the socket closes.
- There is no authentication or rate limiting on `/ws`, and no client reconnect logic.
- Verify that the default model name is available to your API key.
