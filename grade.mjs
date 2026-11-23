/*
 * 시험 준비 웹앱 — 채점과 기록 합치기 (화면과 떨어진 순수 함수).
 * 화면이 없어도 돌아가므로 test/exam-prep-grade.test.mjs 가 직접 부른다.
 */

export const CONFIDENCE_LABEL = { sure: '확신', unsure: '애매', guess: '찍음' };
export const ERROR_LABEL = { concept: '개념을 몰랐다', misread: '문제를 잘못 읽었다', calc: '계산 실수', time: '시간이 부족했다' };
export const DEFAULT_LEARNER = '기본';

/** 참여자 이름 다듬기 — 제어문자 제거, 공백 정리, 최대 24자 */
export function normalizeLearner(name) {
  if (typeof name !== 'string') return '';
  let clean = '';
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) clean += ch;
  }
  return clean.replace(/\s+/g, ' ').trim().slice(0, 24);
}

/** 기록 한 줄이 속한 참여자 이름 (없으면 기본) */
export function recordLearner(r) {
  return normalizeLearner(r?.learner) || DEFAULT_LEARNER;
}

/** 기록과 등록 목록에 등장하는 참여자 목록을 중복 없이 만든다 */
export function listLearners(records, extra = []) {
  const recorded = new Set();
  const extraSet = new Set();
  const ordered = [];
  const push = (name) => {
    if (name && !ordered.includes(name)) ordered.push(name);
  };
  for (const r of records || []) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'attempt' || r.type === 'session' || r.type === 'read') {
      const name = recordLearner(r);
      recorded.add(name);
      push(name);
    }
  }
  for (const raw of extra || []) {
    const name = normalizeLearner(raw);
    if (!name) continue;
    extraSet.add(name);
    push(name);
  }
  const hasOther = ordered.some((n) => n !== DEFAULT_LEARNER);
  const filtered = hasOther && !recorded.has(DEFAULT_LEARNER) && !extraSet.has(DEFAULT_LEARNER)
    ? ordered.filter((n) => n !== DEFAULT_LEARNER)
    : ordered;
  return filtered.length ? filtered : [DEFAULT_LEARNER];
}

/** 지정한 참여자의 기록과 공통 설정(examDate)만 추린다 */
export function filterRecordsByLearner(records, learner) {
  const target = normalizeLearner(learner) || DEFAULT_LEARNER;
  return (records || []).filter((r) => {
    if (!r || typeof r !== 'object') return false;
    if (r.type === 'setting') return true;
    if (r.type === 'attempt' || r.type === 'session' || r.type === 'read') return recordLearner(r) === target;
    if (r.type === 'tag' || r.type === 'grade') return normalizeLearner(r.learner) ? recordLearner(r) === target : true;
    return false;
  });
}

/** 참여자 한 명의 기록만 합친다 */
export function mergeRecordsForLearner(records, learner) {
  return mergeRecords(filterRecordsByLearner(records, learner));
}

/** 0.1점 단위로 다듬는다 — 3.5 + 4.0 같은 덧셈에서 생기는 꼬리를 없앤다 */
export const round1 = (n) => Math.round(n * 10) / 10;

/** 선택형 채점. 고른 번호들이 정답과 정확히 같아야 맞다. 고르지 않았으면 틀린 것이 아니라 "안 풂"이다. */
export function gradeChoice(question, picked) {
  const want = [...(question.answer || [])].sort((a, b) => a - b);
  const got = [...new Set(picked || [])].sort((a, b) => a - b);
  const answered = got.length > 0;
  const correct = answered && want.length === got.length && want.every((n, i) => n === got[i]);
  return { answered, correct, earned: correct ? question.points || 0 : 0 };
}

/** 서술형 스스로 채점: 체크한 채점 항목의 점수 합. 배점을 넘지 않는다. */
export function gradeEssayByChecks(question, checks) {
  const rubric = question.rubric || [];
  const sum = rubric.reduce((a, r, i) => a + (checks && checks[i] ? r.score || 0 : 0), 0);
  return round1(Math.min(sum, question.points || 0));
}

