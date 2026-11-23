/*
 * 시험 준비 웹앱 — 풀이 기록 저장 및 참여자 상태 관리 (GitHub Pages 정적 호스팅 전용)
 * 서버가 없으므로 이 기기의 브라우저(localStorage)에만 기록을 보관합니다.
 */

import { DEFAULT_LEARNER, normalizeLearner } from './grade.mjs';

export { DEFAULT_LEARNER, normalizeLearner };

const STORAGE_KEY = 'examprep.2026-2-2.records';
const MAX_RECORDS = 5000;
const CURRENT_LEARNER_KEY = 'examprep.learner.current';
const LEARNERS_KEY = 'examprep.learners';

function readStored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function readLearners() {
  try {
    const v = JSON.parse(localStorage.getItem(LEARNERS_KEY) || '[]');
    if (!Array.isArray(v)) return [];
    const seen = [];
    for (const raw of v) {
      const name = normalizeLearner(raw);
      if (name && !seen.includes(name)) seen.push(name);
    }
    return seen;
  } catch {
    return [];
  }
}

function writeLearners(list) {
  try {
    localStorage.setItem(LEARNERS_KEY, JSON.stringify(list));
  } catch {
    // 저장 공간을 못 쓰는 브라우저
  }
}

/** 이 브라우저에 등록해 둔 참여자 목록 */
export function getSavedLearners() {
  return readLearners();
}

/** 지금 선택된 참여자 이름 (없으면 기본) */
export function getCurrentLearner() {
  try {
    return normalizeLearner(localStorage.getItem(CURRENT_LEARNER_KEY) || '') || DEFAULT_LEARNER;
  } catch {
    return DEFAULT_LEARNER;
  }
}

/** 참여자를 전환한다 */
export function setCurrentLearner(name) {
  const clean = normalizeLearner(name) || DEFAULT_LEARNER;
  try {
    localStorage.setItem(CURRENT_LEARNER_KEY, clean);
  } catch {
    // 저장 공간을 못 쓰는 브라우저
  }
  if (clean !== DEFAULT_LEARNER) {
    const list = readLearners();
    if (!list.includes(clean)) writeLearners([...list, clean]);
  }
  return clean;
}

/** 새 참여자를 목록에 더하고 바로 선택한다. 비어 있으면 null */
export function addLearner(name) {
  const clean = normalizeLearner(name);
  if (!clean) return null;
  const list = readLearners();
  if (!list.includes(clean)) writeLearners([...list, clean]);
  try {
    localStorage.setItem(CURRENT_LEARNER_KEY, clean);
  } catch {
    // 저장 공간을 못 쓰는 브라우저
  }
  return clean;
}

export async function flushPending() {
  return true;
}

/** 기록을 브라우저 localStorage 에 덧붙여 저장한다. */
export async function saveRecords(records) {
  if (!records.length) return { ok: true };
  try {
    const learner = getCurrentLearner();
    const now = new Date().toISOString();
    const tagged = records.map((r) => (r && r.type !== 'setting' && !r.learner ? { ...r, learner, at: r.at || now } : { ...r, at: r.at || now }));
    const next = [...readStored(), ...tagged].slice(-MAX_RECORDS);
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
