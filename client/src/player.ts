import { OUTPUT_SAMPLE_RATE } from "../../shared/protocol";

export class AudioPlayer {
  private ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  enqueue(pcm16: ArrayBuffer) {
    const i16 = new Int16Array(pcm16);
    const buf = this.ctx.createBuffer(1, i16.length, OUTPUT_SAMPLE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < i16.length; i++) ch[i] = i16[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + 0.02);
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  // Barge-in: drop everything queued when the model is interrupted.
  flush() {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  resume() {
    return this.ctx.resume();
  }

  close() {
    this.flush();
    return this.ctx.close();
  }
}
