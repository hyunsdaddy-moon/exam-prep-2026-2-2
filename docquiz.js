/*
 * 시험 준비 웹앱 — 읽기 문서 끝의 「단원 평가」
 *
 * 문항: data/docquiz/<과목 코드>.json  { docs: { "<문서 경로>": { title, questions: [...] } } }
 *   객관식 { id, type:'choice', section, level, stem, choices, answer(1부터), explanation }
 *   서술형 { id, type:'essay',  section, stem, model, keywords }  — 모범 답안을 보고 스스로 ○/× 를 매긴다
 * 답은 바로 채점하고 해설을 보여 준다. 고른 답은 이 브라우저에 참여자별로 남는다(서버 기록 없음).
 */

import { el, CIRCLED } from './dom.js?v=20261124-0401';
import { renderMarkdown } from './markdown.js?v=20261124-0401';
import { getCurrentLearner } from './store.js?v=20261124-0401';

const files = new Map();
function loadQuiz(ctx, code) {
  if (!files.has(code)) files.set(code, ctx.getJson(`data/docquiz/${code}.json`).catch(() => ({ docs: {} })));
  return files.get(code);
}

const md = (text, tag = 'div.dq-md') => {
  const box = el(tag);
  renderMarkdown(text, box);
  return box;
};

/** 문서에 단원 평가가 있으면 { section, heading } 을 돌려준다. 없으면 null */
export async function buildDocQuiz(ctx, code, file) {
  const data = await loadQuiz(ctx, code);
  const quiz = data.docs?.[file] || data.docs?.[file.normalize('NFC')];
  if (!quiz?.questions?.length) return null;
  const qs = quiz.questions;
  const key = `examprep.docquiz.${getCurrentLearner()}.${code}.${file}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { saved = {}; }
  const persist = () => { try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* 저장 못 해도 푸는 데는 지장 없다 */ } };

  const choiceCount = qs.filter((q) => q.type === 'choice').length;
  const essayCount = qs.length - choiceCount;
  const score = el('p.dq-score');
  const refresh = () => {
    const done = qs.filter((q) => saved[q.id] != null);
    const right = done.filter((q) => (q.type === 'choice' ? saved[q.id] === q.answer : saved[q.id] === 'o')).length;
    score.textContent = done.length
      ? `${done.length} / ${qs.length}문제 풀었음 · 맞힘 ${right} · 틀림 ${done.length - right}${done.length === qs.length ? ` · 정답률 ${Math.round((right / qs.length) * 100)}%` : ''}`
      : `객관식 ${choiceCount}문제${essayCount ? ` · 서술형 ${essayCount}문제` : ''} · 답을 누르면 바로 채점됩니다.`;
  };

  const cards = [];
  let lastSection = null;
  const list = el('div.dq-list');
  qs.forEach((q, i) => {
    if (q.section && q.section !== lastSection) {
      lastSection = q.section;
      list.append(el('h3.dq-section', { text: q.section }));
    }
    const card = el('div.dq-card');
    const head = el('div.dq-head', {}, el('b', { text: `${i + 1}.` }), q.level ? el('span.dq-level', { text: q.level }) : null);
    const stem = md(q.stem, 'div.dq-stem');
    const feedback = el('div.dq-feedback');
    card.append(head, stem);

    if (q.type === 'choice') {
      const btns = q.choices.map((c, k) => el('button.dq-choice', { type: 'button' }, el('span.dq-no', { text: CIRCLED[k] }), md(c, 'span.dq-text')));
      const paint = () => {
        const pick = saved[q.id];
        btns.forEach((b, k) => {
          b.classList.toggle('right', pick != null && k + 1 === q.answer);
          b.classList.toggle('wrong', pick != null && k + 1 === pick && pick !== q.answer);
          b.disabled = pick != null;
        });
        card.classList.toggle('is-right', pick != null && pick === q.answer);
        card.classList.toggle('is-wrong', pick != null && pick !== q.answer);
        feedback.replaceChildren();
        if (pick != null) {
          feedback.append(
            el('p.dq-verdict', { text: pick === q.answer ? '⭕ 정답!' : `❌ 오답 — 정답은 ${CIRCLED[q.answer - 1]}` }),
            md(q.explanation, 'div.dq-exp')
          );
        }
      };
      btns.forEach((b, k) => b.addEventListener('click', () => { saved[q.id] = k + 1; persist(); paint(); refresh(); }));
      card.append(el('div.dq-choices', {}, btns), feedback);
      paint();
    } else {
      const area = el('textarea.dq-essay', { rows: 3, placeholder: '여기에 답을 써 보세요. (저장되지 않습니다)' });
      const show = el('button.pill.small.ghost', { type: 'button', text: '모범 답안 보기' });
      const paint = () => {
        const v = saved[q.id];
        card.classList.toggle('is-right', v === 'o');
        card.classList.toggle('is-wrong', v === 'x');
        feedback.replaceChildren();
        if (v === undefined) return;
        const mark = (val) => el(`button.pill.small${v === val ? '' : '.ghost'}`, { type: 'button', text: val === 'o' ? '⭕ 맞게 썼어요' : '❌ 빠뜨렸어요', onclick: () => { saved[q.id] = val; persist(); paint(); refresh(); } });
        feedback.append(
          el('p.dq-verdict', { text: '모범 답안' }),
          md(q.model, 'div.dq-exp'),
          q.keywords?.length ? el('p.dq-keys', { text: `꼭 들어갈 말: ${q.keywords.join(' · ')}` }) : null,
          el('div.hero-actions.left', {}, mark('o'), mark('x'))
        );
        show.style.display = "none";
      };
      show.addEventListener('click', () => { saved[q.id] = saved[q.id] ?? null; paint(); });
      card.append(area, el('div.hero-actions.left', {}, show), feedback);
      if (saved[q.id] != null) paint();
    }
    cards.push(card);
    list.append(card);
  });

  const reset = el('button.pill.small.ghost', { type: 'button', text: '처음부터 다시 풀기' });
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
    const fresh = buildDocQuiz(ctx, code, file);
    void fresh.then((r) => { if (r) section.replaceWith(r.section); r?.section.querySelector('h2')?.scrollIntoView(); });
  });

  const heading = el('h2', { id: 'doc-quiz', text: `📝 ${quiz.title || '단원 평가'}` });
  const section = el('section.dq', {}, heading, score, el('div.hero-actions.left', {}, reset), list);
  refresh();
  return { section, heading };
}
