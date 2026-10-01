/**
 * Minimal mock of the WebAudio API for Node unit tests: records every node, connection and
 * started/stopped source so tests can assert what was scheduled. `ctx.currentTime` is writable.
 */
class Param {
  constructor(v = 0) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); }
  linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['ramp', v, t]); } // jump: tests read the target
  cancelScheduledValues(t) { this.events.push(['cancel', t]); }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outputs = []; ctx.nodes.push(this); }
  connect(n) { this.outputs.push(n); return n; }
  disconnect() { this.outputs = []; }
}
class Gain extends Node { constructor(c) { super(c, 'gain'); this.gain = new Param(1); } }
class Panner extends Node { constructor(c) { super(c, 'pan'); this.pan = new Param(0); } }
class Source extends Node {
  constructor(c) { super(c, 'source'); this.playbackRate = new Param(1); this.loop = false; this.buffer = null; this.started = null; this.stopped = null; }
  start(t = 0, off = 0) { this.started = t; this.offset = off; this.ctx.started.push(this); }
  stop(t = 0) { this.stopped = t; if (!this.loop) this.onended?.(); }
}
class Buffer {
  constructor(ch, len, sr) { this.numberOfChannels = ch; this.length = len; this.sampleRate = sr; this.duration = len / sr; this.data = new Float32Array(len); }
  copyToChannel(pcm) { this.data.set(pcm); }
  getChannelData() { return this.data; }
}

export class MockAudioContext {
  constructor() {
    this.nodes = [];
    this.started = [];
    this.currentTime = 0;
    this.state = 'suspended';
    this.destination = { kind: 'destination' };
    this.resumed = 0;
  }
  createGain() { return new Gain(this); }
  createStereoPanner() { return new Panner(this); }
  createBufferSource() { return new Source(this); }
  createBuffer(ch, len, sr) { return new Buffer(ch, len, sr); }
  resume() { this.state = 'running'; this.resumed++; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  /** Sources still sounding (started, not stopped). */
  playing() { return this.started.filter((s) => s.stopped == null); }
  /** Which bus a source ends up in: follow source → gain → pan → bus. */
  busOf(src, busses) {
    let n = src;
    for (let k = 0; k < 4 && n; k++) {
      for (const [name, b] of Object.entries(busses)) if (n.outputs.includes(b)) return name;
      n = n.outputs[0];
    }
    return null;
  }
}

/** A tiny in-memory event bus compatible with core/events.js (on → unsubscribe, emit). */
export { EventBus } from '../../src/core/events.js';
