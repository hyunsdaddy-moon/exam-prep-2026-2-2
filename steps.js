/*
 * 시험 준비 웹앱 — 과목 화면의 「공부 순서 3단계」에 쓰는 진행 상황 계산
 *
 *   ① 공부하기   문서마다: 개념 읽음 수 · 확인 문제(drill) 매긴 수 · 마무리 평가(docquiz) 점수
 *   ② 실전 연습   단원평가 1~5(units series 'mock') · 예상 문제(실전) 점수
 *   ③ 마무리     오답 노트 · 수준 평가
 *
 * 기록은 새로 만들지 않는다. 이미 있는 풀이 기록(merged)과 이 기기의 확인 문제 표시만 읽는다.
 */

import { getCurrentLearner } from './store.js?v=20261126-1051';
import { summarize } from './grade.mjs?v=20261126-1051';
import { syncDrillMarks } from './drill.js?v=20261126-1051';

const DRILL_KEY = 'examprep.2026-2-2.drill';
const DOCQUIZ_ROUND = 40; // docquiz.js 와 같은 값
const UNIT_ROUND = 10;    // units.js 와 같은 값

function drillMarks() {
  try { return JSON.parse(localStorage.getItem(DRILL_KEY) || '{}')[getCurrentLearner()] || {}; } catch { return {}; }
}

const json = (ctx, path, empty) => ctx.getJson(path).catch(() => empty);
const nfc = (t) => String(t || '').normalize('NFC');

/** 세션 목록 → { tries, best, last } (점수는 100점 기준 정수) */
function scoreList(sessions, scoreOf) {
  const list = sessions
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((s) => ({ session: s.session, at: s.at, score: scoreOf(s) }))
    .filter((x) => x.score != null);
  if (!list.length) return null;
  return { tries: list.length, best: Math.max(...list.map((x) => x.score)), last: list.at(-1) };
}

/**
 * @param ctx      app 의 ctx (getJson)
 * @param s        과목 { code, subject, ... }
 * @param docs     docsOf(s) — 문서 번호(docIndex)는 이 순서
 * @param merged   study.merged (지금 참여자의 sessions · attempts)
 * @param paper    예상 문제지 문항 { questions }
 */
export async function loadSubjectSteps(ctx, s, docs, merged, paper) {
  const [drill, quiz, units] = await Promise.all([
    json(ctx, `data/drill/${s.code}.json`, { docs: {} }),
    json(ctx, `data/docquiz/${s.code}.json`, { docs: {} }),
    json(ctx, `data/units/${s.code}.json`, { units: [] }),
  ]);
  const marks = await syncDrillMarks().catch(() => drillMarks());
  const sessions = [...(merged?.sessions?.values?.() || [])].filter((x) => x.subject === s.code);
  const attemptsBy = new Map();
  for (const a of merged?.attempts || []) {
    if (!attemptsBy.has(a.session)) attemptsBy.set(a.session, []);
    attemptsBy.get(a.session).push(a);
  }
  const earned = (qs) => (sess) => {
    const at = attemptsBy.get(sess.session) || [];
    if (!at.length) return null;
    const sum = summarize(qs, at);
    return sum.max ? Math.round((sum.earned / sum.max) * 100) : null;
  };

  /* ① 문서마다 */
  const byDoc = new Map();
  docs.forEach((d, i) => {
    const file = nfc(d.file);
    const sets = drill.docs?.[file] || [];
    const items = sets.flatMap((set) => set.items || []);
    const drillDone = items.filter((it) => marks[it.id]).length;
    const qs = quiz.docs?.[file]?.questions || [];
    let quizScore = null;
    if (qs.length) {
      const ids = new Set(qs.map((q) => q.id));
      const right = (sess) => {
        const at = (attemptsBy.get(sess.session) || []).filter((a) => ids.has(a.q));
        if (!at.length) return null;
        const ok = new Set(at.filter((a) => a.correct === true).map((a) => a.q));
        return Math.round((ok.size / qs.length) * 100);
      };
      quizScore = scoreList(sessions.filter((x) => x.mode === 'assess' && x.round === DOCQUIZ_ROUND + i), right);
    }
    byDoc.set(d.file, {
      drill: { done: drillDone, total: items.length },
      quiz: qs.length ? { total: qs.length, score: quizScore } : null,
    });
  });

  /* ② 단원평가 1~5 · 단원별 10문항 */
  const unitScore = (u) => scoreList(
    sessions.filter((x) => x.mode === 'assess' && x.round === UNIT_ROUND + Number(String(u.id).replace(/^u/, ''))),
    earned(u.questions || [])
  );
  const all = units.units || [];
  const mocks = all.filter((u) => u.series === 'mock').map((u) => ({ id: u.id, short: u.short || u.title, count: u.questions?.length || 0, minutes: u.minutes, score: unitScore(u) }));
  const plain = all.filter((u) => u.series !== 'mock').map((u) => ({ id: u.id, short: u.short || u.title, score: unitScore(u) }));

  /* ② 예상 문제 (실전으로 푼 것) */
  const exam = paper?.questions?.length
    ? scoreList(sessions.filter((x) => x.mode === 'exam'), earned(paper.questions))
    : null;

  return { byDoc, mocks, plain, exam };
}

/**
 * 다음에 할 일 하나를 고른다.
 * docRows: [{ doc, index, concepts: { read, total }, drill, quiz }]  (공부 순서대로)
 * 돌려주는 것: { text, href, step } 또는 null
 */
export function pickNextStep(code, docRows, steps, due) {
  if (due > 0) return { step: '③', text: `오답 노트 — 오늘 복습할 문제 ${due}개`, href: `#/s/${code}/review` };
  for (const r of docRows) {
    if (r.concepts.total && r.concepts.read < r.concepts.total) {
      return { step: '①', text: `「${r.doc.title}」 ${r.concepts.read ? '이어 읽기' : '읽기 시작'} (개념 ${r.concepts.read}/${r.concepts.total})`, href: `#/s/${code}/${r.index}` };
    }
    if (r.drill.total && r.drill.done < r.drill.total) {
      return { step: '①', text: `「${r.doc.title}」 확인 문제 (${r.drill.done}/${r.drill.total})`, href: `#/s/${code}/${r.index}` };
    }
    if (r.quiz && !r.quiz.score) {
      return { step: '①', text: `「${r.doc.title}」 마무리 평가 풀기 (${r.quiz.total}문항)`, href: `#/s/${code}/${r.index}` };
    }
  }
  const mock = steps.mocks.find((m) => !m.score);
  if (mock) return { step: '②', text: `${mock.short} 풀기 (${mock.count}문항 · 기출 형식)`, href: `#/units/${code}/${mock.id}` };
  if (!steps.exam) return { step: '②', text: '예상 문제 실전으로 풀기', href: `#/s/${code}/exam` };
  const low = steps.mocks.filter((m) => m.score && m.score.best < 80).sort((a, b) => a.score.best - b.score.best)[0];
  if (low) return { step: '②', text: `${low.short} 다시 풀기 (최고 ${low.score.best}점 → 80점 넘기기)`, href: `#/units/${code}/${low.id}` };
  return { step: '③', text: '수준 평가 2차로 마지막 점검', href: '#/assess' };
}
