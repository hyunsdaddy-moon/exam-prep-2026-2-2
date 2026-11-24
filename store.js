/*
 * 시험 준비 웹앱 — 풀이 기록 · 참여자 상태 관리 (Firebase Firestore 실시간 공유 + localStorage 폴백)
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, addDoc, writeBatch, onSnapshot, deleteDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { FIREBASE_CONFIG, FIRESTORE_DATABASE_ID, EXAM_ID } from './firebase-config.js?v=20261124-1649';
import { DEFAULT_LEARNER, normalizeLearner } from './grade.mjs?v=20261124-1649';

export { DEFAULT_LEARNER, normalizeLearner };

const STORAGE_KEY = 'examprep.2026-2-2.records';
const PENDING_KEY = 'examprep.2026-2-2.pending';
const MIGRATED_KEY = 'examprep.2026-2-2.migrated';
const EXAM_DATE_KEY = 'examprep.2026-2-2.examDate';
const CLOUD_LEARNERS_KEY = 'examprep.2026-2-2.cloudLearners';
const MAX_RECORDS = 5000;
const CURRENT_LEARNER_KEY = 'examprep.learner.current';
const LEARNERS_KEY = 'examprep.learners';

const VALID_MODES = new Set(['practice', 'exam', 'review', 'assess']);
const VALID_QTYPES = new Set(['choice', 'essay']);
const VALID_CONFIDENCE = new Set(['sure', 'unsure', 'guess']);
const VALID_ERRORS = new Set(['concept', 'misread', 'calc', 'time']);

function readArray(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeArray(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // 저장 공간을 못 쓰는 브라우저
  }
}

function readLearners() {
  const seen = [];
  for (const raw of readArray(LEARNERS_KEY)) {
    const name = normalizeLearner(raw);
    if (name && !seen.includes(name)) seen.push(name);
  }
  return seen;
}

function writeLearners(list) {
  writeArray(LEARNERS_KEY, list);
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

/* ── Firebase 실시간 공유 ─────────────────────────────────────────── */

let db = null;
let uid = null;
let syncStatus = 'connecting'; // 'connecting' | 'connected' | 'offline'
let initPromise = null;
let flushingPromise = null;

let cloudRecords = [];
let cloudLearners = readArray(CLOUD_LEARNERS_KEY).filter((n) => typeof n === 'string'); // 지난번 받은 목록으로 먼저 보여 준다
let cloudExamDate = null;
let hasCloudExamDate = false;
const pendingLearners = new Set();
const listeners = new Set();

function notify(source, extra = {}) {
  for (const fn of listeners) {
    try {
      fn({ status: syncStatus, source, ...extra });
    } catch {
      // 구독자 오류 무시
    }
  }
}

export function getSyncStatus() {
  return syncStatus;
}

export function subscribeCloud(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const strBound = (v, min, max) => (typeof v === 'string' && v.length >= min && v.length <= max ? v : null);
const numBound = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);

