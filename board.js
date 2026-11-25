/*
 * 시험 준비 웹앱 — 질문 게시판 (모든 기기에서 실시간 공유)
 *   #/board                          질문 목록 + 새 질문
 *   #/board?s=<과목>&q=<문제 id>&t=…  오답 노트에서 「질문하기」로 왔을 때 — 그 문제를 붙여 쓴다
 *
 * 글은 Firestore exams/{시험}/posts 에 둔다(store.js). 질문·답글 모두 이 브라우저에서 쓴 글만 지울 수 있고,
 * 「해결됨」 표시는 누구나 바꿀 수 있다.
 */

import { el } from './dom.js?v=20261125-2130';
import { getCurrentLearner, subscribePosts, addPost, setPostSolved, deletePost } from './store.js?v=20261125-2130';
import { avatar } from './characters.js?v=20261125-2130';

const VIEWS = [
  ['open', '답을 기다리는 질문'],
  ['all', '모든 질문'],
  ['solved', '해결된 질문'],
  ['mine', '내 질문'],
];

function when(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}시간 전`;
  return d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 줄바꿈을 살려 글을 그대로 보여 준다(마크업으로 해석하지 않는다) */
const textBlock = (text) => el('p.post-text', { text });

export function renderBoard(ctx, exam, query) {
  document.title = `질문 게시판 — ${exam.title}`;
  ctx.setNav('board');
  const subjects = exam.subjects;
  const nameOf = (code) => subjects.find((s) => s.code === code)?.subject || '';
  const me = getCurrentLearner();
  let view = VIEWS.some(([k]) => k === query.get('v')) ? query.get('v') : 'open';
  let subjectFilter = subjects.some((s) => s.code === query.get('fs')) ? query.get('fs') : 'all';

  /* 새 질문 쓰기 — 오답 노트에서 붙여 온 문제가 있으면 함께 보여 준다 */
  let attached = query.get('q') ? { ref: query.get('q'), refText: query.get('t') || '', subject: query.get('s') } : null;
  const subjectSel = el('select.learner-select', { 'aria-label': '과목' },
    el('option', { value: '', text: '과목 고르기(선택)' }),
    subjects.map((s) => el('option', { value: s.code, text: s.subject }))
  );
  subjectSel.value = attached?.subject && subjects.some((s) => s.code === attached.subject) ? attached.subject : '';
  const input = el('textarea.essay-input', { rows: 4, maxlength: 2000, placeholder: '모르는 것, 헷갈리는 것을 적어 주세요. 예) 5번에서 왜 ③이 답인지 모르겠어요.' });
  const status = el('span.hint', { 'aria-live': 'polite' });
  const send = el('button.pill', { type: 'submit', text: '질문 올리기' });
  const attachBox = el('div.attach');
  const drawAttach = () => {
    attachBox.replaceChildren(
      attached
        ? el('div.attach-card', {},
            el('span.badge', { text: '붙인 문제' }),
            el('span.attach-text', { text: attached.refText || attached.ref }),
            el('button.link', { type: 'button', text: '떼기', onclick: () => {
              attached = null;
              drawAttach();
            } })
          )
        : ''
    );
  };
  drawAttach();
  const form = el('form.post-form', {},
    el('div.post-form-top', {}, el('strong', { text: `${me} 이름으로 질문하기` }), subjectSel),
    attachBox,
    input,
    el('div.post-form-foot', {}, send, status)
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    send.disabled = true;
    status.textContent = '올리는 중…';
    const result = await addPost({ kind: 'question', subject: subjectSel.value || attached?.subject || null, ref: attached?.ref, refText: attached?.refText, text: input.value });
    send.disabled = false;
    if (result.ok) {
      input.value = '';
      attached = null;
      drawAttach();
      status.textContent = '올렸습니다.';
      view = 'open';
      history.replaceState(null, '', '#/board');
      draw();
    } else status.textContent = result.message;
  });

  /* 거르기 */
  const viewBar = el('div.segment', { role: 'group', 'aria-label': '질문 보기' });
  const subjectChips = el('div.chips');
  const list = el('div.post-list', { 'aria-live': 'polite' });
  const netNote = el('p.save-warn');
  netNote.hidden = true;

  let state = { posts: [], ready: false, online: true, uid: null };
  const drafts = new Map(); // 질문 id → 쓰던 답글 (다시 그려도 남게)
  let pendingDraw = false;

  const answerForm = (q) => {
    const box = el('textarea.essay-input.reply-input', { rows: 2, maxlength: 2000, placeholder: `${getCurrentLearner()} 이름으로 답글 쓰기` });
    box.value = drafts.get(q.id) || '';
    box.addEventListener('input', () => drafts.set(q.id, box.value));
    box.addEventListener('blur', () => {
      if (pendingDraw) setTimeout(() => {
        if (!list.contains(document.activeElement)) draw();
      }, 200);
    });
    const msg = el('span.hint');
    const btn = el('button.pill.small', { type: 'submit', text: '답글 달기' });
    const f = el('form.reply-form', {}, box, el('div.post-form-foot', {}, btn, msg));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const r = await addPost({ kind: 'answer', parent: q.id, subject: q.subject, text: box.value });
      btn.disabled = false;
      if (r.ok) {
        drafts.delete(q.id);
        box.value = '';
      } else msg.textContent = r.message;
    });
    return f;
  };

  const postHead = (p) =>
    el('div.post-head', {},
      avatar(p.learner, 'sm'),
      el('strong', { text: p.learner }),
      el('span.post-when', { text: when(p.at) }),
      p.uid && p.uid === state.uid
        ? el('button.link.danger', { type: 'button', text: '지우기', onclick: async () => {
            if (!confirm('이 글을 지울까요?')) return;
            await deletePost(p.id);
          } })
        : null
    );

  const questionCard = (q, answers) =>
    el(`article.post-card${q.solved ? '.solved' : ''}`, {},
      el('div.post-top', {},
        q.subject ? el('span.badge', { text: nameOf(q.subject) }) : null,
        el(`span.badge.${q.solved ? 'graduated' : 'waiting'}`, { text: q.solved ? '해결됨' : answers.length ? `답글 ${answers.length}` : '답을 기다림' }),
        el('button.link', { type: 'button', text: q.solved ? '다시 열기' : '해결됨으로 표시', onclick: () => void setPostSolved(q.id, !q.solved) })
      ),
      postHead(q),
      q.refText ? el('div.attach-card.small', {}, el('span.badge', { text: '문제' }), el('span.attach-text', { text: q.refText })) : null,
      textBlock(q.text),
      answers.length
        ? el('div.answers', {}, answers.map((a) => el('div.answer', {}, postHead(a), textBlock(a.text))))
        : null,
      answerForm(q)
    );

  function draw() {
    // 답글을 쓰는 중에 새 글이 오면 쓰던 칸이 사라지지 않도록, 칸을 떠난 뒤에 다시 그린다
    if (list.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') {
      pendingDraw = true;
      return;
    }
    pendingDraw = false;
    const current = getCurrentLearner();
    const questions = state.posts.filter((p) => p.kind === 'question');
    const answersOf = (id) => state.posts.filter((p) => p.kind === 'answer' && p.parent === id).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const counts = {
      open: questions.filter((q) => !q.solved).length,
      all: questions.length,
      solved: questions.filter((q) => q.solved).length,
      mine: questions.filter((q) => q.learner === current).length,
    };
    viewBar.replaceChildren(...VIEWS.map(([k, label]) => el('button', { type: 'button', text: `${label} ${counts[k]}`, 'aria-pressed': String(view === k), onclick: () => {
      view = k;
      draw();
    } })));
    subjectChips.replaceChildren(
      el('button.chip.pick', { type: 'button', 'aria-pressed': String(subjectFilter === 'all'), text: '모든 과목', onclick: () => {
        subjectFilter = 'all';
        draw();
      } }),
      ...subjects.map((s) => el('button.chip.pick', { type: 'button', 'aria-pressed': String(subjectFilter === s.code), text: s.subject, onclick: () => {
        subjectFilter = s.code;
        draw();
      } }))
    );
    netNote.hidden = state.online;
    netNote.textContent = '인터넷에 연결되지 않아 게시판을 불러오지 못했습니다. 연결되면 자동으로 나타납니다.';
    const shown = questions
      .filter((q) => (view === 'open' ? !q.solved : view === 'solved' ? q.solved : view === 'mine' ? q.learner === current : true))
      .filter((q) => subjectFilter === 'all' || q.subject === subjectFilter);
    list.replaceChildren(
      ...(!state.ready
        ? [el('p.note', { text: '게시판을 불러오는 중…' })]
        : shown.length
          ? shown.map((q) => questionCard(q, answersOf(q.id)))
          : [el('p.note', { text: questions.length ? '이 조건에 맞는 질문이 없습니다.' : '아직 질문이 없습니다. 첫 질문을 올려 보세요.' })])
    );
  }

  const stop = subscribePosts((s) => {
    state = s;
    draw();
  });
  ctx.onLeave(stop);
  // 「n분 전」을 새로 고친다
  const timer = setInterval(() => draw(), 60000);
  ctx.onLeave(() => clearInterval(timer));

  ctx.show(
    el('section.hero', {},
      el('p.eyebrow', { text: `${me} · 질문 게시판` }),
      el('h1', { text: '모르면 묻고, 알면 답하기' }),
      el('p.sub', { text: '글은 모든 기기에서 바로 보입니다. 오답 노트의 「이 문제 질문하기」로 오면 문제가 함께 붙습니다.' })
    ),
    el('div.wrap', {},
      el('section.section', { style: 'padding-top:0' }, form),
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '질문' })),
        el('div.filter-bar', {}, viewBar, subjectChips),
        netNote,
        list
      )
    )
  );
  draw();
  if (attached) input.focus();
}
