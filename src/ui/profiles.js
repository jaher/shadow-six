/**
 * User profiles (docs/menus-art-direction.md S04): up to 8 named soldiers, the current one, and the "last operation"
 * record for the MAIN menu's LAST OPERATION tab (amendment B5). Stored in localStorage (try/catch; memory fallback).
 * The career (gold stars, unlocks) stays with game.flow (CORE2); a profile is the name the menus greet.
 * @module ui/profiles
 */

export const PROFILES_KEY = 'shadowsix.profiles.v1';
export const MAX_PROFILES = 8;
export const DEFAULT_NAME = 'COMMANDO';

let memory = null;

function read(storage) {
  try {
    const s = storage?.getItem(PROFILES_KEY);
    if (s) return JSON.parse(s);
  } catch { /* fall back to memory */ }
  return memory;
}

function write(data, storage) {
  memory = data;
  try {
    storage?.setItem(PROFILES_KEY, JSON.stringify(data));
  } catch { /* private mode */ }
}

export class Profiles {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    const d = read(storage) || {};
    this.list = Array.isArray(d.list) ? d.list.filter((p) => p && typeof p.name === 'string').slice(0, MAX_PROFILES) : [];
    this.current = typeof d.current === 'string' ? d.current : null;
    this.firstRunDone = !!d.firstRunDone;
    if (this.current && !this.list.some((p) => p.name === this.current)) this.current = this.list[0]?.name ?? null;
  }

  save() {
    write({ list: this.list, current: this.current, firstRunDone: this.firstRunDone }, this.storage);
  }

  get needsNew() {
    return this.list.length === 0;
  }

  get active() {
    return this.list.find((p) => p.name === this.current) || null;
  }

  exists(name) {
    return this.list.some((p) => p.name === name);
  }

  /** @returns {true|'empty'|'exists'|'full'} */
  create(name) {
    const n = String(name || '').trim().toUpperCase();
    if (!n) return 'empty';
    if (this.exists(n)) return 'exists';
    if (this.list.length >= MAX_PROFILES) return 'full';
    this.list.push({ name: n, created: Date.now(), last: null });
    this.current = n;
    this.save();
    return true;
  }

  select(name) {
    if (!this.exists(name)) return false;
    this.current = name;
    this.save();
    return true;
  }

  rename(name) {
    const p = this.active;
    const n = String(name || '').trim().toUpperCase();
    if (!p || !n) return 'empty';
    if (n !== p.name && this.exists(n)) return 'exists';
    p.name = n;
    this.current = n;
    this.save();
    return true;
  }

  remove(name) {
    this.list = this.list.filter((p) => p.name !== name);
    if (this.current === name) this.current = this.list[0]?.name ?? null;
    this.save();
  }

  /** Remember the last operation for the MAIN menu tab: {missionId, title, n, thumb?, savedAt}. */
  setLast(rec) {
    const p = this.active;
    if (!p) return;
    p.last = { ...rec, at: Date.now() };
    this.save();
  }

  get last() {
    return this.active?.last || null;
  }
}
