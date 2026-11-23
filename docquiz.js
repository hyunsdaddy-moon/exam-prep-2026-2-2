/*
 * 시험 준비 웹앱 — 읽기 문서 끝의 「단원 평가」
 *
 * 문항: data/docquiz/<과목 코드>.json  { docs: { "<문서 경로>": { title, questions: [...] } } }
 *   객관식 { id, type:'choice', section, level, stem, choices, answer(1부터), explanation }
 *   서술형 { id, type:'essay',  section, stem, model, keywords }  — 모범 답안을 보고 스스로 ○/× 를 매긴다
 * 수준 평가처럼 흰 시험지 2단으로 그린다. 번호를 누르면 바로 채점하고 해설을 보여 준다.
 * 고른 답은 이 브라우저에 참여자별로 남는다(서버 기록 없음).
 */

import { el, CIRCLED } from './dom.js?v=20261124-0457';
import { renderMarkdown } from './markdown.js?v=20261124-0457';
import { getCurrentLearner } from './store.js?v=20261124-0457';

const files = new Map();
function loadQuiz(ctx, code) {
  if (!files.has(code)) files.set(code, ctx.getJson(`data/docquiz/${code}.json`).catch(() => ({ docs: {} })));
  return files.get(code);
}

const md = (text, tag = 'div.md.p-text') => {
  const box = el(tag);
  renderMarkdown(text, box, { breaks: true });
  return box;
};

/**
 * 문서에 단원 평가가 있으면 { section, heading } 을 돌려준다. 없으면 null
 * opts: { subject: '과학', docTitle: '5.2 힘과 우리 생활' }
 */
