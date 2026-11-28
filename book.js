/*
 * 시험 준비 웹앱 — 과목 책 (종이로 뽑아 보는 A4 문제책 · 해설책)
 *
 *   #/s/<과목>/book/q   문제책   PART 1 공부하기(단원 정리 + 확인 문제 + 마무리 평가)
 *                               PART 2 실전 연습(단원평가 1~5) · PART 3 예상 문제 · PART 4 기출문제(최근 2회) · PART 5 서브노트(요점 정리)
 *   #/s/<과목>/book/a   해설책   PART 1~3 의 정답과 해설 (기출은 학교 정답지로)
 *
 * 쪽 나눔은 브라우저 인쇄에 맡긴다(부마다 새 쪽, 문제는 2단). 쪽 번호는 @page 바닥글.
 * 영상·버튼처럼 종이에서 못 쓰는 것은 빼고, 영상 자리에는 「웹앱에서 보기」 한 줄만 남긴다.
 * 헤드리스 크롬으로 PDF 를 뽑을 때는 html[data-print-ready="1"] 이 붙은 뒤를 쓴다 (tools/make-books.sh).
 */

import { el, CIRCLED, versioned } from './dom.js?v=20261128-1042';
import { renderMarkdown } from './markdown.js?v=20261128-1042';
import { loadPaper } from './study.js?v=20261128-1042';
import { md, printQuestion, answerBlocks, subnoteSummary, imagesSettled } from './print.js?v=20261128-1042';
import { passageBlock } from './solve.js?v=20261128-1042';

const PAST_COUNT = 2;
const encPath = (p) => p.normalize('NFC').split('/').map(encodeURIComponent).join('/');
const json = (ctx, path, empty) => ctx.getJson(path).catch(() => empty);
const circled = (list) => (list || []).map((n) => CIRCLED[n - 1] || n).join(', ');

/* ── 공통 조각 ─────────────────────────── */

function partHead(no, title, note) {
  return el('header.bk-part', {},
    el('span.bk-part-no', { text: `PART ${no}` }),
    el('h1', { text: title }),
    note ? el('p', { text: note }) : null
  );
}

function sectionHead(title, note) {
  return el('header.bk-sec', {}, el('h2', { text: title }), note ? el('p', { text: note }) : null);
}

/** 문서 하나를 종이용으로 그린다 (영상 → 한 줄 안내, 체크 상자 비움) */
async function docNode(doc) {
  const box = el('article.doc.bk-doc');
  const res = await fetch(versioned(`exam/${encPath(doc.file)}`));
  if (!res.ok) {
    box.append(el('p.sheet-empty', { text: `문서를 불러오지 못했습니다: ${doc.title}` }));
    return { node: box, wait: null };
  }
  const folder = doc.file.slice(0, doc.file.lastIndexOf('/'));
  const { ready } = renderMarkdown(await res.text(), box, { imageBase: `exam/${encPath(folder)}/` });
  const tidy = () => {
    box.querySelectorAll('video, audio, iframe').forEach((v) => v.replaceWith(el('p.bk-video', { text: '🎬 이 자리의 영상은 웹앱에서 볼 수 있습니다.' })));
    box.querySelectorAll('button').forEach((b) => b.remove());
    box.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.checked = false; });
    box.querySelectorAll('img').forEach((img) => {
      img.loading = 'eager';
      img.removeAttribute('role');
      img.removeAttribute('tabindex');
    });
  };
  tidy();
  return { node: box, wait: Promise.resolve(ready).then(tidy) };
}

/* ── 확인 문제 (drill) ─────────────────── */

const BLANK_RE = /\[\[(.+?)\]\]/g;

function drillQuestion(item, n) {
  let text = item.q;
  if (item.k === 'blank') text = text.replace(BLANK_RE, (_, a) => `(${' '.repeat(Math.max(6, Math.min(24, a.length * 2)))})`);
  return el('li.bk-drill', {},
    el('b.bk-drill-no', { text: `${n}.` }),
    md(text, 'md p-text'),
    item.k === 'ox' ? el('span.bk-ox', { text: '( O / X )' }) : null,
    item.k === 'qa' ? el('div.p-lines.short', { 'aria-hidden': 'true' }, el('i'), el('i')) : null
  );
}

function drillAnswer(item, n) {
  const body = item.k === 'blank'
    ? (item.q.match(BLANK_RE) || []).map((m) => m.slice(2, -2)).join(' / ')
    : item.a || '';
  return el('li.bk-drill', {},
    el('b.bk-drill-no', { text: `${n}.` }),
    md(`**${body}**${item.why ? `  \n${item.why}` : ''}`, 'md p-text')
  );
}

function drillBlock(sets, answers) {
  const items = sets.flatMap((s) => s.items || []);
  if (!items.length) return null;
  return el('section.bk-block', {},
    sectionHead(answers ? '확인 문제 정답' : '확인 문제', answers ? null : `빈칸 채우기 · O/X · 짧은 답 — ${items.length}문제`),
    el('ol.bk-drills.cols', {}, items.map((it, i) => (answers ? drillAnswer : drillQuestion)(it, i + 1)))
  );
}