/** firestore.rules 의 hasOnly·타입·범위 검사와 정확히 맞춘다 */
function sanitizeForFirestore(r, currentUid) {
  if (!r || typeof r !== 'object' || !currentUid) return null;
  const at = strBound(r.at, 10, 40) || new Date().toISOString();

  if (r.type === 'setting') {
    if (r.key !== 'examDate') return null;
    const val = typeof r.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.value) ? r.value : null;
    return { kind: 'setting', payload: { value: val, updatedAt: at, updatedBy: currentUid } };
  }

  const learner = normalizeLearner(r.learner) || DEFAULT_LEARNER;
  const base = { type: r.type, at, uid: currentUid, learner };

  if (r.type === 'attempt') {
    const id = strBound(r.id, 1, 64);
    const session = strBound(r.session, 1, 64);
    const q = strBound(r.q, 1, 64);
    if (!id || !session || !q || !VALID_MODES.has(r.mode) || !VALID_QTYPES.has(r.qtype)) return null;
    const docData = { ...base, id, session, mode: r.mode, q, qtype: r.qtype };
    if (r.subject === null) docData.subject = null;
    else if (strBound(r.subject, 1, 24)) docData.subject = r.subject;
    if (Array.isArray(r.picked)) docData.picked = r.picked.slice(0, 10);
    if (r.correct === null || typeof r.correct === 'boolean') docData.correct = r.correct;
    if (r.points === null) docData.points = null;
    else if (numBound(r.points, 0, 1000) !== null) docData.points = r.points;
    if (r.earned === null) docData.earned = null;
    else if (numBound(r.earned, 0, 1000) !== null) docData.earned = r.earned;
    if (r.seconds === null) docData.seconds = null;
    else if (numBound(r.seconds, 0, 86400) !== null) docData.seconds = r.seconds;
    if (r.confidence === null || VALID_CONFIDENCE.has(r.confidence)) docData.confidence = r.confidence;
    if (typeof r.text === 'string') docData.text = r.text.slice(0, 4000);
    return { kind: 'record', payload: docData };
  }

  if (r.type === 'tag') {
    const attempt = strBound(r.attempt, 1, 64);
    if (!attempt) return null;
    const errorType = r.errorType === null ? null : VALID_ERRORS.has(r.errorType) ? r.errorType : null;
    if (r.errorType !== null && !errorType) return null;
    return { kind: 'record', payload: { ...base, attempt, errorType } };
  }

  if (r.type === 'grade') {
    const attempt = strBound(r.attempt, 1, 64);
    const earned = numBound(r.earned, 0, 1000);
    if (!attempt || earned === null) return null;
    const checks = Array.isArray(r.checks) ? r.checks.slice(0, 30).map(Boolean) : [];
    return { kind: 'record', payload: { ...base, attempt, earned, checks } };
  }

  if (r.type === 'session') {
    const session = strBound(r.session, 1, 64);
    if (!session || !VALID_MODES.has(r.mode)) return null;
    const docData = { ...base, session, mode: r.mode };
    if (r.subject === null) docData.subject = null;
    else if (strBound(r.subject, 1, 24)) docData.subject = r.subject;
    if (r.round === null) docData.round = null;
    else if (numBound(r.round, 0, 99) !== null) docData.round = r.round;
    if (r.seconds === null) docData.seconds = null;
    else if (numBound(r.seconds, 0, 86400) !== null) docData.seconds = r.seconds;
    if (r.limit === null) docData.limit = null;
    else if (numBound(r.limit, 0, 86400) !== null) docData.limit = r.limit;
    if (r.count === null) docData.count = null;
    else if (numBound(r.count, 0, 1000) !== null) docData.count = r.count;
    if (typeof r.timedOut === 'boolean') docData.timedOut = r.timedOut;
    return { kind: 'record', payload: docData };
  }

  if (r.type === 'profile') {
    const character = typeof r.character === 'string' && /^c\d{2}$/.test(r.character) ? r.character : null;
    if (!character) return null;
    return { kind: 'record', payload: { ...base, character } };
  }

  if (r.type === 'read') {
    const concept = strBound(r.concept, 1, 64);
    if (!concept) return null;
    const docData = { ...base, concept };
    if (r.subject === null) docData.subject = null;
    else if (strBound(r.subject, 1, 24)) docData.subject = r.subject;
    return { kind: 'record', payload: docData };
  }

  return null;
}

async function flushPendingLearners() {
  if (!db || !uid || !pendingLearners.size) return;
  const col = collection(db, 'exams', EXAM_ID, 'learners');
  for (const name of [...pendingLearners]) {
    if (cloudLearners.includes(name)) {
      pendingLearners.delete(name);
      continue;
    }
    try {
      await addDoc(col, { name, createdAt: new Date().toISOString(), createdBy: uid });
      pendingLearners.delete(name);
    } catch {
      // 다음 동기화 때 재시도
    }
  }
}

function migrateLocalOnce() {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    return;
  }
  const existingIds = new Set(cloudRecords.map((r) => r.id).filter(Boolean));
  const existingSessions = new Set(cloudRecords.filter((r) => r.type === 'session').map((r) => r.session));
  const existingReads = new Set(cloudRecords.filter((r) => r.type === 'read').map((r) => `${normalizeLearner(r.learner)}::${r.concept}`));
  const otherKey = (r) => `${r.type}|${normalizeLearner(r.learner) || DEFAULT_LEARNER}|${r.at || ''}|${r.attempt || r.character || ''}`;
  const existingOthers = new Set(cloudRecords.filter((r) => ['profile', 'tag', 'grade'].includes(r.type)).map(otherKey));
  const toPush = [];
  for (const r of readArray(STORAGE_KEY)) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'setting') {
      if (!hasCloudExamDate && r.key === 'examDate' && r.value) toPush.push(r);
      continue;
    }
    if (r.type === 'attempt' && r.id && existingIds.has(r.id)) continue;
    if (r.type === 'session' && r.session && existingSessions.has(r.session)) continue;
    if (r.type === 'read' && existingReads.has(`${normalizeLearner(r.learner) || DEFAULT_LEARNER}::${r.concept}`)) continue;
    // 캐릭터 선택·오답 원인·서술형 채점: 클라우드에 이미 있는 것은 다시 올리지 않는다(기기마다 2배로 불던 문제)
    if (existingOthers.has(otherKey(r))) continue;
    toPush.push(r);
  }
  if (toPush.length) {
    const queue = readArray(PENDING_KEY);
    const tagged = toPush.map((r, i) => ({ ...r, _qid: `m-${Date.now()}-${i}` }));
    writeArray(PENDING_KEY, [...queue, ...tagged].slice(-500));
  }
}

