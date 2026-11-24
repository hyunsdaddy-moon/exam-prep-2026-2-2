/*
 * 시험 준비 웹앱 — 인쇄용 화면 (docs/시험준비탭개발계획서.md §9, 4단계)
 *
 *   #/s/<과목>/print/paper     문제지 (학교 시험지처럼 2단)
 *   #/s/<과목>/print/answers   정답 및 해설
 *   #/s/<과목>/print/omr       답안 표시판
 *   #/s/<과목>/print/notes     오답 노트 (문제 → 새 쪽에 정답과 해설)
 *   #/s/<과목>/print/summary   요약본 (?doc=<문서 번호> 하나만, 없으면 읽을 문서 전부)
 *
 * 화면에는 종이 모양으로 미리 보여 주고, 「인쇄」를 누르면 브라우저의 인쇄 창을 연다(PDF 로 저장도 거기서).
 * 인쇄할 때는 위쪽 막대와 단추가 사라지고 종이만 남는다 (styles.css 의 @media print).
 */

import { el, CIRCLED, versioned } from './dom.js?v=20261124-1913';
import { renderMarkdown } from './markdown.js?v=20261124-1913';
import { loadPaper } from './study.js?v=20261124-1913';
import { ERROR_LABEL } from './grade.mjs?v=20261124-1913';

const KINDS = { paper: '문제지', answers: '정답 및 해설', omr: '답안 표시판', notes: '오답 노트', summary: '요약본' };

/** 인쇄용 마크다운 조각. 답 쓰는 밑줄은 따로 그리므로 지운다. */
function md(text, cls = 'md') {
  const box = el(`div.${cls}`);
  renderMarkdown(String(text || '').replace(/_{6,}/g, ''), box, { breaks: true });
  return box;
}

const pts = (n) => `${Math.round(n * 10) / 10}점`;
const circled = (list) => (list || []).map((n) => CIRCLED[n - 1] || n).join(', ');
const qLabel = (q) => (q.type === 'essay' ? `서술형 ${q.no}` : `${q.no}`);

/** 이름·날짜·점수를 적는 머리 */
function sheetHead(exam, subject, kind, note) {
  return el('header.sheet-head', {},
    el('div.sheet-title', {}, el('small', { text: exam.title }), el('h1', {}, subject.subject, el('span', { text: ` ${kind}` }))),
    note ? el('p.sheet-note', { text: note }) : null,
    el('div.sheet-fields', {}, ['학년 · 반 · 번호', '이름', '날짜', '점수'].map((label) => el('div', {}, el('span', { text: label }), el('i'))))
  );
}

/** 문제 하나 (문제지·오답 노트 공용) */
function printQuestion(q, extra) {
  const node = el(`article.p-q${q.type === 'essay' ? '.essay' : ''}`, {},
    el('div.p-stem', {}, el('b.p-no', { text: `${qLabel(q)}.` }), md(q.stem, 'md p-text'), el('span.p-points', { text: `[${pts(q.points)}]` }))
  );
  if (q.type === 'choice') {
    // 표로 적힌 선지는 지문의 표에 이미 있다
    if (!q.choiceTable) node.append(el('ol.p-choices', {}, q.choices.map((c, i) => el('li', {}, el('span', { text: CIRCLED[i] }), md(c, 'md p-text')))));
  } else {
    node.append(el('div.p-lines', { 'aria-hidden': 'true' }, Array.from({ length: 5 }, () => el('i'))));
  }
  if (extra) node.append(extra);
  return node;
}

/** 문제들을 지문과 함께 차례로 늘어놓는다 */
function questionFlow(questions, groups, extraOf) {
  const flow = [];
  let shown = null;
  for (const q of questions) {
    const group = groups.get(q.group);
    if (group && group.id !== shown) {
      shown = group.id;
      flow.push(group.context ? el('section.p-context', {}, el('h3', { text: group.title }), md(group.context)) : el('h3.p-group', { text: group.title }));
    }
    flow.push(printQuestion(q, extraOf?.(q)));
  }
  return flow;
}

function paperSheet(exam, subject, paper) {
  const comp = subject.papers?.[0]?.composition;
  const minutes = subject.papers?.[0]?.minutes;
  const note = comp ? `선택형 ${comp.choice.count}문항(${comp.choice.points}점) · 서술형 ${comp.essay.count}문항(${comp.essay.points}점) · 총 ${comp.total}점${minutes ? ` · ${minutes}분` : ''}` : '';
  return el('div.sheet', {}, sheetHead(exam, subject, '예상 문제지', note), el('div.cols', {}, questionFlow(paper.questions, paper.groups)));
}

