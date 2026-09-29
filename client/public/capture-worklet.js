// Downsamples mic input to 16kHz PCM16 and posts ~40ms chunks to the main thread.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.buf = [];
  }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]));
      this.buf.push(s < 0 ? s * 0x8000 : s * 0x7fff);
    }
    this.pos -= ch.length;
    if (this.buf.length >= 640) {
      const out = Int16Array.from(this.buf);
      this.port.postMessage(out.buffer, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor("capture-processor", CaptureProcessor);