/** 채점 항목으로 나눠 채점할 수 있는 문제인지 (항목이 있고 점수 합이 배점과 맞을 때만) */
export function canCheckRubric(question) {
  const rubric = question.rubric || [];
  if (!rubric.length || rubric.some((r) => typeof r.score !== 'number')) return false;
  return Math.abs(rubric.reduce((a, r) => a + r.score, 0) - (question.points || 0)) < 1e-9;
}

/**
 * 기록 줄들 → 풀이 목록. 나중에 덧붙은 실수 유형(tag)·서술형 점수(grade)를 원래 풀이에 합친다.
 * 같은 풀이에 여러 번 붙었으면 마지막 것이 이긴다.
 */
export function mergeRecords(records) {
  const attempts = new Map();
  const sessions = new Map();
  const reads = new Set(); // 끝까지 읽은 개념 id
  const settings = {}; // 마지막 줄이 이긴다
  for (const r of records || []) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'attempt' && r.id) attempts.set(r.id, { ...r, errorType: null });
    else if (r.type === 'session' && r.session) sessions.set(r.session, r);
    else if (r.type === 'read' && r.concept) reads.add(r.concept);
    else if (r.type === 'setting' && typeof r.key === 'string') settings[r.key] = r.value ?? null;
  }
  for (const r of records || []) {
    if (!r || typeof r !== 'object') continue;
    const target = attempts.get(r.attempt);
    if (!target) continue;
    if (r.type === 'tag') target.errorType = r.errorType ?? null;
    else if (r.type === 'grade') {
      target.earned = r.earned;
      target.checks = r.checks || [];
      target.graded = true;
    }
  }
  return { attempts: [...attempts.values()], sessions, reads, settings };
}

/**
 * 한 번의 풀이 묶음을 채점표로 만든다.
 * @param questions 그 시험지의 문제 전체
 * @param attempts  mergeRecords 로 합친 풀이 중 이 묶음의 것
 */
export function summarize(questions, attempts) {
  const byQ = new Map();
  for (const a of attempts) byQ.set(a.q, a); // 같은 문제를 두 번 풀었으면 나중 것
  const part = () => ({ count: 0, answered: 0, correct: 0, earned: 0, max: 0 });
  const choice = part();
  const essay = { ...part(), pending: 0 };
  const rows = [];
  let sureWrong = 0;
  let negativeWrong = 0;
  for (const q of questions) {
    const a = byQ.get(q.id) || null;
    const bucket = q.type === 'essay' ? essay : choice;
    bucket.count++;
    bucket.max += q.points || 0;
    let state = 'blank'; // blank | correct | wrong | pending | partial
    let earned = 0;
    if (q.type === 'choice') {
      const picked = a ? a.picked || [] : [];
      const g = gradeChoice(q, picked);
      if (g.answered) {
        choice.answered++;
        state = g.correct ? 'correct' : 'wrong';
        earned = g.earned;
        if (g.correct) choice.correct++;
        else {
          if (a.confidence === 'sure') sureWrong++;
          if (q.negative) negativeWrong++;
        }
      }
    } else if (a && (a.text || a.graded)) {
      essay.answered++;
      if (a.graded && typeof a.earned === 'number') {
        earned = Math.min(a.earned, q.points || 0);
        state = earned >= (q.points || 0) ? 'correct' : earned > 0 ? 'partial' : 'wrong';
        if (state === 'correct') essay.correct++;
      } else {
        state = 'pending';
        essay.pending++;
      }
    }
    bucket.earned += earned;
    rows.push({ question: q, attempt: a, state, earned: round1(earned) });
  }
  for (const b of [choice, essay]) {
    b.earned = round1(b.earned);
    b.max = round1(b.max);
  }
  return {
    choice,
    essay,
    earned: round1(choice.earned + essay.earned),
    max: round1(choice.max + essay.max),
    pending: essay.pending,
    blank: rows.filter((r) => r.state === 'blank').length,
    sureWrong,
    negativeWrong,
    rows,
  };
}

/** 과목의 지난 풀이 묶음들 — 최근 것부터 */
export function listSessions(merged, subjectCode) {
  const out = [];
  for (const s of merged.sessions.values()) {
    if (s.subject !== subjectCode) continue;
    out.push({ ...s, attempts: merged.attempts.filter((a) => a.session === s.session) });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** 초 → "12분 5초" */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m}분 ${s % 60}초` : `${s}초`;
}

/** 남은 초 → "44:05" */
export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