/** 정답과 해설. 문제를 고르면(오답 노트) 그 문제만. */
function answerBlocks(questions) {
  const choice = questions.filter((q) => q.type === 'choice');
  const blocks = [];
  if (choice.length) {
    blocks.push(
      el('div.quick', {}, choice.map((q) => el('div', {}, el('span', { text: String(q.no) }), el('b', { text: circled(q.answer) }))))
    );
  }
  blocks.push(
    el('div.cols', {},
      questions.map((q) =>
        el('article.p-a', {},
          el('div.p-a-head', {}, el('b', { text: q.type === 'essay' ? `서술형 ${q.no}` : `${q.no}번` }), q.type === 'choice' ? el('span.p-answer', { text: `답) ${circled(q.answer)}` }) : el('span.p-points', { text: `[${pts(q.points)}]` })),
          md(q.type === 'essay' ? q.modelAnswer : q.explanation, 'md p-text')
        )
      )
    )
  );
  return blocks;
}

function answersSheet(exam, subject, paper) {
  return el('div.sheet', {}, sheetHead(exam, subject, '정답 및 해설'), answerBlocks(paper.questions));
}

function omrSheet(exam, subject, paper) {
  const choice = paper.questions.filter((q) => q.type === 'choice');
  const essay = paper.questions.filter((q) => q.type === 'essay');
  const max = Math.max(5, ...choice.map((q) => q.choices.length));
  return el('div.sheet', {},
    sheetHead(exam, subject, '답안 표시판', '고른 번호를 까맣게 칠하세요.'),
    el('div.omr-grid', {},
      choice.map((q) => el('div.omr-row', {}, el('b', { text: String(q.no) }), Array.from({ length: max }, (_, i) => el('i', { text: CIRCLED[i] }))))
    ),
    essay.map((q) => el('div.omr-essay', {}, el('b', { text: `서술형 ${q.no}  [${pts(q.points)}]` }), el('div.p-lines', {}, Array.from({ length: 6 }, () => el('i')))))
  );
}

function notesSheet(exam, subject, paper, info, all, learner) {
  const notes = info.notes.filter((n) => all || n.status !== 'graduated');
  const picked = notes.map((n) => n.question).sort((a, b) => (a.type === b.type ? a.no - b.no : a.type === 'choice' ? -1 : 1));
  if (!picked.length) {
    return el('div.sheet', {}, sheetHead(exam, subject, '오답 노트'), el('p.sheet-empty', { text: info.notes.length ? '다시 풀 문제가 없습니다. 틀렸던 문제를 모두 졸업했습니다.' : '아직 틀린 문제가 없습니다.' }));
  }
  const byId = new Map(notes.map((n) => [n.question.id, n]));
  const extra = (q) => {
    const n = byId.get(q.id);
    const days = n.history.filter((h) => !h.correct).map((h) => h.day.slice(5).replace('-', '/'));
    return el('p.p-memo', { text: `틀린 날 ${[...new Set(days)].join(', ')}${n.errorType ? ` · ${ERROR_LABEL[n.errorType]}` : ''} · 다시 푼 답 (      )` });
  };
  return el('div.sheet', {},
    sheetHead(exam, subject, '오답 노트', `${learner} · 다시 풀 문제 ${picked.length}개 — 답을 가리고 먼저 풀어 본 뒤 뒤쪽의 정답과 맞춰 보세요.`),
    el('div.cols', {}, questionFlow(picked, paper.groups, extra)),
    el('section.page-break', {}, el('h2.sheet-sub', { text: '정답과 해설' }), answerBlocks(picked))
  );
}

