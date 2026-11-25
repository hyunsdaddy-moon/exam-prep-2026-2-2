/*
 * 시험 준비 웹앱 — 오답 노트 · 통계 화면과 진도 고리 (docs/시험준비탭개발계획서.md §6·§7, 3단계)
 *   #/s/<과목>/notes   틀린 문제 모음, 복습 차례, 틀린 까닭 분포
 */

import { el, plainStem } from './dom.js?v=20261125-2110';
import { md, contextBlock, passageBlock, choiceList, answerText, renderHistory } from './solve.js?v=20261125-2110';
import { ERROR_LABEL } from './grade.mjs?v=20261125-2110';
import { errorBreakdown, CONCEPT_LABEL } from './progress.mjs?v=20261125-2110';

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * 진도 고리. 바깥 고리 = 진도율, 안쪽 고리 = 숙련도(없으면 빈 고리).
 * 가운데 숫자는 진도율이다.
 */
export function ring(progress, mastery, size = 120) {
  const box = el('div.ring', { role: 'img', 'aria-label': `진도율 ${progress}%${mastery == null ? '' : `, 숙련도 ${mastery}%`}`, style: `width:${size}px;height:${size}px` });
  const root = svg('svg', { viewBox: '0 0 120 120', width: size, height: size });
  const arc = (r, value, cls) => {
    const len = 2 * Math.PI * r;
    root.append(svg('circle', { cx: 60, cy: 60, r, class: 'ring-track' }));
    const c = svg('circle', { cx: 60, cy: 60, r, class: `ring-value ${cls}`, 'stroke-dasharray': `${(len * Math.min(Math.max(value, 0), 100)) / 100} ${len}`, transform: 'rotate(-90 60 60)' });
    if (value > 0) root.append(c);
  };
  arc(52, progress, 'outer');
  arc(39, mastery ?? 0, 'inner');
  box.append(root, el('div.ring-num', {}, String(progress), el('small', { text: '%' })));
  return box;
}

export const STATUS_LABEL = { due: '오늘 복습', waiting: '다른 날 한 번 더', graduated: '졸업' };

/** 개념 상태의 범례 */
export function conceptLegend() {
  return el('div.legend', {}, Object.entries(CONCEPT_LABEL).map(([key, label]) => el('span', {}, el(`i.state-dot.${key}`), label)));
}

export function renderNotes(ctx, subject, study) {
  const info = study.bySubject.get(subject.code);
  document.title = `${subject.subject} 오답 노트 — 시험 준비`;
  ctx.setNav(subject.code);
  const mine = study.merged.attempts.filter((a) => a.subject === subject.code);
  const errors = errorBreakdown(mine);
  const due = info.due.length;

  const row = (n) => {
    const q = n.question;
    const body = el('div.result-body');
    body.append(contextBlock(info.groups.get(q.group), false) || '', passageBlock(q) || '', md(q.stem, 'md q-stem'));
    if (q.type === 'choice') {
      const choices = choiceList(q, () => {});
      choices.set([], q.answer);
      body.append(choices.node, el('p.verdict-line', { text: `정답 ${answerText(q.answer)}${n.errorType ? ` · 틀린 까닭: ${ERROR_LABEL[n.errorType]}` : ''}` }), q.explanation ? md(q.explanation, 'md explain') : '');
    } else {
      body.append(el('h4', { text: '모범 답안과 채점 기준' }), md(q.modelAnswer, 'md explain'));
    }
    return el(`details.result-row.note-${n.status}`, {},
      el('summary', {},
        el(`span.badge.${n.status}`, { text: STATUS_LABEL[n.status] }),
        el('span.result-no', { text: q.type === 'essay' ? `서술형 ${q.no}` : `${q.no}번` }),
        el('span.result-stem', { text: plainStem(q.stem, 54) }),
        el('span.marks', { 'aria-label': `풀이 ${n.history.length}번` }, n.history.slice(-6).map((h) => el(`i.${h.correct ? 'o' : 'x'}`, { text: h.correct ? '○' : '×' })))
      ),
      body
    );
  };

  const bar = (label, count) =>
    el('div.bar-row', {}, el('span.bar-label', { text: label }), el('div.bar', {}, el('i', { style: `width:${errors.total ? (count / errors.total) * 100 : 0}%` })), el('span.bar-num', { text: String(count) }));

  const past = el('section.section', {}, el('div.section-head', {}, el('h2', { text: '점수 흐름' })));
  ctx.show(
    el('section.hero', {},
      el('a.back', { href: `#/s/${subject.code}`, text: subject.subject }),
      el('p.eyebrow', { text: `${study.learner} · 오답 노트` }),
      el('h1', { text: info.notes.length ? `틀린 문제 ${info.notes.length}개` : '틀린 문제가 없습니다' }),
      el('p.sub', { text: info.notes.length ? `오늘 복습 ${due} · 다른 날 한 번 더 ${info.waiting} · 졸업 ${info.graduated}` : '문제를 풀다 틀리면 여기에 모입니다.' }),
      el('div.hero-actions', {},
        due ? el('a.pill', { href: `#/s/${subject.code}/review`, text: `복습 시작 · ${due}문제` }) : null,
        el('a.pill.ghost', { href: `#/s/${subject.code}/practice`, text: '연습으로 풀기' })
      )
    ),
    el('div.wrap', {},
      info.notes.length
        ? el('section.section', { style: 'padding-top:0' },
            el('div.section-head', {}, el('h2', { text: '복습할 문제' }), el('p', { text: '틀린 뒤로 서로 다른 날에 두 번 연속 맞히면 졸업합니다. 열면 정답이 보이니, 복습을 먼저 하고 여세요.' })),
            el('div.result-list', {}, info.notes.map(row))
          )
        : null,
      errors.total
        ? el('section.section', {},
            el('div.section-head', {}, el('h2', { text: '왜 틀렸나' }), el('p', { text: `틀린 풀이 ${errors.total}번 가운데 확신했는데 틀린 것이 ${errors.sureWrong}번입니다.` })),
            el('div.bars', {}, Object.entries(ERROR_LABEL).map(([key, label]) => bar(label, errors[key])), bar('고르지 않음', errors.none))
          )
        : null,
      past
    )
  );
  void renderHistory(ctx, subject, past);
}
