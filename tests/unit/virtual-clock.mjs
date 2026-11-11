/**
 * A virtual clock for the tests of time-slicing code (driver-breathe). Not a *.test.mjs file.
 *
 * `performance.now()` reads a counter that only `spin(ms)` moves, so what a slice has spent is exactly what the test
 * spun in it, however loaded the host is: on the real clock a slice that should hold 5.2 ms of 6 gets an extra pause
 * from any stall over 0.8 ms (driver-breathe failed that way on a host at load 73). `restore()` puts the real clock
 * back: call it in a finally.
 */
export function virtualClock() {
  let t = 0;
  performance.now = () => t; // (shadows the method on the prototype)
  return { spin: (ms) => { t += ms; }, now: () => t, restore: () => { delete performance.now; } };
}
