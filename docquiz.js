/*
 * 시험 준비 웹앱 — 읽기 문서 끝의 「단원 평가」
 *
 * 문항: data/docquiz/<과목 코드>.json  { docs: { "<문서 경로>": { title, questions: [...] } } }
 *   객관식 { id, type:'choice', section, level, stem, choices, answer(1부터), explanation }
 *   서술형 { id, type:'essay',  section, stem, model, keywords }  — 모범 답안을 보고 스스로 ○/× 를 매긴다
 *
 * 수준 평가처럼 흰 시험지 2단으로 그린다. 답을 고른 뒤 「제출」하면 채점하고 해설을 보여 준다.
 * 제출할 때마다 1차·2차·3차… 기록이 남는다.
 *   기록: Firestore 규칙을 바꾸지 않으려고 mode 'assess' 의 session·attempt 로 남긴다.
 *         session.round = 40 + 문서 번호(과목 안 순서). 수준 평가(1·2)·단원 평가(11~16)와 겹치지 않는다.
 *         서술형은 제출 뒤 스스로 ○/× 를 매기면 같은 session 에 attempt 를 하나 더 남긴다(나중 것이 이긴다).
 *   고르는 중인 답(아직 제출 전)은 이 브라우저에만 둔다.
 */

import { el, CIRCLED, newId, showBlankAlert, a4Pages } from './dom.js?v=20261126-1824';
import { renderMarkdown } from './markdown.js?v=20261126-1824';
import { getCurrentLearner, loadRecords, saveRecords } from './store.js?v=20261126-1824';
import { mergeRecordsForLearner } from './grade.mjs?v=20261126-1824';
import { explainButton } from './explain.js?v=20261126-1824';
import { inkTools } from './ink.js?v=20261126-1824';
import { passageBlock } from './solve.js?v=20261126-1824';

/* 채점 표시 — 선생님이 빨간 색연필로 그은 것처럼: 손으로 그린 동그라미(맞음)·빗금(틀림)에
 * 연필 결(알갱이)과 살짝 떨리는 선을 SVG 필터로 입힌다. 필터는 문서에 한 번만 넣는다. */