function initCloud() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // 연결 전 이 브라우저에 있던 기록 — 연결된 뒤 클라우드와 같으면 화면을 다시 그리지 않는다
    let baseRecords = '[]';
    let baseExamDate = null;
    try {
      baseRecords = localStorage.getItem(STORAGE_KEY) || '[]';
      baseExamDate = localStorage.getItem(EXAM_DATE_KEY);
    } catch {
      // 저장 공간을 못 쓰는 브라우저
    }
    const baseLearners = [...cloudLearners, ...readLearners()];
    try {
      const app = initializeApp(FIREBASE_CONFIG);
      const auth = getAuth(app);
      const user = auth.currentUser || (await signInAnonymously(auth)).user;
      uid = user.uid;
      db = FIRESTORE_DATABASE_ID && FIRESTORE_DATABASE_ID !== '(default)' ? getFirestore(app, FIRESTORE_DATABASE_ID) : getFirestore(app);

      let gotRecords = false;
      let gotLearners = false;
      let gotSetting = false;
      let resolved = false;
      let resolveReady;
      const ready = new Promise((resolve) => {
        resolveReady = resolve;
      });
      const maybeReady = () => {
        if (!resolved && gotRecords && gotLearners && gotSetting) {
          resolved = true;
          syncStatus = 'connected';
          // 클라우드는 기록 순서도, 기록 안 항목 순서도 매번 달리 준다 → 둘 다 정렬해서 비교한다
          const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
          const sig = (list) => list.map(canon).sort().join('\n');
          let sameRecords = false;
          try {
            sameRecords = sig(cloudRecords.slice(-MAX_RECORDS)) === sig(JSON.parse(baseRecords));
          } catch {
            sameRecords = false;
          }
          const changed =
            !sameRecords ||
            JSON.stringify({ has: hasCloudExamDate, value: cloudExamDate }) !== baseExamDate ||
            cloudLearners.some((n) => !baseLearners.includes(n));
          migrateLocalOnce();
          void flushPending();
          void flushPendingLearners();
          notify('ready', { changed });
          resolveReady(true);
        }
      };

      onSnapshot(
        collection(db, 'exams', EXAM_ID, 'records'),
        (snap) => {
          cloudRecords = snap.docs.map((d) => d.data());
          writeArray(STORAGE_KEY, cloudRecords.slice(-MAX_RECORDS));
          if (!gotRecords) {
            gotRecords = true;
            maybeReady();
          } else {
            syncStatus = 'connected';
            notify('records');
          }
        },
        () => {
          syncStatus = 'offline';
          notify('error');
          if (!resolved) {
            resolved = true;
            resolveReady(false);
          }
        }
      );

      onSnapshot(
        collection(db, 'exams', EXAM_ID, 'learners'),
        (snap) => {
          const seen = [];
          for (const d of snap.docs) {
            const name = normalizeLearner(d.data()?.name);
            if (name && !seen.includes(name)) seen.push(name);
          }
          cloudLearners = seen;
          writeArray(CLOUD_LEARNERS_KEY, seen);
          if (!gotLearners) {
            gotLearners = true;
            maybeReady();
          } else {
            syncStatus = 'connected';
            notify('learners');
          }
        },
        () => {
          syncStatus = 'offline';
          notify('error');
          if (!resolved) {
            resolved = true;
            resolveReady(false);
          }
        }
      );

      onSnapshot(
        doc(db, 'exams', EXAM_ID, 'settings', 'examDate'),
        (snap) => {
          if (snap.exists()) {
            cloudExamDate = snap.data()?.value ?? null;
            hasCloudExamDate = true;
          } else {
            cloudExamDate = null;
            hasCloudExamDate = false;
          }
          try {
            localStorage.setItem(EXAM_DATE_KEY, JSON.stringify({ has: hasCloudExamDate, value: cloudExamDate }));
          } catch {
            // 저장 공간을 못 쓰는 브라우저
          }
          if (!gotSetting) {
            gotSetting = true;
            maybeReady();
          } else {
            syncStatus = 'connected';
            notify('setting');
          }
        },
        () => {
          syncStatus = 'offline';
          notify('error');
          if (!resolved) {
            resolved = true;
            resolveReady(false);
          }
        }
      );

      await Promise.race([
        ready,
        new Promise((resolve) => setTimeout(() => {
          if (!resolved) {
            resolved = true;
            if (syncStatus === 'connecting') syncStatus = 'offline';
            notify('timeout');
            resolve(false);
          }
        }, 4000)),
      ]);
      return syncStatus === 'connected';
    } catch {
      syncStatus = 'offline';
      notify('error');
      return false;
    }
  })();
  return initPromise;
}

