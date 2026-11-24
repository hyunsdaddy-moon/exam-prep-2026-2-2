/*
 * 시험 준비 웹앱 — 전 과목 오답 노트
 *   #/notes            모든 과목의 틀린 문제 (예상 문제 + 수준 평가)
 *   #/notes?s=<과목>   과목만 · &f=due|waiting|graduated|assess 로 거르기
 * 문제마다 「질문하기」를 누르면 질문 게시판에 그 문제를 붙여 글을 쓴다.
 */

import { el, plainStem } from './dom.js?v=20261125-0008';
import { md, contextBlock, passageBlock, choiceList, answerText } from './solve.js?v=20261125-0008';
import { ERROR_LABEL, CONFIDENCE_LABEL } from './grade.mjs?v=20261125-0008';
import { STATUS_LABEL } from './notes.js?v=20261125-0008';
import { unitWrongs } from './units.js?v=20261125-0008';
import { assessWrongs } from './assess.js?v=20261125-0008';
import { docWrongs, choiceNotes } from './docquiz.js?v=20261125-0008';

const FILTERS = [
  ['all', '전체'],
  ['due', '오늘 복습'],
  ['waiting', '다른 날 한 번 더'],
  ['graduated', '졸업'],
  ['assess', '평가'],
];

/** 질문 게시판으로 가는 주소 — 문제를 붙여 간다 */
export function askHref(subjectCode, q, label) {
  const p = new URLSearchParams({ s: subjectCode, q: q.id, t: `${label} · ${plainStem(q.stem, 100)}` });
  return `#/board?${p}`;
}

function problemBody(q, group, picked, extra) {
  const body = el('div.result-body');
  body.append(contextBlock(group, false) || '', passageBlock(q) || '', md(q.stem, 'md q-stem'));
  if (q.type === 'choice') {
    const choices = choiceList(q, () => {});
    choices.set(picked || [], q.answer);
    body.append(choices.node, el('p.verdict-line', { text: extra }), q.explanation ? md(q.explanation, 'md explain') : '', q.choiceNotes ? choiceNotes({ ...q, answer: q.answer[0] }, picked?.[0]) : '');
  } else {
    body.append(el('h4', { text: '모범 답안과 채점 기준' }), md(q.modelAnswer, 'md explain'));
  }
  return body;
}