function ensurePencilDefs() {
  if (document.getElementById('red-pencil')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `<defs><filter id="red-pencil" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="3" result="wob"/>
    <feDisplacementMap in="SourceGraphic" in2="wob" scale="3" xChannelSelector="R" yChannelSelector="G" result="line"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="grain"/>
    <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.7 0 0 0 1.75" result="mask"/>
    <feComposite in="line" in2="mask" operator="in"/>
  </filter></defs>`;
  document.body.append(svg);
}
const PENCIL_PATHS = {
  // 한 번에 휙 돌리고 끝이 시작점을 지나가는 동그라미 + 덧칠한 두 번째 획
  o: ['M60 9C30 5 7 27 9 54C11 81 44 95 71 85C93 76 97 43 80 22C70 9 52 6 36 13', 'M57 13C33 11 14 30 16 54C18 76 45 88 68 80'],
  // 위에서 아래로 힘 있게 그은 빗금 두 번
  x: ['M88 -4C71 32 48 66 12 104', 'M81 2C66 36 45 66 18 99'],
};
function pencilMark(kind) {
  if (!PENCIL_PATHS[kind]) return '';
  ensurePencilDefs();
  const tilt = Math.round(Math.random() * 16 - 8);
  const [a, b] = PENCIL_PATHS[kind];
  return `<svg viewBox="0 0 100 100" aria-hidden="true" style="transform:rotate(${tilt}deg)"><g filter="url(#red-pencil)" fill="none" stroke="#e0101e" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${a}" stroke-width="7.5"/><path d="${b}" stroke-width="4.5" opacity=".7"/></g></svg>`;
}
function setGrade(node, kind) {
  node.innerHTML = pencilMark(kind);
  node.setAttribute('aria-label', kind === 'o' ? '맞음' : kind === 'x' ? '틀림' : '');
}

const ROUND_BASE = 40;
const SESSION_PREFIX = 'dqs-';
/** 처음 배포본은 문항 id 가 soc-d1-01 꼴이라 수준 평가(d1·d2)와 겹쳤다 → soc-q1-01 로 바꿨다. 옛 기록도 새 id 로 읽는다 */
const normQ = (q) => String(q).replace(/^([a-z]+)-d(\d+)-(\d+)$/, '$1-q$2-$3');
/** 이 단원 평가가 남긴 기록인가 */
export const isDocQuizSession = (session) => String(session || '').startsWith(SESSION_PREFIX);

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

const shortDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}.${d.getDate()}`;
};

/** 보기마다 맞고 틀린 까닭 (data 의 choiceNotes · bogiNotes 가 있을 때만) */
export function choiceNotes(q, pick) {
  if (!q.choiceNotes?.length && !q.bogiNotes) return '';
  const box = el('div.dq-notes', {}, el('b.dq-notes-title', { text: '보기별 해설' }));
  if (q.bogiNotes) {
    box.append(el('ul.dq-bogi', {}, Object.entries(q.bogiNotes).map(([k, v]) => el('li', {}, el('b', { text: `${k}. ` }), md(v, 'span.md.p-text')))));
  }
  if (q.choiceNotes?.length) {
    box.append(el('ul.dq-cn', {}, q.choiceNotes.map((note, i) => el(`li${i + 1 === q.answer ? '.ok' : ''}${i + 1 === pick && pick !== q.answer ? '.mine' : ''}`, {},
      el('span.dq-cn-no', { text: CIRCLED[i] }),
      md(note, 'span.md.p-text'),
      i + 1 === pick && pick !== q.answer ? el('small.dq-cn-tag', { text: '내가 고른 답' }) : null
    ))));
  }
  return box;
}

/** 오답 노트용: 단원 평가에서 마지막으로 틀린 문제들 (units.unitWrongs 와 같은 모양) */
export async function docWrongs(ctx, subjects, attempts) {
  const mine = attempts.filter((a) => a.mode === 'assess' && a.correct != null && isDocQuizSession(a.session)).map((a) => ({ ...a, q: normQ(a.q) })).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = new Map();
  for (const a of mine) last.set(a.q, a);
  const out = [];
  for (const sub of subjects) {
    const data = await loadQuiz(ctx, sub.code);
    for (const [file, quiz] of Object.entries(data.docs || {})) {
      const doc = (sub.docs || []).find((d) => d.file === file || d.file.normalize('NFC') === file);
      const docIndex = (sub.docs || []).indexOf(doc);
      let no = 0;
      let essayNo = 0;
      for (const q of quiz.questions || []) {
        const n = q.type === 'choice' ? ++no : ++essayNo;
        const a = last.get(q.id);
        if (!a || a.correct !== false) continue;
        const question = q.type === 'choice'
          ? { ...q, subject: sub.subject, no: n, answer: [q.answer], points: 1 }
          : { ...q, subject: sub.subject, no: n, modelAnswer: q.model + (q.keywords?.length ? `\n\n꼭 들어갈 말: ${q.keywords.join(' · ')}` : ''), points: 1 };
        out.push({
          subject: sub,
          round: { title: `마무리 평가 · ${doc?.title || file}` },
          question,
          group: null,
          attempt: a,
          href: docIndex >= 0 ? `#/s/${sub.code}/${docIndex}` : null,
        });
      }
    }
  }
  return out;
}

/** 이 문서의 지난 제출 기록: [{ n, session, at, byQ: Map(q → attempt) }] (1차부터) */
async function loadTries(code, round, ids) {
  const loaded = await loadRecords();
  const merged = mergeRecordsForLearner(loaded.records, getCurrentLearner());
  const sessions = [...merged.sessions.values()]
    .filter((s) => s.mode === 'assess' && s.subject === code && s.round === round)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const bySession = new Map(sessions.map((s) => [s.session, new Map()]));
  const attempts = merged.attempts
    .filter((a) => bySession.has(a.session))
    .map((a) => ({ ...a, q: normQ(a.q) }))
    .filter((a) => ids.has(a.q))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const a of attempts) bySession.get(a.session).set(a.q, a); // 같은 문제는 나중 것
  return { ok: loaded.ok, tries: sessions.map((s, i) => ({ n: i + 1, session: s.session, at: s.at, byQ: bySession.get(s.session) })) };
}

const scoreOf = (qs, byQ) => {
  const right = qs.filter((q) => byQ.get(q.id)?.correct === true).length;
  return { right, total: qs.length, pct: Math.round((right / qs.length) * 100) };
};

/**
 * 문서에 단원 평가가 있으면 { section, heading } 을 돌려준다. 없으면 null
 * opts: { subject: '과학', docTitle: '5.2 힘과 우리 생활', docIndex: 1 }
 */
