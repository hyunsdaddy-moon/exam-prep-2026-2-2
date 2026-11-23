/*
 * 시험 준비 웹앱 — 홈 · 과목 · 읽기 (docs/시험준비탭개발계획서.md 1단계)
 *
 * 데이터는 읽기만 한다:
 *   /data/exam.json, /data/concepts.json   가져오기(import.mjs)가 만든 것
 *   /exam/<과목>_시험공부/<문서>.md          요약·문제지 원문 (마크다운이 원본이다)
 * 화면 주소는 #/ , #/s/<과목 코드> , #/s/<과목 코드>/<문서 번호> 셋이다.
 */

import { renderMarkdown, headingKey } from './markdown.js';
import { el } from './dom.js';
import { renderSolveRoute, renderHistory } from './solve.js';
import { loadStudy } from './study.js';
import { renderPrint, printLinks } from './print.js';
import { ring, conceptLegend, renderNotes } from './notes.js';
import { saveRecords } from './store.js';
import { dday, CONCEPT_LABEL } from './progress.mjs';

const app = document.getElementById('app');
const navLinks = document.getElementById('nav-links');
const footText = document.getElementById('foot-text');

const ROLE_LABEL = { summary: '핵심 요약', unit: '단원 정리', exam: '예상 문제지', answers: '정답 및 해설' };

const data = { exam: null, concepts: [] };

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const docsOf = (s) => s.docs || [];
const readingDocs = (s) => docsOf(s).filter((d) => d.role === 'summary' || d.role === 'unit');
const countDocs = (subjects) => subjects.reduce((a, s) => a + docsOf(s).length, 0);
const paperOf = (s) => (s.papers && s.papers[0]) || null;
const questionCount = (s) => {
  const c = paperOf(s)?.composition;
  return c ? c.choice.count + c.essay.count : 0;
};
const conceptsOf = (s) => data.concepts.filter((c) => c.subject === s.subject);

function unitsOf(s) {
  const seen = [];
  for (const c of conceptsOf(s)) if (!seen.includes(c.unit)) seen.push(c.unit);
  return seen;
}

/** "[지리] 3단원 유럽 · 4.1 아프리카" 처럼 긴 단원 이름을 카드에 맞게 줄인다 */
const shortUnit = (u) => u.replace(/\s+—\s+.*$/, '').replace(/\s*·\s*필수 어휘.*$/, '');

function setNav(code) {
  navLinks.replaceChildren(
    ...data.exam.subjects.map((s) => el('a', { href: `#/s/${s.code}`, text: s.subject, 'aria-current': s.code === code ? 'page' : null }))
  );
}

