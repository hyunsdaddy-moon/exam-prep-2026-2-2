/*
 * 시험 준비 웹앱 — 성적 (#/grades , #/grades?e=<시험 id>)
 *
 * 지난 정기고사 성적표와 시험지 분석을 한 화면에 모은다. 자료는 data/grades.json 하나다.
 *   시험을 새로 치르면 exams 배열 끝에 하나 더 적는다 → 추이 표와 시험 고르기가 저절로 생긴다.
 *   성적은 owner(문현)의 것이라 가족(비밀번호가 걸린 참여자)에게만 보여 준다.
 */

import { el } from './dom.js?v=20261125-1828';
import { getCurrentLearner } from './store.js?v=20261125-1828';
import { isProtected } from './lock.js?v=20261125-1828';

const fmt = (n) => (n == null ? '–' : Number(n).toFixed(1));
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}`;
const diffOf = (s) => Math.round((s.score - s.average) * 10) / 10;

/** 점수 막대 — 채워진 부분이 받은 점수, 세로 금이 과목 평균, 세모가 다음 목표 */
function scoreBar(s) {
  return el('div.gr-bar', { role: 'img', 'aria-label': `받은 점수 ${fmt(s.score)}, 과목 평균 ${fmt(s.average)}` },
    el(`i.gr-fill${s.score >= s.average ? '.up' : '.down'}`, { style: `width:${s.score}%` }),
    el('span.gr-avg', { style: `left:${s.average}%`, title: `과목 평균 ${fmt(s.average)}` }),
    s.target ? el('span.gr-target', { style: `left:${s.target}%`, title: `다음 목표 ${s.target}` }) : null
  );
}

function subjectCard(s, hasPage) {
  const d = diffOf(s);
  return el('div.gr-card', {},
    el('div.gr-card-head', {},
      el('h3', {}, hasPage ? el('a', { href: `#/s/${s.code}`, text: s.subject }) : s.subject),
      el(`span.gr-diff${d >= 0 ? '.up' : '.down'}`, { text: `평균 ${signed(d)}` })
    ),
    el('div.gr-num', {}, fmt(s.score), el('small', { text: '점' })),
    scoreBar(s),
    el('p.gr-legend', { text: `과목 평균 ${fmt(s.average)}${s.target ? ` · 다음 목표 ${s.target}점 이상` : ''}` }),
    el('p.gr-comment', { text: s.comment || '' })
  );
}

const list = (items) => el('ul.gr-list', {}, items.map((t) => el('li', { text: t })));

function subjectDetail(s, types) {
  const wrong = s.wrong || [];
  return el('section.gr-detail', { id: `gr-${s.code}` },
    el('div.gr-detail-head', {},
      el('h3', { text: s.subject }),
      el('span.gr-detail-score', { text: `${fmt(s.score)}점 · 틀린 문제 ${wrong.length ? `${wrong.length}개 확인` : '확인 안 됨'}` })
    ),
    s.note ? el('p.gr-note', { text: s.note }) : null,
    wrong.length
      ? el('div.table-scroll', {},
          el('table.rank-table.gr-table', {},
            el('thead', {}, el('tr', {}, ['번호', '문제', '고른 답', '정답', '왜 틀렸나', '실수 유형'].map((h) => el('th', { text: h })))),
            el('tbody', {}, wrong.map((w) => el('tr', {},
              el('td', { text: w.no }),
              el('td', { text: w.topic }),
              el('td.gr-picked', { text: w.picked || '–' }),
              el('td.gr-answer', { text: w.answer }),
              el('td.gr-why', { text: w.why }),
              el('td', {}, types[w.type] ? el(`span.gr-tag.${w.type}`, { text: types[w.type].label }) : '')
            )))
          )
        )
      : null,
    el('div.gr-cols', {},
      (s.good || []).length ? el('div', {}, el('h4', { text: '잘한 점' }), list(s.good)) : null,
      (s.todo || []).length ? el('div', {}, el('h4', { text: '이렇게 공부하자' }), list(s.todo)) : null
    )
  );
}

