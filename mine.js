/*
 * 시험 준비 웹앱 — 나의 진도 (#/mine)
 *
 * 지금 고른 참여자 한 사람의 진도를 한 장에 보여 준다. 숫자는 과목 화면 「공부 순서 3단계」와 같은 계산(steps.js).
 *
 *   ① 공부하기   개념 읽음 · 확인 문제 · 마무리 평가 응시 — 있는 것끼리 평균
 *   ② 실전 연습   단원평가 1~5 + 예상 문제(실전) 중 푼 것의 비율
 *   ③ 마무리     오답 노트(오늘 복습할 것이 남지 않은 비율) · 수준 평가 2차 응시 — 평균
 *   과목 진도     ① 50% + ② 30% + ③ 20%
 *   전체 진도     과목 진도의 평균
 *
 * 기록은 새로 만들지 않고 읽기만 한다.
 */

import { el } from './dom.js?v=20261128-0659';
import { dday } from './progress.mjs?v=20261128-0659';
import { loadSubjectSteps, pickNextStep } from './steps.js?v=20261128-0659';

export const WEIGHTS = { s1: 0.5, s2: 0.3, s3: 0.2 };
const ASSESS_ROUND_2 = 2; // assess.js ROUNDS d2
const WEAK = 60;

const ratio = (a, b) => (b ? Math.min(1, a / b) : null);
const mean = (list) => {
  const v = list.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const pct = (x) => Math.round((x || 0) * 100);

/** 과목 하나의 3단계 진도 */
async function subjectRow(ctx, h, study, s) {
  const info = study.bySubject.get(s.code);
  const docs = h.docsOf(s);
  const steps = await loadSubjectSteps(ctx, s, docs, study.merged, info);
  const stateOf = new Map(info.states.map((st) => [st.id, st]));
  const concepts = h.conceptsOf(s);
  const isRead = (c) => (stateOf.get(c.id)?.state || 'unseen') !== 'unseen';
  const docRows = h.readingDocs(s).map((d) => {
    const list = concepts.filter((c) => c.doc === d.file);
    const st = steps.byDoc.get(d.file) || { drill: { done: 0, total: 0 }, quiz: null };
    return { doc: d, index: docs.indexOf(d), concepts: { read: list.filter(isRead).length, total: list.length }, drill: st.drill, quiz: st.quiz };
  });

  /* ① 공부하기 */
  const sum = (f) => docRows.reduce((a, r) => a + f(r), 0);
  const c1 = { read: sum((r) => r.concepts.read), total: sum((r) => r.concepts.total) };
  const d1 = { done: sum((r) => r.drill.done), total: sum((r) => r.drill.total) };
  const quizzes = docRows.filter((r) => r.quiz);
  const q1 = { done: quizzes.filter((r) => r.quiz.score).length, total: quizzes.length };
  const s1 = mean([ratio(c1.read, c1.total), ratio(d1.done, d1.total), ratio(q1.done, q1.total)]);

  /* ② 실전 연습 */
  const hasExam = !!info.questions?.length;
  const p2 = { done: steps.mocks.filter((m) => m.score).length + (hasExam && steps.exam ? 1 : 0), total: steps.mocks.length + (hasExam ? 1 : 0) };
  const s2 = ratio(p2.done, p2.total);

  /* ③ 마무리 */
  const notes = info.notes.length;
  const due = info.due.length;
  const started = (s1 || 0) > 0 || (s2 || 0) > 0;
  const noteRatio = notes ? (notes - due) / notes : started ? 1 : 0;
  const assess2 = [...(study.merged?.sessions?.values?.() || [])].some((x) => x.mode === 'assess' && x.subject === s.code && x.round === ASSESS_ROUND_2);
  const s3 = mean([noteRatio, assess2 ? 1 : 0]);

  const total = (s1 || 0) * WEIGHTS.s1 + (s2 || 0) * WEIGHTS.s2 + (s3 || 0) * WEIGHTS.s3;

  /* 점수 — 단원평가 최고점 평균, 없으면 마무리 평가 최고점 평균 */
  const mockBest = steps.mocks.filter((m) => m.score).map((m) => m.score.best);
  const quizBest = quizzes.filter((r) => r.quiz.score).map((r) => r.quiz.score.best);
  const score = mockBest.length
    ? { value: Math.round(mean(mockBest)), label: '단원평가' }
    : quizBest.length ? { value: Math.round(mean(quizBest)), label: '마무리 평가' } : null;

  /* 약점 — 60점 아래 */
  const weak = [
    ...quizzes.filter((r) => r.quiz.score && r.quiz.score.best < WEAK)
      .map((r) => ({ text: `「${r.doc.title}」 마무리 평가`, best: r.quiz.score.best, href: `#/s/${s.code}/${r.index}` })),
    ...steps.mocks.filter((m) => m.score && m.score.best < WEAK)
      .map((m) => ({ text: m.short, best: m.score.best, href: `#/units/${s.code}/${m.id}` })),
  ];

  return {
    s, info, total, score, weak, notes, due, assess2,
    next: pickNextStep(s.code, docRows, steps, due),
    cells: [
      { step: '①', value: s1, href: `#/s/${s.code}`, detail: [c1.total ? `개념 ${c1.read}/${c1.total}` : null, d1.total ? `확인 ${d1.done}/${d1.total}` : null, q1.total ? `평가 ${q1.done}/${q1.total}` : null].filter(Boolean).join(' · ') },
      { step: '②', value: s2, href: `#/s/${s.code}`, detail: [steps.mocks.length ? `단원평가 ${steps.mocks.filter((m) => m.score).length}/${steps.mocks.length}` : null, hasExam ? `예상 문제 ${steps.exam ? '✓' : '아직'}` : null].filter(Boolean).join(' · ') },
      { step: '③', value: s3, href: due ? `#/s/${s.code}/review` : `#/s/${s.code}/notes`, detail: [notes ? `복습 남음 ${due}` : '오답 없음', assess2 ? '2차 ✓' : '2차 아직'].join(' · ') },
    ],
  };
}

function meter(value) {
  const v = pct(value);
  return el(`div.my-meter${value == null ? '.none' : v >= 100 ? '.done' : v > 0 ? '.doing' : ''}`, { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(v) },
    el('i', { style: `width:${v}%` }));
}

function cell(c) {
  if (c.value == null) return el('td.my-cell.none', {}, el('span.my-na', { text: '해당 없음' }));
  const v = pct(c.value);
  return el('td.my-cell', {},
    el('a', { href: c.href, title: `${c.step} ${c.detail}` },
      el('div.my-cell-top', {}, el('b', { text: v >= 100 ? '✓' : `${v}%` })),
      meter(c.value),
      el('small', { text: c.detail })
    )
  );
}

/**
 * @param h  app.js 의 도움 함수들 { docsOf, readingDocs, conceptsOf, loadStudy, renderNavLearner, setNav, show, subjectIcon }
 */
export async function renderMine(ctx, exam, data, h) {
  document.title = `나의 진도 — ${exam.title}`;
  const study = await h.loadStudy(ctx, exam.subjects, data.concepts);
  h.renderNavLearner(study.learners.map((l) => l.name));
  h.setNav(null);
  const rows = await Promise.all(exam.subjects.map((s) => subjectRow(ctx, h, study, s)));
  const overall = pct(mean(rows.map((r) => r.total)));
  const left = dday(study.examDate, study.today);
  const slowest = [...rows].sort((a, b) => a.total - b.total).find((r) => r.next);
  const weak = rows.flatMap((r) => r.weak.map((w) => ({ ...w, subject: r.s.subject }))).sort((a, b) => a.best - b.best);
  const dueRows = rows.filter((r) => r.due > 0);

  h.show(
    el('section.hero.my-hero', {},
      el('p.eyebrow.dday', { text: left ? `시험까지 ${left.label}` : '시험일을 홈에서 정하면 남은 날이 보입니다' }),
      el('h1', { text: `${study.learner}의 진도` }),
      el('div.my-big', {}, el('b', { text: String(overall) }), el('span', { text: '%' })),
      el('div.my-big-bar', {}, meter(overall / 100)),
      el('p.sub', { text: `전 과목 평균 · ① 공부하기 ${WEIGHTS.s1 * 100}% + ② 실전 연습 ${WEIGHTS.s2 * 100}% + ③ 마무리 ${WEIGHTS.s3 * 100}%` }),
      !study.ok ? el('p.save-warn', { text: '서버에서 기록을 읽지 못했습니다. 이 브라우저에 보관된 것만 보입니다.' }) : null
    ),
    el('div.wrap', {},
      slowest
        ? el('a.next-step', { href: slowest.next.href },
            el('span.next-label', { text: '지금 할 일' }),
            el('b', { text: `${slowest.s.subject} · ${slowest.next.step} ${slowest.next.text}` }),
            el('span.more', { text: '바로 가기 →' })
          )
        : null,

      el('section.section', {},
        el('div.section-head', {},
          el('h2', { text: '과목 × 3단계' }),
          el('p', { text: '칸을 누르면 그 과목으로 갑니다. 회색=시작 전 · 노랑=하는 중 · 초록=끝. 진도가 낮은 과목이 위에 옵니다.' })
        ),
        el('div.my-table-wrap', {},
          el('table.my-table', {},
            el('thead', {}, el('tr', {},
              el('th', { text: '과목' }), el('th', { text: '① 공부하기' }), el('th', { text: '② 실전 연습' }), el('th', { text: '③ 마무리' }), el('th', { text: '점수' })
            )),
            el('tbody', {}, [...rows].sort((a, b) => a.total - b.total).map((r) =>
              el('tr', {},
                el('th.my-subj', { scope: 'row' },
                  el('a', { href: `#/s/${r.s.code}` }, h.subjectIcon(r.s, 'my-subj-icon'), el('span', {}, el('b', { text: r.s.subject }), el('small', { text: `진도 ${pct(r.total)}%` })))
                ),
                r.cells.map(cell),
                el('td.my-score', {}, r.score ? [el('b', { text: `${r.score.value}점` }), el('small', { text: r.score.label })] : el('span.my-na', { text: '아직' }))
              )
            ))
          )
        )
      ),

      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '다시 볼 곳' }), el('p', { text: `${WEAK}점 아래로 나온 평가와 오늘 복습할 오답입니다.` })),
        el('div.grid.my-weak-grid', {},
          el('div.card', {},
            el('div.role', { text: `${WEAK}점 아래` }),
            weak.length
              ? el('ul.my-list', {}, weak.map((w) => el('li', {}, el('a', { href: w.href }, el('span', { text: `${w.subject} · ${w.text}` }), el('b.my-low', { text: `${w.best}점` })))))
              : el('p.db-muted', { text: '없습니다 ✓' })
          ),
          el('div.card', {},
            el('div.role', { text: '오늘 복습할 오답' }),
            dueRows.length
              ? el('ul.my-list', {}, dueRows.map((r) => el('li', {}, el('a', { href: `#/s/${r.s.code}/review` }, el('span', { text: r.s.subject }), el('b', { text: `${r.due}문제` })))))
              : el('p.db-muted', { text: '없습니다 ✓' })
          )
        )
      ),

      el('p.my-foot', {}, '다른 사람과 비교하려면 ', el('a', { href: '#/dashboard', text: '⚔️ 함께 비교하기(학습 현황)' }), ' · ', el('a', { href: '#/versus', text: '대결' }))
    )
  );
}