/* ── 마무리 평가 (docquiz) → 문제지 모양으로 ── */

function quizQuestions(quiz) {
  let c = 0;
  let e = 0;
  return (quiz?.questions || []).map((q) => ({
    ...q,
    no: q.type === 'choice' ? ++c : ++e,
    points: null,
    answer: q.type === 'choice' && q.answer != null ? [].concat(q.answer) : [],
    modelAnswer: q.modelAnswer || q.model || '',
  }));
}

/** 문제 늘어놓기 — 묶음 지문(groups) · 소제목(section) · 관련 본문(passageRef)을 같은 지문 문제 앞에 한 번만 펼친다 */
function bookFlow(questions, groups = new Map()) {
  const flow = [];
  let group = null;
  let section = null;
  let passage = null;
  for (const q of questions) {
    if (q.section && q.section !== section && q.type === 'choice') {
      section = q.section;
      flow.push(el('h3.p-group', { text: q.section }));
    }
    const g = groups.get(q.group);
    if (g && g.id !== group) {
      group = g.id;
      flow.push(g.context ? el('section.p-context', {}, el('h3', { text: g.title }), md(g.context)) : el('h3.p-group', { text: g.title }));
    }
    const key = q.passageRef ? JSON.stringify(q.passageRef) : null;
    if (key && key !== passage) {
      const box = passageBlock(q, true);
      if (box) flow.push(el('section.p-context.bk-passage', {}, box));
    }
    passage = key;
    flow.push(printQuestion(q));
  }
  return flow;
}

/* ── 부별 내용 ─────────────────────────── */

async function studyPart(ctx, subject, answers) {
  const [drill, quiz] = await Promise.all([
    json(ctx, `data/drill/${subject.code}.json`, { docs: {} }),
    json(ctx, `data/docquiz/${subject.code}.json`, { docs: {} }),
  ]);
  const docs = (subject.docs || []).filter((d) => d.role === 'unit');
  const waits = [];
  const chapters = [];
  for (const d of docs) {
    const file = d.file.normalize('NFC');
    const qs = quizQuestions(quiz.docs?.[file]);
    const chapter = el('section.bk-chapter', {}, answers ? el('h2.bk-chapter-title', { text: d.title }) : null); // 문제책은 문서 첫 제목이 곧 단원 제목
    if (!answers) {
      const { node, wait } = await docNode(d);
      chapter.append(node);
      if (wait) waits.push(wait);
    }
    const dr = drillBlock(drill.docs?.[file] || [], answers);
    if (dr) chapter.append(dr);
    if (qs.length) {
      chapter.append(el('section.bk-block', {},
        sectionHead(answers ? '마무리 평가 정답과 해설' : '마무리 평가', answers ? null : `선택형 ${qs.filter((q) => q.type === 'choice').length}문항 · 서술형 ${qs.filter((q) => q.type === 'essay').length}문항`),
        answers ? answerBlocks(qs) : el('div.cols', {}, bookFlow(qs))
      ));
    }
    chapters.push(chapter);
  }
  if (!chapters.length) return null;
  return { node: el('section.bk-part-wrap', {}, partHead(1, answers ? '공부하기 — 정답' : '공부하기', answers ? null : '단원 정리를 읽고 → 확인 문제 → 마무리 평가'), chapters), waits };
}

async function mockPart(ctx, subject, answers) {
  const data = await json(ctx, `data/units/${subject.code}.json`, { units: [] });
  const mocks = (data.units || []).filter((u) => u.series === 'mock');
  if (!mocks.length) return null;
  const sets = mocks.map((u) => {
    const qs = u.questions || [];
    const groups = new Map((u.groups || []).map((g) => [g.id, g]));
    return el('section.bk-chapter', {},
      el('h2.bk-chapter-title', { text: `${u.short || u.title}${answers ? ' 정답과 해설' : ''}` }),
      answers ? null : el('p.bk-meta', { text: `${qs.length}문항${u.minutes ? ` · ${u.minutes}분` : ''} · 시험과 같은 문항 수·출제 유형` }),
      answers ? answerBlocks(qs) : el('div.cols', {}, bookFlow(qs, groups))
    );
  });
  return { node: el('section.bk-part-wrap', {}, partHead(2, answers ? '실전 연습 — 정답' : '실전 연습', answers ? null : '단원평가 1~5 · 시간을 재고 실제 시험처럼'), sets), waits: [] };
}

async function paperPart(ctx, subject, answers) {
  const paper = await loadPaper(ctx, subject).catch(() => null);
  if (!paper?.questions?.length) return null;
  const comp = subject.papers?.[0]?.composition;
  return {
    node: el('section.bk-part-wrap', {},
      partHead(3, answers ? '예상 문제 — 정답' : '예상 문제', !answers && comp ? `선택형 ${comp.choice.count}문항 · 서술형 ${comp.essay.count}문항 · 총 ${comp.total}점` : null),
      el('section.bk-chapter.first', {}, answers ? answerBlocks(paper.questions) : el('div.cols', {}, bookFlow(paper.questions, paper.groups)))
    ),
    waits: [],
  };
}