export async function renderWrongbook(ctx, exam, study, query) {
  document.title = `오답 노트 — ${exam.title}`;
  ctx.setNav('notes');
  const subjects = exam.subjects;
  const sel = subjects.some((s) => s.code === query.get('s')) ? query.get('s') : 'all';
  const filter = FILTERS.some(([k]) => k === query.get('f')) ? query.get('f') : 'all';
  const go = (params) => {
    const q = new URLSearchParams({ s: sel, f: filter, ...params });
    location.hash = `#/notes?${q}`;
  };

  const assess = [...(await assessWrongs(ctx, subjects, study.merged.attempts)), ...(await unitWrongs(ctx, subjects, study.merged.attempts)), ...(await docWrongs(ctx, subjects, study.merged.attempts))];
  const notesOf = (code) => study.bySubject.get(code)?.notes || [];
  const all = subjects.flatMap((s) => notesOf(s.code));
  const count = {
    all: all.length + assess.length,
    due: all.filter((n) => n.status === 'due').length,
    waiting: all.filter((n) => n.status === 'waiting').length,
    graduated: all.filter((n) => n.status === 'graduated').length,
    assess: assess.length,
  };

  const shown = subjects.filter((s) => sel === 'all' || s.code === sel);
  const blocks = shown.map((s) => {
    const info = study.bySubject.get(s.code);
    const rows = [];
    if (filter !== 'assess') {
      for (const n of notesOf(s.code)) {
        if (filter !== 'all' && n.status !== filter) continue;
        const q = n.question;
        const label = `${s.subject} 예상문제 ${q.type === 'essay' ? `서술형 ${q.no}` : `${q.no}번`}`;
        const last = n.history.at(-1);
        rows.push(el(`details.result-row.note-${n.status}`, {},
          el('summary', {},
            el(`span.badge.${n.status}`, { text: STATUS_LABEL[n.status] }),
            el('span.result-no', { text: q.type === 'essay' ? `서술형 ${q.no}` : `${q.no}번` }),
            el('span.result-stem', { text: plainStem(q.stem, 54) }),
            el('span.marks', { 'aria-label': `풀이 ${n.history.length}번` }, n.history.slice(-6).map((h) => el(`i.${h.correct ? 'o' : 'x'}`, { text: h.correct ? '○' : '×' })))
          ),
          problemBody(q, info.groups.get(q.group), last?.picked, `정답 ${answerText(q.answer)}${n.errorType ? ` · 틀린 까닭: ${ERROR_LABEL[n.errorType]}` : ''}`),
          el('div.note-actions', {}, el('a.pill.ghost.small', { href: askHref(s.code, q, label), text: '이 문제 질문하기' }))
        ));
      }
    }
    if (filter === 'all' || filter === 'assess') {
      for (const w of assess.filter((x) => x.subject.code === s.code)) {
        const q = w.question;
        const label = `${s.subject} ${w.round.title} ${q.no}번`;
        rows.push(el('details.result-row.note-assess', {},
          el('summary', {},
            el('span.badge.assess', { text: w.round.title }),
            el('span.result-no', { text: q.type === 'essay' ? `서술형 ${q.no}` : `${q.no}번` }),
            el('span.result-stem', { text: plainStem(q.stem, 54) }),
            el('span.marks', {}, el('i.x', { text: '×' }))
          ),
          problemBody(q, w.group, w.attempt.picked, q.type === 'essay' ? '스스로 채점: 빠뜨렸어요' : `내 답 ${w.attempt.picked?.length ? answerText(w.attempt.picked) : '안 풂'} · 정답 ${answerText(q.answer)}${w.attempt.confidence ? ` · ${CONFIDENCE_LABEL[w.attempt.confidence]}` : ''}`),
          el('div.note-actions', {},
            w.href ? el('a.pill.ghost.small', { href: w.href, text: '단원 정리로 가서 다시 풀기' }) : null,
            el('a.pill.ghost.small', { href: askHref(s.code, q, label), text: '이 문제 질문하기' }))
        ));
      }
    }
    if (!rows.length) return null;
    const due = notesOf(s.code).filter((n) => n.status === 'due').length;
    return el('section.section', {},
      el('div.section-head.row', {},
        el('h2', { text: `${s.subject} · ${rows.length}문제` }),
        el('div.hero-actions.left', {},
          due ? el('a.pill.small', { href: `#/s/${s.code}/review`, text: `복습 시작 · ${due}문제` }) : null,
          el('a.pill.ghost.small', { href: `#/s/${s.code}/notes`, text: '과목 오답 통계' })
        )
      ),
      el('div.result-list', {}, rows)
    );
  }).filter(Boolean);

  ctx.show(
    el('section.hero', {},
      el('p.eyebrow', { text: `${study.learner} · 오답 노트` }),
      el('h1', { text: count.all ? `틀린 문제 ${count.all}개` : '틀린 문제가 없습니다' }),
      el('p.sub', { text: count.all ? `오늘 복습 ${count.due} · 다른 날 한 번 더 ${count.waiting} · 졸업 ${count.graduated} · 평가 ${count.assess}` : '연습·실전·단원 평가·수준 평가에서 틀린 문제가 과목별로 여기에 모입니다.' }),
      el('div.hero-actions', {}, el('a.pill.ghost', { href: '#/board', text: '질문 게시판' }))
    ),
    el('div.wrap', {},
      el('div.filter-bar', {},
        el('div.chips', {},
          el(`button.chip.pick`, { type: 'button', 'aria-pressed': String(sel === 'all'), text: '모든 과목', onclick: () => go({ s: 'all' }) }),
          subjects.map((s) => el('button.chip.pick', { type: 'button', 'aria-pressed': String(sel === s.code), text: `${s.subject} ${notesOf(s.code).length + assess.filter((w) => w.subject.code === s.code).length}`, onclick: () => go({ s: s.code }) }))
        ),
        el('div.segment', { role: 'group', 'aria-label': '상태로 거르기' },
          FILTERS.map(([k, label]) => el('button', { type: 'button', text: `${label} ${count[k]}`, 'aria-pressed': String(filter === k), onclick: () => go({ f: k }) }))
        )
      ),
      blocks.length
        ? blocks
        : el('section.section', {}, el('p.note', { text: count.all ? '이 조건에 맞는 문제가 없습니다.' : '아직 틀린 문제가 없습니다. 과목에서 연습·실전 문제를 풀거나 수준 평가를 보면 틀린 문제가 모입니다.' })),
      el('p.note', { text: '열면 정답과 해설이 보입니다. 복습할 때는 먼저 풀어 보고 여세요.' })
    )
  );
}
