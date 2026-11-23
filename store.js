/*
 * 시험 준비 웹앱 — 풀이 기록 저장 (GitHub Pages 정적 호스팅 전용)
 * 서버가 없으므로 이 기기의 브라우저(localStorage)에만 기록을 보관합니다.
 */

const STORAGE_KEY = 'examprep.2026-2-2.records';
const MAX_RECORDS = 5000;

function readStored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function flushPending() {
  return true;
}

/** 기록을 브라우저 localStorage 에 덧붙여 저장한다. */
export async function saveRecords(records) {
  if (!records.length) return { ok: true };
  try {
    const now = new Date().toISOString();
    const next = [...readStored(), ...records.map((r) => ({ ...r, at: r.at || now }))].slice(-MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** 지금까지 이 브라우저에 저장된 모든 기록을 읽어 온다. */
export async function loadRecords() {
  return { ok: true, records: readStored(), pending: 0 };
}
