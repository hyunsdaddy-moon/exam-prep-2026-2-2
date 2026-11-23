/*
 * 시험 준비 웹앱 — 오답 복습 · 완전 학습 판정 · 진도율 (docs/시험준비탭개발계획서.md §6·§7, 3단계)
 * 화면과 떨어진 순수 함수. test/exam-prep-progress.test.mjs 가 직접 부른다.
 *
 * 날짜는 "YYYY-MM-DD" 글자로 다룬다. 기록의 시각(ISO)을 날짜로 바꾸는 일은 dayOf 가 맡는다
 * (화면에서는 이 기기의 시간대, 검사에서는 정해 준 함수).
 */

/** 이 기기의 시간대로 본 날짜 */
export function localDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 날짜에 며칠을 더한다 */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 두 날짜 사이의 날수 (to - from) */
export function daysBetween(from, to) {
  const u = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((u(to) - u(from)) / 86400000);
}

/**
 * 문제별 풀이 흐름. 채점이 끝난 풀이만 센다(서술형은 스스로 채점한 뒤).
 * 서술형은 만점일 때만 맞은 것으로 친다.
 * @returns Map<문제 id, {at, day, correct, errorType, confidence, mode}[]> — 오래된 것부터
 */
export function buildHistories(attempts, dayOf = localDay) {
  const map = new Map();
  for (const a of attempts) {
    let correct;
    if (a.qtype === 'essay') {
      if (!a.graded || typeof a.earned !== 'number') continue;
      correct = typeof a.points === 'number' ? a.earned >= a.points : false;
    } else {
      if (!Array.isArray(a.picked) || !a.picked.length || typeof a.correct !== 'boolean') continue;
      correct = a.correct;
    }
    if (!map.has(a.q)) map.set(a.q, []);
    map.get(a.q).push({ at: String(a.at || ''), day: dayOf(a.at), correct, errorType: a.errorType ?? null, confidence: a.confidence ?? null, mode: a.mode });
  }
  for (const list of map.values()) list.sort((x, y) => x.at.localeCompare(y.at));
  return map;
}

/**
 * 한 문제의 복습 상태.
 *   none       한 번도 틀린 적 없음 (오답 노트에 없다)
 *   due        오늘 다시 풀 차례
 *   waiting    오늘 맞혔으니 다른 날 한 번 더 (같은 날 두 번은 외운 답일 수 있다)
 *   graduated  틀린 뒤로 서로 다른 날에 연속 2번 맞힘 — 졸업
 */
export function reviewState(history, today) {
  const list = history || [];
  const wrongCount = list.filter((h) => !h.correct).length;
  if (!wrongCount) return { status: 'none', wrongCount: 0, streak: 0, dueDay: null };
  let lastWrong = -1;
  list.forEach((h, i) => {
    if (!h.correct) lastWrong = i;
  });
  const after = list.slice(lastWrong + 1);
  const days = [...new Set(after.map((h) => h.day))];
  const streak = after.length;
  if (streak >= 2 && days.length >= 2) return { status: 'graduated', wrongCount, streak, dueDay: null };
  if (!streak) return { status: 'due', wrongCount, streak, dueDay: today };
  const lastDay = after[after.length - 1].day;
  const dueDay = addDays(lastDay, 1);
  return { status: dueDay <= today ? 'due' : 'waiting', wrongCount, streak, dueDay };
}

/** 과목의 오답 노트: 틀린 적 있는 문제와 그 상태. 복습할 것 → 기다리는 것 → 졸업 순. */
export function wrongNotes(questions, histories, today) {
  const order = { due: 0, waiting: 1, graduated: 2 };
  const rows = [];
  for (const q of questions) {
    const history = histories.get(q.id) || [];
    const state = reviewState(history, today);
    if (state.status === 'none') continue;
    const lastWrong = [...history].reverse().find((h) => !h.correct);
    rows.push({ question: q, history, ...state, errorType: lastWrong?.errorType ?? null });
  }
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.question.no - b.question.no);
}

export const CONCEPT_STATES = ['unseen', 'read', 'tried', 'mastered'];
export const CONCEPT_LABEL = { unseen: '안 봄', read: '읽음', tried: '풀어 봄', mastered: '익힘' };
const CONCEPT_SCORE = { unseen: 0, read: 0.25, tried: 0.5, mastered: 1 };