function show(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function stat(value, label) {
  return el('li', {}, el('b', { text: String(value) }), label);
}

/* ── 홈 ─────────────────────────────────────────── */

/** 과목마다 지금 가장 먼저 할 일 하나 */
function nextStep(info) {
  const s = info.subject;
  if (info.due.length) return { href: `#/s/${s.code}/review`, kind: '복습', text: `틀린 문제 ${info.due.length}개 다시 풀기` };
  const docs = docsOf(s);
  const unread = info.concepts.find((c, i) => !info.states[i].read);
  if (unread) return { href: `#/s/${s.code}/${Math.max(docs.findIndex((d) => d.file === unread.doc), 0)}?h=${encodeURIComponent(unread.heading)}`, kind: '읽기', text: unread.title };
  if (info.triedQuestions < info.questions.length) return { href: `#/s/${s.code}/practice`, kind: '풀기', text: `연습 문제 풀기 (${info.triedQuestions} / ${info.questions.length} 풂)` };
  if (info.waiting) return { href: `#/s/${s.code}/notes`, kind: '기다림', text: `다른 날 다시 풀 문제 ${info.waiting}개` };
  return null;
}

/** 시험일 고르기 — 고르면 기록에 덧붙이고 화면을 다시 그린다 */
function examDatePicker(study) {
  const input = el('input.date-input', { type: 'date', value: study.examDate || '', 'aria-label': '시험일' });
  input.addEventListener('change', async () => {
    await saveRecords([{ type: 'setting', key: 'examDate', value: input.value || null }]);
    void renderHome();
  });
  return el('label.date-pick', {}, study.examDate ? '시험일 ' : '시험일을 정하면 남은 날을 보여 줍니다 ', input);
}

async function renderHome() {
  const { subjects, title } = data.exam;
  document.title = `시험 준비 — ${title}`;
  setNav(null);
  const study = await loadStudy(ctx, subjects, data.concepts);
  const infos = subjects.map((s) => study.bySubject.get(s.code));
  const total = subjects.reduce((a, s) => a + questionCount(s), 0);
  const left = dday(study.examDate, study.today);
  const allConcepts = infos.flatMap((i) => i.concepts.map((c, k) => ({ w: c.importance || 1, score: i.states[k].score })));
  const weight = allConcepts.reduce((a, c) => a + c.w, 0);
  const overall = weight ? Math.round((allConcepts.reduce((a, c) => a + c.score * c.w, 0) / weight) * 100) : 0;
  const steps = infos.map((i) => ({ info: i, step: nextStep(i) })).filter((x) => x.step);
  const dueTotal = infos.reduce((a, i) => a + i.due.length, 0);

  show(
    el('section.hero', {},
      el('p.eyebrow', { text: left ? `시험까지 ${left.label}` : '시험 준비' }),
      el('h1', { text: title }),
      el('p.sub', { text: `전체 진도율 ${overall}% · ${subjects.length}과목 · 문서 ${countDocs(subjects)}개 · 문제 ${total}개` }),
      examDatePicker(study),
      !study.ok ? el('p.save-warn', { text: '풀이 기록을 읽지 못해 진도율이 비어 보일 수 있습니다.' }) : null
    ),
    steps.length
      ? el('div.wrap', {},
          el('section.section.today', { style: 'padding-top:0' },
            el('div.section-head', {}, el('h2', { text: '오늘 할 일' }), el('p', { text: dueTotal ? `복습할 문제가 ${dueTotal}개 있습니다. 복습부터 하세요.` : '과목마다 지금 할 일을 하나씩 골랐습니다.' })),
            el('div.result-list', {},
              steps.sort((a, b) => b.info.due.length - a.info.due.length).map(({ info, step }) =>
                el('a.history-row', { href: step.href },
                  el(`span.badge${step.kind === '복습' ? '.due' : ''}`, { text: step.kind }),
                  el('span.todo-subject', { text: info.subject.subject }),
                  el('span.todo-text', { text: step.text })
                )
              )
            )
          )
        )
      : null,
    el('section.band', {},
      el('div.wrap', {},
        el('div.grid', {},
          infos.map((info) => {
            const s = info.subject;
            return el('a.card.subject-card.rise', { href: `#/s/${s.code}` },
              el('div.subject-top', {},
                el('div', {}, el('h3', { text: s.subject }), el('p.units', { text: unitsOf(s).map(shortUnit).join(' · ') || '단원 정보 없음' })),
                ring(info.progress, info.mastery, 84)
              ),
              el('ul.stats', {},
                stat(`${info.counts.mastered} / ${info.concepts.length}`, '익힌 개념'),
                stat(`${info.triedQuestions} / ${info.questions.length}`, '푼 문제'),
                stat(info.mastery == null ? '–' : `${info.mastery}%`, '숙련도'),
                stat(info.due.length, '오늘 복습')
              ),
              el('span.more', { text: '공부하기' })
            );
          })
        )
      )
    )
  );
}

/* ── 과목 ─────────────────────────────────────────── */
async function renderSubject(s) {
  document.title = `${s.subject} — 시험 준비`;
  setNav(s.code);
  const study = await loadStudy(ctx, data.exam.subjects, data.concepts);
  const info = study.bySubject.get(s.code);
  const stateOf = new Map(info.states.map((st) => [st.id, st]));
  const paper = paperOf(s);
  const comp = paper?.composition;
  const docs = docsOf(s);
  const docCard = (d) =>
    el('a.card.doc-card.rise', { href: `#/s/${s.code}/${docs.indexOf(d)}` },
      el('div.role', { text: ROLE_LABEL[d.role] || d.role }),
      el('h3', { text: d.title }),
      el('div.meta', { text: d.images ? `그림 ${d.images}장` : '글' })
    );

  const byUnit = new Map();
  for (const c of conceptsOf(s)) {
    if (!byUnit.has(c.unit)) byUnit.set(c.unit, []);
    byUnit.get(c.unit).push(c);
  }
  const docIndexByFile = new Map(docs.map((d, i) => [d.file, i]));

  const problems = el('section.section', {},
    el('div.section-head', {}, el('h2', { text: '문제' }), el('p', { text: '연습은 한 문제씩 바로 채점하고, 실전은 시간을 재며 한 번에 채점합니다.' })),
    comp
      ? el('div.grid', {},
          el('div.card.solve-card', {},
            el('div.role', { text: `예상 문제 ${paper.round || 2}차` }),
            el('h3', { text: `${comp.choice.count + comp.essay.count}문항 · ${comp.total}점` }),
            el('div.meta', { text: `선택형 ${comp.choice.count} · 서술형 ${comp.essay.count}${paper.minutes ? ` · ${paper.minutes}분` : ''}` }),
            el('div.hero-actions.left', {},
              el('a.pill', { href: `#/s/${s.code}/practice`, text: '연습으로 풀기' }),
              el('a.pill.ghost', { href: `#/s/${s.code}/exam`, text: '실전으로 풀기' })
            )
          ),
          el('div.card.solve-card', {},
            el('div.role', { text: '오답 노트' }),
            el('h3', { text: info.notes.length ? `오늘 복습 ${info.due.length}문제` : '틀린 문제 없음' }),
            el('div.meta', { text: info.notes.length ? `틀린 문제 ${info.notes.length}개 · 다른 날 한 번 더 ${info.waiting} · 졸업 ${info.graduated}` : '문제를 풀다 틀리면 여기에 모입니다.' }),
            el('div.hero-actions.left', {},
              info.due.length ? el('a.pill', { href: `#/s/${s.code}/review`, text: '복습 시작' }) : null,
              el(`a.pill${info.due.length ? '.ghost' : ''}`, { href: `#/s/${s.code}/notes`, text: '오답 노트 · 통계' })
            )
          ),
          docs.filter((d) => d.role === 'exam' || d.role === 'answers').map(docCard)
        )
      : el('p.note', { text: '가져온 문제가 없습니다.' })
  );

  show(
    el('section.hero', {},
      el('a.back', { href: '#/', text: '전체 과목' }),
      el('h1', { text: s.subject }),
      paper?.scope ? el('p.scope', { text: `시험 범위 — ${paper.scope.replace(/\*\*/g, '')}` }) : null
    ),
    el('div.wrap', {},
      el('section.section.progress-block', { style: 'padding-top:0' },
        ring(info.progress, info.mastery, 150),
        el('div.progress-text', {},
          el('h2', { text: `진도율 ${info.progress}%` }),
          el('p', { text: info.mastery == null ? '아직 푼 문제가 없습니다. 읽고 나서 연습 문제를 풀어 보세요.' : `숙련도 ${info.mastery}% (풀어 본 ${info.triedQuestions}문제 중 마지막에 맞힌 비율) · 안쪽 고리` }),
          el('ul.stats.plain', {},
            Object.entries(CONCEPT_LABEL).map(([key, label]) => stat(info.counts[key], label))
          ),
          info.weakest.length ? el('p.note', { text: `약한 개념: ${info.weakest.map((w) => `${w.concept.title} (${Math.round(w.accuracy * 100)}%)`).join(' · ')}` }) : null
        )
      ),

      comp
        ? el('section.section',  {},
            el('div.tiles', {},
              tile(comp.choice.count, '문항', `선택형 · ${comp.choice.points}점`),
              tile(comp.essay.count, '문항', `서술형 · ${comp.essay.points}점`),
              tile(comp.total, '점', '총점'),
              paper.minutes ? tile(paper.minutes, '분', '제한 시간') : null
            ),
            el('p.note', { text: '문항 구성은 예상 문제지(2차)를 기준으로 센 것입니다.' })
          )
        : null,

      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '읽기' }), el('p', { text: '핵심 요약부터 읽고 단원 정리로 넘어가세요.' })),
        el('div.grid', {}, readingDocs(s).map(docCard))
      ),

      byUnit.size
        ? el('section.section', {},
            el('div.section-head', {}, el('h2', { text: '개념' }), el('p', { text: '점이 많을수록 시험에 자주 나오는 개념입니다. 누르면 그 부분으로 갑니다.' }), conceptLegend()),
            [...byUnit].map(([unit, list]) =>
              el('div.unit', {},
                el('h3', { text: unit }),
                el('ul.chips', {},
                  list.map((c) =>
                    el('li', {},
                      el('a.chip', { href: `#/s/${s.code}/${docIndexByFile.get(c.doc) ?? 0}?h=${encodeURIComponent(c.heading)}` },
                        el(`i.state-dot.${stateOf.get(c.id)?.state || 'unseen'}`, { title: CONCEPT_LABEL[stateOf.get(c.id)?.state || 'unseen'] }),
                        c.title,
                        el('span.dots', { 'aria-label': `중요도 ${c.importance}` }, [1, 2, 3].map((n) => el(n <= c.importance ? 'i.on' : 'i')))
                      )
                    )
                  )
                )
              )
            )
          )
        : null,

      problems,
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '인쇄' }), el('p', { text: '종이로 풀거나 PDF 로 남길 수 있습니다. 문제지와 정답지는 따로 뽑힙니다.' })),
        printLinks(s)
      )
    )
  );
  void renderHistory(ctx, s, problems);
}