export async function buildDocQuiz(ctx, code, file, opts = {}) {
  const data = await loadQuiz(ctx, code);
  const quiz = data.docs?.[file] || data.docs?.[file.normalize('NFC')];
  if (!quiz?.questions?.length) return null;
  const qs = quiz.questions;
  const learner = getCurrentLearner();
  const key = `examprep.docquiz.${learner}.${code}.${file}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { saved = {}; }
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* 저장 못 해도 푸는 데는 지장 없다 */ } };

  const choiceCount = qs.filter((q) => q.type === 'choice').length;
  const essayCount = qs.length - choiceCount;
  const isRight = (q) => (q.type === 'choice' ? saved[q.id] === q.answer : saved[q.id] === 'o');
  const isDone = (q) => (q.type === 'choice' ? saved[q.id] != null : saved[q.id] === 'o' || saved[q.id] === 'x');

  // 머리글 (수준 평가 시험지와 같은 모양)
  const scoreField = el('i');
  const progress = el('p.sheet-note.dq-progress');
  const refresh = () => {
    const done = qs.filter(isDone);
    const right = done.filter(isRight).length;
    scoreField.textContent = done.length ? `${right} / ${qs.length}` : '';
    progress.textContent = done.length
      ? `${done.length} / ${qs.length}문제 풂 · 맞힘 ${right} · 틀림 ${done.length - right}${done.length === qs.length ? ` · 정답률 ${Math.round((right / qs.length) * 100)}%` : ''}`
      : '';
  };
  const field = (label, value) => el('div', {}, el('span', { text: label }), typeof value === 'string' ? el('i', { text: value }) : value);
  const reset = el('button.dq-reset', { type: 'button', text: '처음부터 다시 풀기' });
  const head = el('header.sheet-head', {},
    el('div.sheet-title', {},
      el('small', { text: `2026 2학기 2회고사 · 단원 평가${opts.docTitle ? ` · ${opts.docTitle}` : ''}` }),
      el('h1', {}, opts.subject || '', el('span', { text: ` ${quiz.title || '단원 평가'}` }))
    ),
    el('p.sheet-note', { text: `선택형 ${choiceCount}문항${essayCount ? ` · 서술형 ${essayCount}문항` : ''} · 답 번호를 누르면 바로 채점되고 해설이 나옵니다.` }),
    el('div.sheet-fields', {},
      field('과목', opts.subject || ''),
      field('이름', learner),
      field('날짜', new Date().toLocaleDateString('ko-KR')),
      field('점수', scoreField)
    ),
    el('div.dq-tools', {}, progress, reset)
  );

  const cols = el('div.cols');
  const essays = el('div.dq-essays');
  let lastSection = null;
  let no = 0;
  let essayNo = 0;

  for (const q of qs) {
    const target = q.type === 'choice' ? cols : essays;
    if (q.type === 'choice' && q.section && q.section !== lastSection) {
      lastSection = q.section;
      cols.append(el('h3.p-group', { text: q.section }));
    }
    const label = q.type === 'choice' ? `${++no}.` : `서술형 ${++essayNo}.`;
    const grade = el('span.dq-grade', { 'aria-live': 'polite' });
    const block = el(`article.p-q${q.type === 'essay' ? '.essay' : ''}`,
      {},
      el('div.p-stem', {}, el('b.p-no', {}, grade, label), md(q.stem), q.level && q.level !== '서술형' ? el('span.p-points', { text: `[${q.level}]` }) : null)
    );
    const feedback = el('div.dq-exp');

    if (q.type === 'choice') {
      const items = q.choices.map((c, i) => el('li', {},
        el('button.p-pick', { type: 'button', 'aria-label': `${i + 1}번 고르기`, onclick: () => {
          if (saved[q.id] != null) return; // 한 번 고르면 채점 끝
          saved[q.id] = i + 1;
          persist();
          paint();
          refresh();
        } }, el('span.p-mark', { text: CIRCLED[i] }), md(c))
      ));
      const paint = () => {
        const pick = saved[q.id];
        const graded = pick != null;
        items.forEach((li, i) => {
          const n = i + 1;
          li.classList.toggle('on', n === pick);
          li.classList.toggle('answer', graded && n === q.answer);
          li.classList.toggle('miss', graded && n === pick && pick !== q.answer);
          li.firstChild.disabled = graded;
          li.querySelector('.p-mark').textContent = n === pick ? String(n) : CIRCLED[i];
        });
        block.classList.toggle('is-right', graded && pick === q.answer);
        block.classList.toggle('is-wrong', graded && pick !== q.answer);
        grade.textContent = graded ? (pick === q.answer ? '○' : '／') : '';
        feedback.replaceChildren();
        if (graded) {
          feedback.append(
            el('b.dq-verdict', { text: pick === q.answer ? '정답' : `오답 · 정답 ${CIRCLED[q.answer - 1]}` }),
            md(q.explanation)
          );
        }
      };
      block.append(el('ol.p-choices.p-choose', {}, items), feedback);
      paint();
    } else {
      const input = el('textarea.p-write', { rows: 4, placeholder: '여기에 답을 써 보세요. (저장되지 않습니다)' });
      const show = el('button.dq-btn', { type: 'button', text: '모범 답안 보기' });
      const paint = () => {
        const v = saved[q.id];
        block.classList.toggle('is-right', v === 'o');
        block.classList.toggle('is-wrong', v === 'x');
        grade.textContent = v === 'o' ? '○' : v === 'x' ? '／' : '';
        feedback.replaceChildren();
        if (v === undefined) return;
        show.style.display = 'none';
        const mark = (val, text) => el(`button.dq-btn${v === val ? '.on' : ''}`, { type: 'button', text, onclick: () => { saved[q.id] = val; persist(); paint(); refresh(); } });
        feedback.append(
          el('b.dq-verdict', { text: '모범 답안' }),
          md(q.model),
          q.keywords?.length ? el('p.dq-keys', { text: `꼭 들어갈 말: ${q.keywords.join(' · ')}` }) : null,
          el('div.dq-marks', {}, mark('o', '○ 맞게 썼어요'), mark('x', '／ 빠뜨렸어요'))
        );
      };
      show.addEventListener('click', () => { if (saved[q.id] === undefined) saved[q.id] = null; paint(); });
      block.append(input, el('div.dq-marks', {}, show), feedback);
      if (saved[q.id] != null) paint();
    }
    target.append(block);
  }

  const sheet = el('div.sheet.exam-paper.dq-paper', {}, head, cols, essayCount ? el('h3.p-group.dq-essay-title', { text: '서술형' }) : null, essays);
  const heading = el('h2', { id: 'doc-quiz', text: `📝 ${quiz.title || '단원 평가'}` });
  const section = el('section.dq', {}, heading, sheet);

  let armed = false;
  reset.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      reset.textContent = '한 번 더 누르면 지워집니다';
      setTimeout(() => { armed = false; reset.textContent = '처음부터 다시 풀기'; }, 3000);
      return;
    }
    saved = {};
    persist();
    void buildDocQuiz(ctx, code, file, opts).then((r) => {
      if (!r) return;
      section.replaceWith(r.section);
      r.section.querySelector('h2')?.scrollIntoView();
    });
  });

  refresh();
  return { section, heading };
}