/** 이 브라우저와 클라우드에 등록된 참여자 목록 */
export function getSavedLearners() {
  const seen = [];
  for (const name of [...cloudLearners, ...readLearners(), ...pendingLearners]) {
    if (name && !seen.includes(name)) seen.push(name);
  }
  return seen;
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
  if (!cloudLearners.includes(clean)) {
    pendingLearners.add(clean);
    void initCloud().then(() => flushPendingLearners());
  }
  return clean;
}

/** 밀린 기록을 클라우드에 다시 보낸다 */
export async function flushPending() {
  if (flushingPromise) return flushingPromise;
  flushingPromise = (async () => {
    const pending = readArray(PENDING_KEY);
    if (!pending.length) return true;
    await initCloud();
    if (!db || !uid) return false;
    try {
      const recordsCol = collection(db, 'exams', EXAM_ID, 'records');
      const sentIds = new Set();
      const recItems = [];
      for (const raw of pending) {
        const clean = sanitizeForFirestore(raw, uid);
        if (!clean) {
          if (raw?._qid) sentIds.add(raw._qid);
          continue;
        }
        if (clean.kind === 'setting') {
          await setDoc(doc(db, 'exams', EXAM_ID, 'settings', 'examDate'), clean.payload);
          if (raw._qid) sentIds.add(raw._qid);
        } else {
          recItems.push({ qid: raw._qid, payload: clean.payload });
        }
      }
      for (let i = 0; i < recItems.length; i += 400) {
        const chunk = recItems.slice(i, i + 400);
        const batch = writeBatch(db);
        for (const item of chunk) batch.set(doc(recordsCol), item.payload);
        await batch.commit();
        for (const item of chunk) if (item.qid) sentIds.add(item.qid);
      }
      const rest = readArray(PENDING_KEY).filter((r) => !sentIds.has(r._qid));
      writeArray(PENDING_KEY, rest);
      syncStatus = 'connected';
      return rest.length === 0;
    } catch {
      return false;
    } finally {
      flushingPromise = null;
    }
  })();
  return flushingPromise;
}