function tile(num, unit, label) {
  return el('div.tile', {}, el('div.num', {}, String(num), el('small', { text: unit })), el('div.label', { text: label }));
}

/* ── 읽기 ─────────────────────────────────────────── */
let spy = null;

async function renderReader(s, index, query) {
  const docs = docsOf(s);
  const doc = docs[index];
  if (!doc) return renderMissing('문서를 찾지 못했습니다.');
  document.title = `${doc.title} — ${s.subject}`;
  setNav(s.code);

  const folder = doc.file.slice(0, doc.file.lastIndexOf('/'));
  const url = `exam/${doc.file.normalize('NFC').split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return renderMissing(`문서를 불러오지 못했습니다 (${res.status}).`);
  const body = el('article.doc');
  const { headings } = renderMarkdown(await res.text(), body, {
    imageBase: `exam/${folder.normalize('NFC').split('/').map(encodeURIComponent).join('/')}/`,
    onImage: openLightbox,
  });

  const toc = el('nav.toc', { 'aria-label': '목차' },
    el('p', { text: '목차' }),
    headings.filter((h) => h.level === 2 || h.level === 3).map((h) => {
      // 제목의 모양(수식 포함)을 그대로 옮긴다
      const link = el(`a.l${h.level}`, { href: `#${h.id}`, onclick: (e) => jump(e, h.id) });
      link.append(...[...h.node.childNodes].map((n) => n.cloneNode(true)));
      return link;
    })
  );

  const prev = docs[index - 1];
  const next = docs[index + 1];
  const pager = el('div.pager', {},
    prev ? el('a.prev', { href: `#/s/${s.code}/${index - 1}` }, el('small', { text: '이전' }), prev.title) : null,
    next ? el('a.next', { href: `#/s/${s.code}/${index + 1}` }, el('small', { text: '다음' }), next.title) : null
  );
  body.append(pager);

  show(
    el('div.reader-bar', {},
      el('div.wrap', {},
        el('a.back', { href: `#/s/${s.code}`, text: s.subject }),
        el('div.title', { text: doc.title }),
        el('div.step', { text: `${ROLE_LABEL[doc.role] || ''} · ${index + 1} / ${docs.length}` })
      )
    ),
    el('div.wrap.reader', {}, toc, body)
  );

  // 개념 칩에서 왔으면 그 제목으로 간다
  const want = query.get('h');
  if (want) {
    const key = headingKey(want);
    const hit = headings.find((h) => h.key === key) || headings.find((h) => h.key.includes(key));
    if (hit) document.getElementById(hit.id)?.scrollIntoView();
  }
  watchHeadings(toc, headings);
  void trackReading(s, doc, headings, toc, pager);
}