/**
 * 개념 하나의 상태와 점수.
 *   익힘: 그 개념의 문제를 모두 한 번 이상 풀었고, 문제별 마지막 결과의 정답률이 80% 이상이며, 졸업 못 한 오답이 없다.
 *   문제가 하나도 없는 개념은 읽기만 하면 끝난 것으로 친다(풀 것이 없으므로).
 */
export function conceptProgress(concept, questions, histories, readSet, today) {
  const mine = questions.filter((q) => (q.concepts || []).includes(concept.id));
  const read = readSet.has(concept.id);
  const tried = mine.filter((q) => (histories.get(q.id) || []).length > 0);
  const lastRight = tried.filter((q) => histories.get(q.id).at(-1).correct).length;
  const open = mine.filter((q) => ['due', 'waiting'].includes(reviewState(histories.get(q.id), today).status)).length;
  const accuracy = tried.length ? lastRight / tried.length : null;
  let state = 'unseen';
  if (read) state = 'read';
  if (tried.length) state = 'tried';
  if (mine.length && tried.length === mine.length && accuracy >= 0.8 && !open) state = 'mastered';
  const score = !mine.length ? (read ? 1 : 0) : CONCEPT_SCORE[state];
  return { id: concept.id, state, score, read, questions: mine.length, tried: tried.length, accuracy, open };
}

/** 진도율(%) = Σ(개념 점수 × 중요도) ÷ Σ(중요도) × 100 */
export function progressPercent(concepts, states) {
  const byId = new Map(states.map((s) => [s.id, s]));
  let sum = 0;
  let weight = 0;
  for (const c of concepts) {
    const w = c.importance || 1;
    weight += w;
    sum += (byId.get(c.id)?.score || 0) * w;
  }
  return weight ? Math.round((sum / weight) * 100) : 0;
}

/** 숙련도(%) — 풀어 본 문제 중 마지막 결과가 맞은 비율. 푼 것이 없으면 null. */
export function masteryPercent(questions, histories) {
  const tried = questions.filter((q) => (histories.get(q.id) || []).length > 0);
  if (!tried.length) return null;
  return Math.round((tried.filter((q) => histories.get(q.id).at(-1).correct).length / tried.length) * 100);
}

/** 과목 하나의 공부 상태를 한데 모은다 */
export function subjectStudy(concepts, questions, histories, readSet, today) {
  const states = concepts.map((c) => conceptProgress(c, questions, histories, readSet, today));
  const notes = wrongNotes(questions, histories, today);
  const count = (state) => states.filter((s) => s.state === state).length;
  return {
    states,
    notes,
    progress: progressPercent(concepts, states),
    mastery: masteryPercent(questions, histories),
    due: notes.filter((n) => n.status === 'due'),
    waiting: notes.filter((n) => n.status === 'waiting').length,
    graduated: notes.filter((n) => n.status === 'graduated').length,
    counts: { unseen: count('unseen'), read: count('read'), tried: count('tried'), mastered: count('mastered') },
    triedQuestions: questions.filter((q) => (histories.get(q.id) || []).length > 0).length,
    weakest: concepts
      .map((c, i) => ({ concept: c, ...states[i] }))
      .filter((s) => s.tried && s.accuracy < 0.8)
      .sort((a, b) => a.accuracy - b.accuracy || (b.concept.importance || 1) - (a.concept.importance || 1))
      .slice(0, 3),
  };
}

/** 틀린 풀이의 까닭 분포. 까닭을 안 고른 것은 none. */
export function errorBreakdown(attempts) {
  const out = { concept: 0, misread: 0, calc: 0, time: 0, none: 0, total: 0, sureWrong: 0 };
  for (const a of attempts) {
    const wrong = a.qtype === 'essay' ? a.graded && typeof a.points === 'number' && a.earned < a.points : a.correct === false && Array.isArray(a.picked) && a.picked.length > 0;
    if (!wrong) continue;
    out.total++;
    if (a.errorType && a.errorType in out) out[a.errorType]++;
    else out.none++;
    if (a.confidence === 'sure') out.sureWrong++;
  }
  return out;
}

/** 시험일까지: { days, label } — 오늘이면 D-DAY, 지났으면 D+n. 날짜가 없거나 틀리면 null. */
export function dday(examDay, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDay || '')) return null;
  const days = daysBetween(today, examDay);
  return { days, label: days === 0 ? 'D-DAY' : days > 0 ? `D-${days}` : `D+${-days}` };
}
