/**
 * Fonts the user adds themselves (.ttf / .otf / .woff / .woff2).
 * They are stored in this browser (IndexedDB) and registered with the page,
 * so the caption/title canvas drawing can use them like any installed font.
 */
export interface UserFont {
  id: string;
  /** name shown in the lists */
  name: string;
  /** CSS font-family it is registered under */
  family: string;
  data: ArrayBuffer;
}

const DB = 'vbs-user-fonts';
const STORE = 'fonts';
export const FONTS_EVENT = 'vbs-fonts-changed';
const MAX_BYTES = 15 * 1024 * 1024;
const registered = new Set<string>();

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function listUserFonts(): Promise<UserFont[]> {
  try { return (await tx<UserFont[]>('readonly', s => s.getAll())) || []; } catch { return []; }
}

async function register(f: UserFont): Promise<void> {
  if (registered.has(f.id)) return;
  const face = new FontFace(f.family, f.data.slice(0));
  await face.load();
  document.fonts.add(face);
  registered.add(f.id);
}

/** Registers every saved font with the page. Safe to call many times. */
export async function loadUserFonts(): Promise<UserFont[]> {
  const list = await listUserFonts();
  for (const f of list) { try { await register(f); } catch { /* broken file: skip */ } }
  return list;
}

export async function addUserFont(file: File): Promise<UserFont> {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('Use a .ttf, .otf, .woff or .woff2 file.');
  if (file.size > MAX_BYTES) throw new Error('Font file is too large (max 15 MB).');
  const data = await file.arrayBuffer();
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Custom font';
  const font: UserFont = { id, name, family: `VBS Font ${id}`, data };
  await register(font); // throws if the file is not a real font, so nothing broken gets saved
  await tx('readwrite', s => s.put(font));
  window.dispatchEvent(new Event(FONTS_EVENT));
  return font;
}

export async function removeUserFont(id: string): Promise<void> {
  await tx('readwrite', s => s.delete(id));
  window.dispatchEvent(new Event(FONTS_EVENT));
}