export async function buildDocQuiz(ctx, code, file, opts = {}) {
  const data = await loadQuiz(ctx, code);
  const quiz = data.docs?.[file] || data.docs?.[file.normalize('NFC')];
  if (!quiz?.questions?.length) return null;
  const qs = quiz.questions;
  const ids = new Set(qs.map((q) => q.id));
  const round = ROUND_BASE + (Number(opts.docIndex) || 0);
  const learner = getCurrentLearner();

  // 제출 전 답안(이 브라우저) { picks: {q: n}, texts: {q: 글}, submitted: session|null, retaking: boolean }
  const draftKey = `examprep.docquiz2.${learner}.${code}.${file}`;
  let draft = { picks: {}, texts: {}, submitted: null, retaking: false };
  try { draft = { ...draft, ...JSON.parse(localStorage.getItem(draftKey) || '{}') }; } catch { /* 새로 시작 */ }
  const persist = () => { try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* 저장 못 해도 푸는 데는 지장 없다 */ } };
  const hasDraft = () =>
    Object.values(draft.picks || {}).some(Boolean) ||
    Object.values(draft.texts || {}).some((v) => String(v || '').trim().length > 0);

  let { ok, tries } = await loadTries(code, round, ids);
  // 제출했는데 그 기록이 없어졌으면(다른 참여자 등) 새로 시작
  if (draft.submitted && !tries.some((t) => t.session === draft.submitted)) {
    draft = { picks: {}, texts: {}, submitted: null, retaking: false };
  }
  // 이미 제출한 기록이 있고 새 답안을 고르는 중이 아니면 가장 최근 제출 결과를 보여 주고 다음 차수 재시험 버튼을 띄운다
  let viewingSession = draft.submitted
    || (tries.length && !draft.retaking && !hasDraft() ? tries.at(-1).session : null);
  const current = () => (viewingSession ? tries.find((t) => t.session === viewingSession) || null : null);

  const choiceQs = qs.filter((q) => q.type === 'choice');
  const essayCount = qs.length - choiceQs.length;

  /* ── 머리글 · 하단 도구줄 ── */
  const scoreField = el('i');
  const status = el('p.sheet-note.dq-progress');
  const footStatus = el('p.sheet-note.dq-progress');
  const historyBox = el('div.dq-history');
  const submitBtn = el('button.dq-submit', { type: 'button', text: '제출' });
  const footSubmitBtn = el('button.dq-submit', { type: 'button', text: '제출' });
  const nextBtn = el('button.dq-submit.dq-retry', { type: 'button' });
  const footNextBtn = el('button.dq-submit.dq-retry', { type: 'button' });
  const field = (label, value) => el('div', {}, el('span', { text: label }), typeof value === 'string' ? el('i', { text: value }) : value);
  const head = el('header.sheet-head', {},
    el('div.sheet-title', {},
      el('small', { text: `2026 2학기 2회고사 · 마무리 평가${opts.docTitle ? ` · ${opts.docTitle}` : ''}` }),
      el('h1', {}, opts.subject || '', el('span', { text: ` ${quiz.title || '마무리 평가'}` }))
    ),
    el('p.sheet-note', { text: `선택형 ${choiceQs.length}문항${essayCount ? ` · 서술형 ${essayCount}문항` : ''} · 모든 문제를 푼 뒤 「제출」을 누르면 채점됩니다. 제출한 뒤에는 다음 차수 재시험을 치를 수 있습니다.` }),
    el('div.sheet-fields', {},
      field('과목', opts.subject || ''),
      field('이름', learner),
      field('날짜', new Date().toLocaleDateString('ko-KR')),
      field('점수', scoreField)
    ),
    historyBox,
    el('div.dq-tools', {}, status, submitBtn, nextBtn),
    !ok ? el('p.sheet-note.dq-warn', { text: '서버에서 기록을 읽지 못했습니다. 이 브라우저에 보관된 기록만 보입니다.' }) : null
  );
  const footTools = el('div.dq-tools.dq-foot-tools', {}, footStatus, footSubmitBtn, footNextBtn);

  /* ── 문제 ── */
  const ink = { pending: [], add(b, id) { this.pending.push([b, id]); } }; // 연필·지우개 — 시험지가 만들어진 뒤 붙인다
  const cols = el('div.cols');
  const essays = el('div.dq-essays');
  const painters = [];
  const qInfo = new Map(); // q.id → { label, block }
  let lastSection = null;
  let no = 0;
  let essayNo = 0;

  /* 같은 지문을 보는 선택형 문제가 이어지면 시험지처럼 「[19~23] 다음 글을 읽고…」와 지문을 묶음 앞에 한 번만 펼쳐 둔다 */
  const passageRuns = new Map(); // 묶음 첫 문항 id → { from, to }
  const inRun = new Set();
  {
    const keyOf = (q) => (q.type === 'choice' && q.passageRef ? JSON.stringify(q.passageRef) : null);
    let n = 0;
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        passageRuns.set(run[0].q.id, { from: run[0].n, to: run[run.length - 1].n });
        run.forEach((r) => inRun.add(r.q.id));
      }
      run = [];
    };
    for (const q of qs) {
      if (q.type !== 'choice') continue;
      n += 1;
      const k = keyOf(q);
      if (k && run.length && keyOf(run[0].q) === k && (run[0].q.section || '') === (q.section || '')) run.push({ q, n });
      else { flush(); if (k) run.push({ q, n }); }
    }
    flush();
  }

  const histIcons = (q) => {
    const box = el('span.dq-hist');
    for (const t of tries) {
      const a = t.byQ.get(q.id);
      const v = a?.correct === true ? 'o' : a?.correct === false ? 'x' : '-';
      box.append(el(`i.dq-h.${v === 'o' ? 'ok' : v === 'x' ? 'ng' : 'na'}`, { title: `${t.n}차 ${v === 'o' ? '맞음' : v === 'x' ? '틀림' : '채점 안 함'}`, text: `${t.n}${v === 'o' ? '○' : v === 'x' ? '✕' : '·'}` }));
    }
    return box;
  };

  for (const q of qs) {
    const target = q.type === 'choice' ? cols : essays;
    if (q.type === 'choice' && q.section && q.section !== lastSection) {
      lastSection = q.section;
      cols.append(el('h3.p-group', { text: q.section }));
    }
    const runInfo = passageRuns.get(q.id);
    if (runInfo) {
      cols.append(el('div.p-passage-lead', {},
        el('p.p-lead', { text: `[${runInfo.from}~${runInfo.to}] 다음 글을 읽고, 물음에 답하시오.` }),
        passageBlock(q, true) || ''
      ));
    }
    const label = q.type === 'choice' ? `${++no}.` : `서술형 ${++essayNo}.`;
    const grade = el('span.dq-grade', { 'aria-live': 'polite' });
    const hist = el('div.dq-hist-row');
    const block = el(`article.p-q${q.type === 'essay' ? '.essay' : ''}`, {},
      el('div.p-stem', {}, el('b.p-no', {}, grade, label), md(q.stem), q.level && q.level !== '서술형' ? el('span.p-points', { text: `[${q.level}]` }) : null),
      hist,
      inRun.has(q.id) ? '' : (passageBlock(q, true) || '')
    );
    qInfo.set(q.id, { label: q.type === 'choice' ? `${no}번` : `서술형 ${essayNo}번`, block });
    const feedback = el('div.dq-exp');

    if (q.type === 'choice') {
      const items = q.choices.map((c, i) => el('li', {},
        el('button.p-pick', { type: 'button', 'aria-label': `${i + 1}번 고르기`, onclick: () => {
          if (current()) return;
          draft.picks[q.id] = draft.picks[q.id] === i + 1 ? undefined : i + 1;
          persist();
          paintAll();
        } }, el('span.p-mark', { text: CIRCLED[i] }), md(c))
      ));
      const exBtn = explainButton(q, { label: `${no}번` });
      block.append(el('ol.p-choices.p-choose', {}, items), exBtn, feedback);
      painters.push(() => {
        const t = current();
        exBtn.hidden = !t; // 풀이 해설은 제출한 뒤에만
        const a = t?.byQ.get(q.id);
        const pick = t ? a?.picked?.[0] : draft.picks[q.id];
        const graded = !!t;
        items.forEach((li, i) => {
          const n = i + 1;
          li.classList.toggle('on', n === pick);
          li.classList.toggle('answer', graded && n === q.answer);
          li.classList.toggle('miss', graded && n === pick && pick !== q.answer);
          li.firstChild.disabled = graded;
          li.querySelector('.p-mark').textContent = n === pick ? String(n) : CIRCLED[i];
        });
        const right = graded && pick === q.answer;
        block.classList.toggle('is-right', right);
        block.classList.toggle('is-wrong', graded && !right);
        setGrade(grade, graded ? (right ? 'o' : 'x') : null);
        feedback.replaceChildren();
        if (graded) {
          feedback.append(
            el('b.dq-verdict', { text: right ? '정답' : pick ? `오답 · 정답 ${CIRCLED[q.answer - 1]}` : `안 풂 · 정답 ${CIRCLED[q.answer - 1]}` }),
            md(q.explanation),
            choiceNotes(q, pick)
          );
        }
        hist.replaceChildren(tries.length ? histIcons(q) : '');
      });
    } else {
      const input = el('textarea.p-write', { rows: 4, placeholder: '여기에 답을 써 보세요.' });
      input.value = draft.texts[q.id] || '';
      input.addEventListener('input', () => { draft.texts[q.id] = input.value; persist(); });
      const exBtn = explainButton(q, { label: `서술형 ${essayNo}번` });
      block.append(input, exBtn, feedback);
      painters.push(() => {
        const t = current();
        exBtn.hidden = !t; // 풀이 해설은 제출한 뒤에만
        const a = t?.byQ.get(q.id);
        input.readOnly = !!t;
        if (t && a?.text != null) input.value = a.text;
        else if (!t) input.value = draft.texts[q.id] || '';
        const v = a?.correct === true ? 'o' : a?.correct === false ? 'x' : null;
        block.classList.toggle('is-right', v === 'o');
        block.classList.toggle('is-wrong', v === 'x');
        setGrade(grade, v);
        feedback.replaceChildren();
        if (t) {
          const mark = (val, text) => el(`button.dq-btn${v === val ? '.on' : ''}`, { type: 'button', text, onclick: async () => {
            await saveRecords([{ type: 'attempt', id: newId('dqa'), session: t.session, mode: 'assess', q: q.id, qtype: 'essay', subject: code, picked: [], correct: val === 'o', points: 1, earned: val === 'o' ? 1 : 0, text: input.value }]);
            await reload();
          } });
          feedback.append(
            el('b.dq-verdict', { text: '모범 답안' }),
            md(q.model),
            q.keywords?.length ? el('p.dq-keys', { text: `꼭 들어갈 말: ${q.keywords.join(' · ')}` }) : null,
            el('p.dq-keys', { text: v ? '' : '모범 답안과 비교해 스스로 채점하세요.' }),
            el('div.dq-marks', {}, mark('o', '○ 맞게 썼어요'), mark('x', '／ 빠뜨렸어요'))
          );
        }
        hist.replaceChildren(tries.length ? histIcons(q) : '');
      });
    }
    target.append(block);
    ink.add(block, q.id);
  }

  /* ── 위쪽·아래쪽 기록 · 버튼 ── */
  const setStatusText = (msg) => {
    status.textContent = msg;
    footStatus.textContent = msg;
  };
  const paintHead = () => {
    const t = current();
    historyBox.replaceChildren();
    if (tries.length) {
      historyBox.append(
        el('span.dq-history-label', { text: '기록' }),
        ...tries.map((x) => {
          const s = scoreOf(qs, x.byQ);
          const wrong = qs.filter((q) => x.byQ.get(q.id)?.correct === false).length;
          // 제출 결과 보기 상태에서는 회차 배지를 눌러 1차·2차… 결과를 번갈아 볼 수 있다
          const attrs = t
            ? { type: 'button', title: `${x.n}차 결과 보기 · 틀린 문제 ${wrong}개`, onclick: () => { viewingSession = x.session; paintAll(); } }
            : { title: `틀린 문제 ${wrong}개` };
          return el(`${t ? 'button' : 'span'}.dq-try${x === t ? '.on' : ''}`, attrs,
            el('b', { text: `${x.n}차` }), ` ${s.right}/${s.total} · ${s.pct}점`, el('small', { text: ` ${shortDate(x.at)} · 틀림 ${wrong}` }));
        })
      );
    }
    if (t) {
      const s = scoreOf(qs, t.byQ);
      scoreField.textContent = `${s.pct}점`;
      setStatusText(`${t.n}차 채점 결과 · 맞힘 ${s.right} / ${s.total}${essayCount ? ' (서술형은 스스로 채점)' : ''}`);
      submitBtn.style.display = 'none';
      footSubmitBtn.style.display = 'none';
      nextBtn.style.display = '';
      footNextBtn.style.display = '';
      const nextLabel = hasDraft() ? `${tries.length + 1}차 재시험 이어서` : `${tries.length + 1}차 재시험 시도`;
      nextBtn.textContent = nextLabel;
      footNextBtn.textContent = nextLabel;
    } else {
      const done = choiceQs.filter((q) => draft.picks[q.id]).length;
      scoreField.textContent = '제출 후';
      setStatusText(`${tries.length + 1}차 · ${done} / ${choiceQs.length}문제 고름`);
      submitBtn.style.display = '';
      footSubmitBtn.style.display = '';
      nextBtn.style.display = 'none';
      footNextBtn.style.display = 'none';
    }
  };
  const paintAll = () => {
    for (const p of painters) p();
    paintHead();
  };

  const reload = async () => {
    ({ ok, tries } = await loadTries(code, round, ids));
    paintAll();
  };

  const onSubmit = async () => {
    // 모든 문제를 풀어야 제출된다 — 안 푼 문제 번호를 팝업으로 알려 주고 그 문제로 데려간다
    const blanks = qs.filter((q) => (q.type === 'choice' ? !draft.picks[q.id] : !(draft.texts[q.id] || '').trim()));
    if (blanks.length) {
      showBlankAlert(blanks.map((q) => {
        const info = qInfo.get(q.id);
        return {
          label: info?.label || '어떤',
          go: () => {
            const b = info?.block;
            if (!b) return;
            b.scrollIntoView({ behavior: 'smooth', block: 'start' });
            b.classList.add('blank-flash');
            setTimeout(() => b.classList.remove('blank-flash'), 2500);
          },
        };
      }));
      return;
    }
    submitBtn.disabled = true;
    footSubmitBtn.disabled = true;
    submitBtn.textContent = '저장 중…';
    footSubmitBtn.textContent = '저장 중…';
    const session = newId('dqs');
    const records = [{ type: 'session', session, mode: 'assess', subject: code, round, count: qs.length }];
    for (const q of qs) {
      if (q.type === 'choice') {
        const pick = draft.picks[q.id];
        const correct = pick === q.answer;
        records.push({ type: 'attempt', id: newId('dqa'), session, mode: 'assess', q: q.id, qtype: 'choice', subject: code, picked: pick ? [pick] : [], correct, points: 1, earned: correct ? 1 : 0 });
      } else {
        records.push({ type: 'attempt', id: newId('dqa'), session, mode: 'assess', q: q.id, qtype: 'essay', subject: code, picked: [], correct: null, points: 1, earned: 0, text: (draft.texts[q.id] || '').slice(0, 4000) });
      }
    }
    const res = await saveRecords(records);
    draft = { picks: {}, texts: {}, submitted: session, retaking: false };
    viewingSession = session;
    persist();
    await reload();
    submitBtn.disabled = false;
    footSubmitBtn.disabled = false;
    submitBtn.textContent = '제출';
    footSubmitBtn.textContent = '제출';
    if (!res.ok) setStatusText(`${status.textContent} · ${res.message}`);
    section.querySelector('.dq-paper')?.scrollIntoView({ behavior: 'smooth' });
  };
  submitBtn.addEventListener('click', onSubmit);
  footSubmitBtn.addEventListener('click', onSubmit);

  const onNext = () => {
    const resuming = hasDraft();
    draft = resuming ? { ...draft, submitted: null, retaking: true } : { picks: {}, texts: {}, submitted: null, retaking: true };
    viewingSession = null;
    persist();
    if (!resuming) for (const t of section.querySelectorAll('.p-q.essay textarea')) t.value = '';
    paintAll();
    section.querySelector('.dq-paper')?.scrollIntoView({ behavior: 'smooth' });
  };
  nextBtn.addEventListener('click', onNext);
  footNextBtn.addEventListener('click', onNext);

  // 실제 시험지처럼 A4 쪽마다 2단으로 나눈다 — 선택형 다음에 서술형이 이어지고, 하단 도구줄은 마지막 쪽 아래에
  const pages = a4Pages(head, [...cols.children, ...(essayCount ? [el('h3.p-group.dq-essay-title', { text: '서술형' })] : []), ...essays.children], 'sheet.exam-paper.dq-paper');
  const sheet = el('div.dq-pages.exam-paper', {}, pages.node, footTools);
  const pen = inkTools(sheet, `doc.${code}.${file}`);
  for (const [b, id] of ink.pending) pen.add(b, id);
  const heading = el('h2', { id: 'doc-quiz', text: `📝 ${quiz.title || '마무리 평가'}` });
  const section = el('section.dq', {}, heading, sheet);
  paintAll();
  return { section, heading };
}