/**
 * 개념 절을 처음부터 끝까지 읽으면 「읽음」으로 적는다.
 * 절의 제목이 화면에 들어온 적이 있고, 그 뒤 다음 절의 제목(마지막 절은 문서 끝)이 화면에 들어오면 읽은 것으로 본다.
 * 개념 칩으로 중간에 뛰어든 경우 그 앞의 절들은 제목을 본 적이 없으므로 읽음이 되지 않는다.
 */
async function trackReading(s, doc, headings, toc, endNode) {
  const mine = data.concepts.filter((c) => c.doc === doc.file);
  if (!mine.length) return;
  const study = await loadStudy(ctx, data.exam.subjects, data.concepts);
  const sections = [];
  for (const c of mine) {
    const key = headingKey(c.heading);
    const h = headings.find((x) => x.key === key);
    if (h) sections.push({ concept: c, start: h.node, link: toc.querySelector(`a[href="#${h.id}"]`), seen: false, read: study.merged.reads.has(c.id) });
  }
  sections.sort((a, b) => (a.start.compareDocumentPosition(b.start) & 4 ? -1 : 1));
  sections.forEach((sec, i) => {
    sec.end = sections[i + 1]?.start || endNode;
    if (sec.read) sec.link?.classList.add('done');
  });
  const check = () => {
    const bottom = window.innerHeight;
    for (const sec of sections) {
      if (sec.read) continue;
      const top = sec.start.getBoundingClientRect().top;
      if (top >= 0 && top < bottom) sec.seen = true;
      if (sec.seen && sec.end.getBoundingClientRect().top < bottom) {
        sec.read = true;
        sec.link?.classList.add('done');
        void saveRecords([{ type: 'read', concept: sec.concept.id, subject: s.code }]);
      }
    }
  };
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      check();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  ctx.onLeave(() => window.removeEventListener('scroll', onScroll));
  check();
}