async function pastPart(ctx, subject) {
  const past = await json(ctx, 'data/past.json', { exams: [] });
  const picked = (past.exams || [])
    .map((x) => ({ x, part: (x.parts || []).find((p) => p.code === subject.code) }))
    .filter((r) => r.part)
    .sort((a, b) => String(b.x.month).localeCompare(String(a.x.month)))
    .slice(0, PAST_COUNT);
  if (!picked.length) return null;
  const pages = picked.map(({ x, part }) =>
    el('section.bk-chapter', {},
      el('h2.bk-chapter-title', { text: `${x.title}${x.note ? ` (${x.note})` : ''}` }),
      Array.from({ length: part.to - part.from + 1 }, (_, i) => {
        const n = part.from + i;
        return el('figure.bk-past', {}, el('img', { src: `assets/past/${x.id}/p${String(n).padStart(2, '0')}.webp`, alt: `${subject.subject} ${i + 1}쪽`, loading: 'eager' }));
      })
    )
  );
  return { node: el('section.bk-part-wrap', {}, partHead(4, '기출문제', `학교 정기고사 최근 ${picked.length}회 · 정답은 학교 배포 정답지로 확인`), pages), waits: [] };
}

async function subnotePart(subject) {
  const { node, waits } = await subnoteSummary(subject);
  node.querySelectorAll('video, audio, iframe').forEach((v) => v.remove());
  node.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
  return { node: el('section.bk-part-wrap', {}, partHead(5, '서브노트', '시험 직전에 보는 요점 정리'), el('div.sheet.summary.subnote.bk-subnote', {}, node)), waits };
}

/* ── 화면 ─────────────────────────── */

export async function renderBook(ctx, exam, subject, which) {
  const answers = which === 'a';
  const label = answers ? '해설책' : '문제책';
  document.title = `${subject.subject} ${label} — ${exam.title}`;
  ctx.setNav(subject.code);
  delete document.documentElement.dataset.printReady;

  const parts = (await Promise.all(answers
    ? [studyPart(ctx, subject, true), mockPart(ctx, subject, true), paperPart(ctx, subject, true)]
    : [studyPart(ctx, subject, false), mockPart(ctx, subject, false), paperPart(ctx, subject, false), pastPart(ctx, subject), subnotePart(subject)]
  )).filter(Boolean);

  const toc = parts.map((p) => p.node.querySelector('.bk-part h1')?.textContent).filter(Boolean);
  const cover = el('section.bk-cover', {},
    el('p.bk-kicker', { text: exam.title }),
    el('h1', { text: subject.subject }),
    el('p.bk-kind', { text: label }),
    el('ol.bk-toc', {}, toc.map((t) => el('li', { text: t }))),
    el('div.bk-name', {}, el('span', { text: '이름' }), el('i'))
  );
  const book = el(`div.sheet.bk-book${answers ? '.bk-answers' : ''}`, {}, cover, parts.map((p) => p.node));

  const button = el('button.pill', { type: 'button', text: '준비 중…', disabled: true, onclick: () => window.print() });
  const bar = el('div.reader-bar.print-bar', {},
    el('div.wrap', {},
      el('a.back', { href: `#/s/${subject.code}`, text: subject.subject }),
      el('div.title', { text: `${label} (A4)` }),
      el('div.print-kinds', {},
        el('a', { href: `#/s/${subject.code}/book/q`, text: '문제책', 'aria-current': answers ? null : 'page' }),
        el('a', { href: `#/s/${subject.code}/book/a`, text: '해설책', 'aria-current': answers ? 'page' : null })
      ),
      button
    ),
    el('div.wrap.print-options', {}, el('span.hint', { text: '인쇄 창에서 용지 A4 · 「PDF로 저장」을 고르면 파일로 남습니다. 쪽수가 많으니 미리 보기로 확인한 뒤 뽑으세요.' }))
  );

  ctx.show(bar, el('div.print-stage', {}, book));
  await Promise.all([...parts.flatMap((p) => p.waits || []), new Promise((r) => setTimeout(r, 300))]);
  await imagesSettled(book);
  // 지문(passageBlock)은 늦게 채워진다 — 「불러오는 중」이 사라질 때까지 (최대 15초)
  for (let i = 0; i < 60 && book.querySelector('.q-passage > p.meta'); i++) await new Promise((r) => setTimeout(r, 250));
  await imagesSettled(book);
  book.querySelectorAll('details.q-passage').forEach((d) => { d.open = true; });
  button.disabled = false;
  button.textContent = '인쇄';
  document.documentElement.dataset.printReady = '1';
  ctx.onLeave(() => delete document.documentElement.dataset.printReady);
}
