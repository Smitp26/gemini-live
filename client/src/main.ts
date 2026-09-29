import type { ServerMessage } from "../../shared/protocol";
import { AudioPlayer } from "./player";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = $<HTMLButtonElement>("toggle");
const statusEl = $("status");
const log = $("log");
const textForm = $<HTMLFormElement>("textForm");
const textInput = $<HTMLInputElement>("textInput");

let ws: WebSocket | null = null;
let player: AudioPlayer | null = null;
let micCtx: AudioContext | null = null;
let stream: MediaStream | null = null;
let current: { role: string; el: HTMLElement } | null = null;

function line(role: string, text: string, append = false) {
  if (append && current?.role === role) {
    current.el.textContent += text;
  } else {
    const el = document.createElement("div");
    el.className = `line ${role}`;
    el.textContent = text;
    log.appendChild(el);
    current = { role, el };
  }
  log.scrollTop = log.scrollHeight;
}

const setStatus = (s: string) => {
  statusEl.textContent = s;
};

async function start() {
  toggle.disabled = true;
  setStatus("Connecting…");
  player = new AudioPlayer();
  await player.resume();

  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });

  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${proto}://${location.host}/ws`);
  ws = socket;
  socket.binaryType = "arraybuffer";

  socket.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      player?.enqueue(ev.data);
      return;
    }
    const m = JSON.parse(ev.data) as ServerMessage;
    switch (m.type) {
      case "ready":
        void startMic();
        break;
      case "interrupted":
        player?.flush();
        break;
      case "inputTranscript":
        line("user", m.text, true);
        break;
      case "outputTranscript":
        line("agent", m.text, true);
        break;
      case "turnComplete":
        current = null;
        break;
      case "toolCall":
        line("tool", `tool ${m.name}(${JSON.stringify(m.args)}) -> ${JSON.stringify(m.result)}`);
        current = null;
        break;
      case "error":
        line("error", m.message);
        break;
      case "closed":
        line("error", `Closed: ${m.reason}`);
        break;
    }
  };
  socket.onclose = () => {
    if (ws === socket) stop();
  };
  socket.onerror = () => setStatus("Connection error");
}

async function startMic() {
  if (!stream || !ws) return;
  micCtx = new AudioContext();
  await micCtx.audioWorklet.addModule("/capture-worklet.js");
  const node = new AudioWorkletNode(micCtx, "capture-processor");
  node.port.onmessage = (e) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(e.data as ArrayBuffer);
  };
  micCtx.createMediaStreamSource(stream).connect(node);
  setStatus("Listening - speak any time");
  toggle.textContent = "Stop";
  toggle.disabled = false;
  textInput.disabled = false;
}

function stop() {
  const socket = ws;
  ws = null;
  socket?.close();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  void micCtx?.close();
  micCtx = null;
  void player?.close();
  player = null;
  toggle.textContent = "Start";
  toggle.disabled = false;
  textInput.disabled = true;
  setStatus("Idle");
}

toggle.onclick = () => {
  if (ws) stop();
  else
    void start().catch((e) => {
      line("error", String(e));
      stop();
    });
};

textForm.onsubmit = (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "text", text }));
  line("user", text);
  current = null;
  textInput.value = "";
};