function jump(e, id) {
  e.preventDefault(); // 주소의 # 은 화면 주소로 쓰므로 직접 옮긴다
  document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/** 지금 읽는 절을 목차에 표시한다 */
function watchHeadings(toc, headings) {
  spy?.disconnect();
  const links = new Map([...toc.querySelectorAll('a')].map((a) => [a.getAttribute('href').slice(1), a]));
  const targets = headings.map((h) => document.getElementById(h.id)).filter((n) => n && links.has(n.id));
  if (!targets.length || !('IntersectionObserver' in window)) return;
  const mark = (id) => {
    for (const [key, a] of links) a.classList.toggle('on', key === id);
  };
  spy = new IntersectionObserver(
    (entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (seen[0]) mark(seen[0].target.id);
    },
    { rootMargin: '-110px 0px -70% 0px' }
  );
  for (const t of targets) spy.observe(t);
}

/* ── 그림 크게 보기 ─────────────────────────────────────────── */
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCap = document.getElementById('lightbox-cap');
let lastFocus = null;

function openLightbox(src, alt) {
  lastFocus = document.activeElement;
  lightboxImg.src = src;
  lightboxImg.alt = alt || '';
  lightboxCap.textContent = alt || '';
  lightbox.hidden = false;
  document.getElementById('lightbox-close').focus();
}
function closeLightbox() {
  if (lightbox.hidden) return;
  lightbox.hidden = true;
  lightboxImg.removeAttribute('src');
  lastFocus?.focus?.();
}
lightbox.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

/* ── 길 찾기 ─────────────────────────────────────────── */
function renderMissing(message) {
  setNav(null);
  show(el('div.empty', {}, el('h1', { text: '찾을 수 없습니다' }), el('p', { text: message }), el('p', {}, el('a.pill', { href: '#/', text: '처음으로' }))));
}

/** 화면을 떠날 때 치울 것(타이머 등) */
let leaving = [];
const ctx = {
  show,
  setNav,
  getJson,
  renderMissing,
  onLeave: (fn) => leaving.push(fn),
};

async function route() {
  spy?.disconnect();
  closeLightbox();
  for (const fn of leaving.splice(0)) fn();
  const [pathPart, queryPart] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');
  if (!parts.length) return renderHome();
  if (parts[0] === 's') {
    const s = data.exam.subjects.find((x) => x.code === parts[1]);
    if (!s) return renderMissing('그런 과목이 없습니다.');
    if (parts.length === 2) return renderSubject(s);
    if (parts[2] === 'print' && parts.length === 4) return renderPrint(ctx, data.exam, s, parts[3], query, () => loadStudy(ctx, data.exam.subjects, data.concepts));
    if (parts[2] === 'notes' && parts.length === 3) return renderNotes(ctx, s, await loadStudy(ctx, data.exam.subjects, data.concepts));
    const solving = renderSolveRoute(ctx, s, parts.slice(2));
    if (solving) return solving;
    const index = Number(parts[2]);
    if (/^\d+$/.test(parts[2]) && parts.length === 3) return renderReader(s, index, query);
  }
  return renderMissing('주소가 올바르지 않습니다.');
}

async function start() {
  try {
    data.exam = await getJson('data/exam.json');
  } catch {
    app.replaceChildren(
      el('div.empty', {},
        el('h1', { text: '아직 가져온 자료가 없습니다' }),
        el('p', { text: 'MultyAM 의 「시험 준비」 탭에서 시험 폴더를 고르고 「자료 가져오기」를 눌러 주세요.' })
      )
    );
    return;
  }
  try {
    data.concepts = (await getJson('data/concepts.json')).concepts || [];
  } catch {
    data.concepts = []; // 개념 목록이 없어도 읽기는 된다
  }
  footText.textContent = `${data.exam.title} · 자료를 가져온 때 ${new Date(data.exam.importedAt).toLocaleString('ko-KR')}`;
  const go = () => route().catch(() => renderMissing('화면을 그리지 못했습니다. 자료를 다시 가져온 뒤 새로 고쳐 주세요.'));
  window.addEventListener('hashchange', () => void go());
  await go();
}

void start();