/** 실수 유형별로 틀린 문제를 모은다 */
function mistakeSection(exam, types) {
  const all = exam.subjects.flatMap((s) => (s.wrong || []).map((w) => ({ ...w, subject: s.subject })));
  if (!all.length) return null;
  const rows = Object.entries(types)
    .map(([key, t]) => ({ key, ...t, items: all.filter((w) => w.type === key) }))
    .filter((r) => r.items.length)
    .sort((a, b) => b.items.length - a.items.length);
  const max = Math.max(...rows.map((r) => r.items.length));
  return el('section.section', {},
    el('div.section-head', {}, el('h2', { text: '왜 틀렸을까' }), el('p', { text: exam.summary || '' })),
    el('div.gr-types', {}, rows.map((r) => el('div.gr-type', {},
      el('div.gr-type-head', {}, el(`span.gr-tag.${r.key}`, { text: r.label }), el('b', { text: `${r.items.length}문제` })),
      el('div.db-bar', {}, el('i', { style: `width:${Math.round((r.items.length / max) * 100)}%` })),
      el('p.gr-type-items', { text: r.items.map((w) => `${w.subject} ${w.no}${/^\d+$/.test(w.no) ? '번' : ''}`).join(' · ') }),
      el('p.gr-type-tip', { text: `→ ${r.tip}` })
    )))
  );
}

/** 시험이 둘 이상 쌓이면 과목별 점수 추이를 표로 보여 준다 */
function trendSection(exams) {
  if (exams.length < 2) return null;
  const names = [];
  for (const e of exams) for (const s of e.subjects) if (!names.includes(s.subject)) names.push(s.subject);
  return el('section.section', {},
    el('div.section-head', {}, el('h2', { text: '시험별 추이' }), el('p', { text: '괄호 안은 과목 평균과의 차이입니다.' })),
    el('div.table-scroll', {},
      el('table.rank-table', {},
        el('thead', {}, el('tr', {}, el('th', { text: '과목' }), exams.map((e) => el('th', { text: e.title })))),
        el('tbody', {}, names.map((name) => el('tr', {},
          el('td', { text: name }),
          exams.map((e) => {
            const s = e.subjects.find((x) => x.subject === name);
            return el('td', { text: s ? `${fmt(s.score)} (${signed(diffOf(s))})` : '–' });
          })
        )))
      )
    )
  );
}

export async function renderGrades(ctx, exam, query) {
  ctx.setNav(null);
  const learner = getCurrentLearner();
  if (!isProtected(learner)) {
    document.title = '성적';
    return ctx.show(el('div.empty', {},
      el('h1', { text: '가족만 볼 수 있습니다' }),
      el('p', { text: '성적은 가족 참여자로 들어왔을 때만 보입니다.' }),
      el('p', {}, el('a.pill', { href: '#/', text: '처음으로' }))
    ));
  }
  const data = await ctx.getJson('data/grades.json').catch(() => null);
  const exams = data?.exams || [];
  if (!exams.length) return ctx.renderMissing('아직 정리된 성적이 없습니다.');
  const types = data.mistakeTypes || {};
  const cur = exams.find((e) => e.id === query.get('e')) || exams.at(-1);
  const codes = new Set(exam.subjects.map((s) => s.code));
  const above = cur.subjects.filter((s) => s.score >= s.average).length;
  document.title = `성적 — ${cur.title}`;

  ctx.show(
    el('section.hero', {},
      el('p.eyebrow', { text: `${data.owner} · 성적` }),
      el('h1', { text: cur.title }),
      el('p.sub', { text: `${cur.grade} · 시험 ${cur.date} · ${cur.subjects.length}과목 중 ${above}과목 평균 이상` }),
      exams.length > 1
        ? el('div.hero-actions', {}, exams.map((e) => el(`a.pill.small${e.id === cur.id ? '' : '.ghost'}`, { href: `#/grades?e=${e.id}`, text: e.title })))
        : null
    ),
    el('div.wrap', {},
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '과목별 점수' }), el('p', { text: `막대 = 받은 점수, 세로 금 = 과목 평균, 세모 = 다음 목표${cur.attendance ? ` · ${cur.attendance}` : ''}` })),
        el('div.gr-cards', {}, cur.subjects.map((s) => subjectCard(s, codes.has(s.code))))
      ),
      trendSection(exams),
      mistakeSection(cur, types),
      (data.habits || []).length
        ? el('section.section', {},
            el('div.section-head', {}, el('h2', { text: '시험 볼 때 다섯 가지' }), el('p', { text: '이번 시험지에서 찾은 실수를 줄이는 습관입니다. 문제를 풀기 전에 한 번 읽어 보세요.' })),
            el('ol.gr-habits', {}, data.habits.map((h) => el('li', { text: h })))
          )
        : null,
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '과목별 자세히' }), el('p', { text: '틀린 문제와 이유, 잘한 점, 앞으로 할 일입니다.' })),
        el('div.gr-details', {}, cur.subjects.map((s) => subjectDetail(s, types)))
      )
    )
  );
}
