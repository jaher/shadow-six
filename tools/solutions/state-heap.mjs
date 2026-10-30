/**
 * The sneak planners' open list (driver.mjs / sneak.mjs planSneakGen): a binary min-heap of (f, cell, step) states in
 * three typed arrays instead of a [f, c, k] array per push. A search pushes up to a million states while its plan runs
 * over many frames: as arrays they outlived the young generation and were promoted (old-space growth → major GCs);
 * here they are three flat buffers. Same order as the array heap it replaces: sift up while the parent's f is greater,
 * sift down to the smaller child (the left one on a tie), ties never swapped.
 * @module tools/solutions/state-heap
 */
export class StateHeap {
  constructor(cap = 4096) {
    this.f = new Float64Array(cap);
    this.c = new Int32Array(cap);
    this.k = new Int32Array(cap);
    this.length = 0;
    /** The state the last pop() took (its cell and step). */
    this.topC = -1;
    this.topK = -1;
  }

  _grow() {
    const n = this.f.length * 2, f = new Float64Array(n), c = new Int32Array(n), k = new Int32Array(n);
    f.set(this.f); c.set(this.c); k.set(this.k);
    this.f = f; this.c = c; this.k = k;
  }

  _swap(a, b) {
    const F = this.f, C = this.c, K = this.k;
    const f = F[a], c = C[a], k = K[a];
    F[a] = F[b]; C[a] = C[b]; K[a] = K[b];
    F[b] = f; C[b] = c; K[b] = k;
  }

  push(f, c, k) {
    if (this.length === this.f.length) this._grow();
    let i = this.length++;
    this.f[i] = f; this.c[i] = c; this.k[i] = k;
    const F = this.f;
    while (i > 0) { const p = (i - 1) >> 1; if (F[p] <= F[i]) break; this._swap(p, i); i = p; }
  }

  /** Take the state with the least f into topC / topK (the heap must not be empty). */
  pop() {
    this.topC = this.c[0]; this.topK = this.k[0];
    const n = --this.length;
    if (n) {
      this.f[0] = this.f[n]; this.c[0] = this.c[n]; this.k[0] = this.k[n];
      const F = this.f;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n && F[l] < F[m]) m = l;
        if (r < n && F[r] < F[m]) m = r;
        if (m === i) break;
        this._swap(m, i); i = m;
      }
    }
  }
}

/**
 * The sneak planners' reached states: key (cell × KS + step, ≥ 0) → the key it was reached from (-1: the start), and
 * whether it was expanded (done). An open-addressing hash in typed arrays, emptied in O(1) by a generation stamp and
 * reused plan after plan (takeSet / giveSet): a plan's Map and Set grew to tens of thousands of entries, lived through
 * many frames and were promoted — most of what a planning stretch left the next major GC. The same answers as the Map
 * (has / get / set) and the Set (isDone / markDone; doneKeys in the order marked) it replaces.
 */
export class StateSet {
  constructor(bits = 14) { this._alloc(bits); this.size = 0; this.done = new Int32Array(1 << 12); this.nDone = 0; }

  _alloc(bits) {
    const n = 1 << bits;
    this.bits = bits; this.mask = n - 1; this.gen = 1;
    this.keys = new Int32Array(n); this.vals = new Int32Array(n); this.stamp = new Int32Array(n); this.flag = new Uint8Array(n);
  }

  /** The slot of `key`, or the free slot it would take. */
  _slot(key) {
    const keys = this.keys, stamp = this.stamp, mask = this.mask, gen = this.gen;
    let i = Math.imul(key, 0x9e3779b1) >>> (32 - this.bits);
    while (stamp[i] === gen && keys[i] !== key) i = (i + 1) & mask;
    return i;
  }

  has(key) { return this.stamp[this._slot(key)] === this.gen; }

  /** The key `key` was reached from (-1: the start), or undefined if never reached. */
  get(key) { const i = this._slot(key); return this.stamp[i] === this.gen ? this.vals[i] : undefined; }

  set(key, from) {
    let i = this._slot(key);
    if (this.stamp[i] !== this.gen) {
      if ((this.size + 1) * 2 > this.mask + 1) { this._grow(); i = this._slot(key); }
      this.stamp[i] = this.gen; this.keys[i] = key; this.flag[i] = 0; this.size++;
    }
    this.vals[i] = from;
  }

  isDone(key) { const i = this._slot(key); return this.stamp[i] === this.gen && this.flag[i] === 1; }

  /** Mark reached state `key` expanded (it must have been set). */
  markDone(key) {
    this.flag[this._slot(key)] = 1;
    if (this.nDone === this.done.length) { const d = new Int32Array(this.done.length * 2); d.set(this.done); this.done = d; }
    this.done[this.nDone++] = key;
  }

  /** The expanded keys, in the order they were marked. */
  doneKeys() { return this.done.subarray(0, this.nDone); }

  _grow() {
    const { keys, vals, stamp, flag, gen } = this, n = keys.length;
    this._alloc(this.bits + 1);
    for (let j = 0; j < n; j++) if (stamp[j] === gen) { const i = this._slot(keys[j]); this.stamp[i] = 1; this.keys[i] = keys[j]; this.vals[i] = vals[j]; this.flag[i] = flag[j]; }
  }

  /** Empty (O(1): a new generation). */
  reset() {
    this.size = 0; this.nDone = 0;
    if (++this.gen > 0x7fffffff) { this.stamp.fill(0); this.gen = 1; }
  }
}

// (pools: a planner takes its open list and reached states and gives them back when it returns — one or two plans run
// at once; a plan that grew one past POOL_MAX leaves it to the GC rather than keep tens of MB for good)
const HEAPS = [], SETS = [], POOL_N = 3, POOL_MAX = 1 << 20;
/** An empty StateHeap (from the pool). */
export function takeHeap() { const h = HEAPS.pop() || new StateHeap(); h.length = 0; return h; }
/** Give a StateHeap back (the planner no longer reads it). */
export function giveHeap(h) { if (HEAPS.length < POOL_N && h.f.length <= POOL_MAX) HEAPS.push(h); }
/** An empty StateSet (from the pool). */
export function takeSet() { const s = SETS.pop() || new StateSet(); s.reset(); return s; }
/** Give a StateSet back (the planner no longer reads it). */
export function giveSet(s) { if (SETS.length < POOL_N && s.keys.length <= POOL_MAX) SETS.push(s); }