/** 기록을 클라우드(Firestore)에 저장한다. 오프라인이면 로컬에 잠시 두고 다음에 다시 보낸다. */
export async function saveRecords(records) {
  if (!records.length) return { ok: true };
  const learner = getCurrentLearner();
  const now = new Date().toISOString();
  const tagged = records.map((r, i) => ({
    ...(r && r.type !== 'setting' && !r.learner ? { ...r, learner } : r),
    at: r?.at || now,
    _qid: `q-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
  }));

  // 로컬 캐시 및 대기열에 먼저 반영해 즉시 화면에 보이게 한다
  const stripped = tagged.map(({ _qid, ...rest }) => rest);
  writeArray(STORAGE_KEY, [...readArray(STORAGE_KEY), ...stripped].slice(-MAX_RECORDS));
  writeArray(PENDING_KEY, [...readArray(PENDING_KEY), ...tagged].slice(-500));

  const ok = await flushPending();
  if (ok) return { ok: true };
  return { ok: false, message: '오프라인 상태라 이 브라우저에 임시 보관했습니다. 연결되면 자동으로 동기화됩니다.' };
}

/** 지금까지의 모든 기록 (클라우드 + 아직 못 보낸 것, 오프라인 시 로컬 캐시) */
export async function loadRecords({ fast = false } = {}) {
  // fast: 클라우드 연결을 기다리지 않고 이 브라우저에 남은 기록으로 먼저 그린다.
  // 연결되면 subscribeCloud 의 'ready' 알림으로 화면을 다시 그린다 (홈 첫 화면 전용).
  if (fast && syncStatus === 'connecting') {
    void initCloud();
    const pending = readArray(PENDING_KEY).map(({ _qid, ...rest }) => rest);
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(EXAM_DATE_KEY) || 'null');
    } catch {
      saved = null;
    }
    const settingRecords = saved?.has ? [{ type: 'setting', key: 'examDate', value: saved.value ?? null }] : [];
    return { ok: true, records: [...readArray(STORAGE_KEY), ...settingRecords, ...pending], pending: pending.length, cached: true };
  }
  await initCloud();
  await flushPending();
  const pending = readArray(PENDING_KEY).map(({ _qid, ...rest }) => rest);
  const base = syncStatus === 'connected' ? cloudRecords : readArray(STORAGE_KEY);
  const settingRecords = hasCloudExamDate ? [{ type: 'setting', key: 'examDate', value: cloudExamDate }] : [];
  return { ok: true, records: [...base, ...settingRecords, ...pending], pending: pending.length };
}


/* ── 질문 게시판 (Firestore exams/{시험}/posts) ─────────────────────────────────────────── */

let postsCache = [];
let postsReady = false;
let postsUnsub = null;
const postListeners = new Set();

/** 게시글을 실시간으로 받는다. fn({ posts, ready, online, uid }) — 돌려준 함수로 그만 받는다 */
export function subscribePosts(fn) {
  postListeners.add(fn);
  const emit = () => fn({ posts: postsCache, ready: postsReady, online: !!db, uid });
  void initCloud().then(() => {
    if (!db) {
      postsReady = true;
      emit();
      return;
    }
    if (!postsUnsub) {
      postsUnsub = onSnapshot(
        collection(db, 'exams', EXAM_ID, 'posts'),
        (snap) => {
          postsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
          postsReady = true;
          for (const l of postListeners) l({ posts: postsCache, ready: true, online: true, uid });
        },
        () => {
          postsReady = true;
          for (const l of postListeners) l({ posts: postsCache, ready: true, online: false, uid });
        }
      );
    } else emit();
  });
  if (postsReady) emit();
  return () => postListeners.delete(fn);
}

/** 질문 또는 답글을 올린다. { kind: 'question'|'answer', parent, subject, ref, refText, text } */
export async function addPost(post) {
  await initCloud();
  if (!db || !uid) return { ok: false, message: '인터넷에 연결되어 있어야 글을 올릴 수 있습니다.' };
  const text = String(post.text || '').trim().slice(0, 2000);
  if (!text) return { ok: false, message: '내용을 적어 주세요.' };
  const data = {
    kind: post.kind === 'answer' ? 'answer' : 'question',
    parent: post.kind === 'answer' ? strBound(post.parent, 1, 64) : null,
    learner: getCurrentLearner(),
    subject: strBound(post.subject, 1, 24),
    ref: strBound(post.ref, 1, 64),
    refText: post.refText ? String(post.refText).slice(0, 300) : null,
    text,
    at: new Date().toISOString(),
    uid,
  };
  if (data.kind === 'question') data.solved = false;
  if (data.kind === 'answer' && !data.parent) return { ok: false, message: '답글을 달 질문을 찾지 못했습니다.' };
  try {
    await addDoc(collection(db, 'exams', EXAM_ID, 'posts'), data);
    return { ok: true };
  } catch {
    return { ok: false, message: '글을 올리지 못했습니다. 잠시 뒤 다시 해 보세요.' };
  }
}

/** 질문의 해결 표시를 바꾼다 (누구나) */
export async function setPostSolved(id, solved) {
  await initCloud();
  if (!db) return { ok: false };
  try {
    await updateDoc(doc(db, 'exams', EXAM_ID, 'posts', id), { solved: !!solved });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** 내가(이 브라우저가) 쓴 글을 지운다 */
export async function deletePost(id) {
  await initCloud();
  if (!db) return { ok: false };
  try {
    await deleteDoc(doc(db, 'exams', EXAM_ID, 'posts', id));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
