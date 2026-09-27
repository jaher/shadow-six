/**
 * Save thumbnails (docs/menus-art-direction.md S09 "Storage"): sepia-graded 256×144 @2× captures kept in IndexedDB,
 * every access in try/catch with an in-memory fallback, so a blocked IndexedDB never breaks saving.
 * @module ui/thumbs
 */

const DB = 'shadowsix-ui', STORE = 'thumbs';
const mem = new Map();
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = globalThis.indexedDB?.open(DB, 1);
      if (!req) return resolve(null);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

export async function putThumb(key, dataURL) {
  mem.set(key, dataURL);
  const d = await db();
  if (!d) return false;
  try {
    return await new Promise((res) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dataURL, key);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  } catch {
    return false;
  }
}

export async function getThumb(key) {
  if (mem.has(key)) return mem.get(key);
  const d = await db();
  if (!d) return null;
  try {
    return await new Promise((res) => {
      const rq = d.transaction(STORE).objectStore(STORE).get(key);
      rq.onsuccess = () => {
        if (rq.result) mem.set(key, rq.result);
        res(rq.result || null);
      };
      rq.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

export async function delThumb(key) {
  mem.delete(key);
  const d = await db();
  if (!d) return;
  try {
    d.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
  } catch { /* ignore */ }
}

/** Grab `canvas` into a w×h JPEG data URL (object-fit: cover), or null. */
export function captureThumb(canvas, w = 512, h = 288) {
  try {
    if (!canvas?.width) return null;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const k = Math.max(w / canvas.width, h / canvas.height);
    const sw = w / k, sh = h / k;
    c.getContext('2d').drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.78);
  } catch {
    return null;
  }
}