async function summarySheet(exam, subject, docIndex) {
  const docs = subject.docs || [];
  const picked = Number.isInteger(docIndex) && docs[docIndex] ? [docs[docIndex]] : docs.filter((d) => d.role === 'summary' || d.role === 'unit');
  const sheet = el('div.sheet.summary');
  const waits = [];
  for (const [i, doc] of picked.entries()) {
    const folder = doc.file.slice(0, doc.file.lastIndexOf('/'));
    const res = await fetch(versioned(`exam/${doc.file.normalize('NFC').split('/').map(encodeURIComponent).join('/')}`));
    const part = el(`article.doc${i ? '.page-break' : ''}`);
    if (res.ok) waits.push(renderMarkdown(await res.text(), part, { imageBase: `exam/${folder.normalize('NFC').split('/').map(encodeURIComponent).join('/')}/` }).ready);
    else part.append(el('p.sheet-empty', { text: `문서를 불러오지 못했습니다: ${doc.title}` }));
    sheet.append(part);
  }
  // 인쇄에서는 화면에 보일 때까지 기다리지 않고 그림을 모두 불러온다
  sheet.querySelectorAll('img').forEach((img) => {
    img.loading = 'eager';
    img.removeAttribute('role');
    img.removeAttribute('tabindex');
  });
  return { sheet, waits };
}

/** 그림이 모두 불러와질 때까지 (실패한 그림도 끝난 것으로 친다) */
function imagesSettled(root) {
  return Promise.all(
    [...root.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    })))
  );
}

export async function renderPrint(ctx, exam, subject, kind, query, loadStudyFor) {
  if (!KINDS[kind]) return ctx.renderMissing('그런 인쇄물은 없습니다.');
  document.title = `${subject.subject} ${KINDS[kind]} — ${exam.title}`;
  ctx.setNav(subject.code);

  const paper = await loadPaper(ctx, subject);
  const all = query.get('all') === '1';
  const docIndex = query.has('doc') ? Number(query.get('doc')) : null;
  let sheet;
  let waits = [];
  if (kind === 'paper') sheet = paperSheet(exam, subject, paper);
  else if (kind === 'answers') sheet = answersSheet(exam, subject, paper);
  else if (kind === 'omr') sheet = omrSheet(exam, subject, paper);
  else if (kind === 'notes') {
    const study = await loadStudyFor();
    sheet = notesSheet(exam, subject, paper, study.bySubject.get(subject.code), all, study.learner);
  }
  else ({ sheet, waits } = await summarySheet(exam, subject, docIndex));

  const mono = query.get('mono') === '1';
  const noImages = query.get('img') === '0';
  sheet.classList.toggle('mono', mono);
  sheet.classList.toggle('no-img', noImages);

  // 선택 사항은 주소에 담는다 — 새로 고쳐도, 주소를 복사해도 같은 모양
  const link = (changes) => {
    const next = new URLSearchParams(query);
    for (const [k, v] of Object.entries(changes)) {
      if (v == null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return `#/s/${subject.code}/print/${kind}${qs ? `?${qs}` : ''}`;
  };
  const toggle = (label, on, changes) => el('a.print-toggle', { href: link(changes), 'aria-pressed': String(on), text: label });

  const button = el('button.pill', { type: 'button', text: '준비 중…', disabled: true, onclick: () => window.print() });
  const bar = el('div.reader-bar.print-bar', {},
    el('div.wrap', {},
      el('a.back', { href: `#/s/${subject.code}`, text: subject.subject }),
      el('div.title', { text: KINDS[kind] }),
      el('div.print-kinds', {}, Object.entries(KINDS).map(([k, label]) => el('a', { href: `#/s/${subject.code}/print/${k}`, text: label, 'aria-current': k === kind ? 'page' : null }))),
      button
    ),
    el('div.wrap.print-options', {},
      toggle('흑백으로', mono, { mono: mono ? null : '1' }),
      kind === 'summary' ? toggle('그림 빼고', noImages, { img: noImages ? null : '0' }) : null,
      kind === 'notes' ? toggle('졸업한 문제도', all, { all: all ? null : '1' }) : null,
      el('span.hint', { text: '인쇄 창에서 「PDF 로 저장」을 고르면 파일로 남습니다. 에디터 안에서 인쇄 창이 안 뜨면 브라우저에서 열어 주세요.' })
    )
  );

  ctx.show(bar, el('div.print-stage', {}, sheet));
  await Promise.all([...waits, imagesSettled(sheet)]);
  button.disabled = false;
  button.textContent = '인쇄';
  document.documentElement.dataset.printReady = '1';
  ctx.onLeave(() => delete document.documentElement.dataset.printReady);
}

/** 과목 화면에 넣는 인쇄 바로가기 */
export function printLinks(subject) {
  return el('div.chips', {}, Object.entries(KINDS).map(([k, label]) => el('a.chip', { href: `#/s/${subject.code}/print/${k}`, text: label })));
}
