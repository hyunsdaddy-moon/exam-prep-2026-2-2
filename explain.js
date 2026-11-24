/*
 * 시험 준비 웹앱 — 문제마다 붙는 「풀이 해설」 버튼과 팝업
 *
 *   explainButton(q, opts) → 버튼 하나. 누르면 화면 가운데 팝업(<dialog>)으로
 *     정답 · 풀이(explanation) · 보기별 해설(choiceNotes·bogiNotes) · 서술형 모범 답안 · 풀이 영상(video)을 보여 준다.
 *
 *   문항 모양은 두 가지를 다 받는다.
 *     읽기 문서 단원 평가(docquiz): answer = 3, model = '…', keywords = [...]
 *     단원·수준 평가·실전(solve):   answer = [3],  modelAnswer = '…'
 *   q.video = { src: 'exam/수학_시험공부/videos/x.mp4', start: 12.5, end: 40 } (start·end 는 초, 없어도 된다)
 *     또는 문자열 'exam/…/x.mp4'
 *
 *   opts.label: 팝업 제목에 붙일 문항 번호 (예: '3번')
 */

import { el, CIRCLED } from './dom.js?v=20261124-2203';
import { renderMarkdown } from './markdown.js?v=20261124-2203';

const md = (text, tag = 'div.md.ex-text') => {
  const box = el(tag);
  renderMarkdown(String(text || ''), box, { breaks: true });
  return box;
};

const answersOf = (q) => (Array.isArray(q.answer) ? q.answer : q.answer != null ? [q.answer] : []);

/** 보기별 해설 — 정답 보기는 초록으로 */
function notes(q) {
  if (!q.choiceNotes?.length && !q.bogiNotes) return null;
  const right = answersOf(q);
  const box = el('section.ex-notes', {}, el('h4', { text: '보기별 해설' }));
  if (q.bogiNotes) {
    box.append(el('ul.ex-bogi', {}, Object.entries(q.bogiNotes).map(([k, v]) => el('li', {}, el('b', { text: `${k}. ` }), md(v, 'span.md.ex-text')))));
  }
  if (q.choiceNotes?.length) {
    box.append(el('ul.ex-cn', {}, q.choiceNotes.map((note, i) => el(`li${right.includes(i + 1) ? '.ok' : ''}`, {},
      el('span.ex-cn-no', { text: CIRCLED[i] }),
      md(note, 'span.md.ex-text')
    ))));
  }
  return box;
}

/** 풀이 영상 — 문제 구간(start~end)만 재생한다 */
function videoBlock(q) {
  const v = typeof q.video === 'string' ? { src: q.video } : q.video;
  if (!v?.src) return null;
  const start = Number(v.start) || 0;
  const end = Number(v.end) || 0;
  const src = start || end ? `${v.src}#t=${start}${end ? `,${end}` : ''}` : v.src;
  const video = el('video.ex-video', { controls: true, preload: 'metadata', playsinline: true, poster: v.poster || null, src });
  // #t= 의 끝 시각을 지나면 멈춘다 (브라우저마다 다르게 처리해서 직접 잡는다)
  if (end) video.addEventListener('timeupdate', () => { if (video.currentTime >= end - 0.35 && !video.paused) { video.pause(); video.currentTime = Math.max(start, end - 0.4); } });
  return el('section.ex-video-box', {}, el('h4', { text: '🎬 풀이 몽타주 영상' }), video);
}

let dialog = null;
function getDialog() {
  if (dialog) return dialog;
  dialog = el('dialog.ex-dialog', { 'aria-label': '풀이 해설' });
  // 바깥(어두운 곳)을 누르면 닫는다
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    for (const v of dialog.querySelectorAll('video')) v.pause();
    dialog.replaceChildren();
  });
  document.body.append(dialog);
  return dialog;
}

export function openExplain(q, opts = {}) {
  const d = getDialog();
  const right = answersOf(q);
  const essay = q.type === 'essay';
  const model = essay ? (q.model || q.modelAnswer) : null;
  const close = el('button.ex-close', { type: 'button', 'aria-label': '닫기', text: '✕', onclick: () => d.close() });
  const body = el('div.ex-body',
    {},
    el('div.ex-q', {}, md(q.stem, 'div.md.ex-text.ex-stem')),
    !essay && right.length ? el('p.ex-answer', {}, '정답 ', el('b', { text: right.map((n) => CIRCLED[n - 1] || n).join(', ') }),
      q.choices?.[right[0] - 1] ? el('span.ex-answer-text', {}, md(q.choices[right[0] - 1], 'span.md.ex-text')) : null) : null,
    !essay && q.explanation ? el('section', {}, el('h4', { text: '풀이' }), md(q.explanation)) : null,
    essay && model ? el('section', {}, el('h4', { text: '모범 답안' }), md(model)) : null,
    essay && q.keywords?.length ? el('p.ex-keys', { text: `꼭 들어갈 말: ${q.keywords.join(' · ')}` }) : null,
    notes(q),
    videoBlock(q),
    !q.explanation && !model && !q.choiceNotes ? el('p.ex-empty', { text: '이 문제는 아직 해설이 없습니다.' }) : null
  );
  d.replaceChildren(el('header.ex-head', {}, el('h3', { text: `💡 풀이 해설${opts.label ? ` · ${opts.label}` : ''}` }), close), body);
  d.showModal();
  body.scrollTop = 0;
}

/** 문제 아래에 붙이는 「풀이 해설」 버튼 */
export function explainButton(q, opts = {}) {
  const hasVideo = !!(typeof q.video === 'string' ? q.video : q.video?.src);
  return el('div.ex-row', {},
    el('button.ex-btn', { type: 'button', title: '정답과 풀이를 팝업으로 봅니다', onclick: () => openExplain(q, opts) },
      '💡 풀이 해설', hasVideo ? el('span.ex-badge', { text: '🎬 영상' }) : null)
  );
}
