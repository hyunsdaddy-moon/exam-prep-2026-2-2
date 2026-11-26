/*
 * 시험 준비 웹앱 — 홈 · 과목 · 읽기 (docs/시험준비탭개발계획서.md 1단계)
 *
 * 데이터는 읽기만 한다:
 *   /data/exam.json, /data/concepts.json   가져오기(import.mjs)가 만든 것
 *   /exam/<과목>_시험공부/<문서>.md          요약·문제지 원문 (마크다운이 원본이다)
 * 화면 주소는 #/ , #/s/<과목 코드> , #/s/<과목 코드>/<문서 번호> 셋이다.
 */

import { renderMarkdown, headingKey } from './markdown.js?v=20261126-0956';
import { el, versioned } from './dom.js?v=20261126-0956';
import { renderSolveRoute, renderHistory } from './solve.js?v=20261126-0956';
import { renderUnitsRoute } from './units.js?v=20261126-0956';
import { buildDocQuiz } from './docquiz.js?v=20261126-0956';
import { attachDrills } from './drill.js?v=20261126-0956';
import { attachWatchBoxes } from './watch.js?v=20261126-0956';
import { renderDashboard } from './dashboard.js?v=20261126-0956';
import { renderGrades } from './grades.js?v=20261126-0956';
import { renderVersus, renderVersusBar } from './versus.js?v=20261126-0956';
import { renderAssessRoute } from './assess.js?v=20261126-0956';
import { renderPastRoute } from './past.js?v=20261126-0956';
import { renderWrongbook } from './wrongbook.js?v=20261126-0956';
import { renderBoard } from './board.js?v=20261126-0956';
import { renderCharacterSelect, refreshProfiles, avatar } from './characters.js?v=20261126-0956';
import { loadStudy } from './study.js?v=20261126-0956';
import { renderPrint, printLinks } from './print.js?v=20261126-0956';
import { ring, conceptLegend, renderNotes } from './notes.js?v=20261126-0956';
import { saveRecords, loadRecords, getCurrentLearner, setCurrentLearner, addLearner, setLearnerOrder, subscribeCloud, getSyncStatus } from './store.js?v=20261126-0956';
import { enterLearner, changePin, isProtected, needsUnlock, renderLock } from './lock.js?v=20261126-0956';
import { dday, CONCEPT_LABEL } from './progress.mjs?v=20261126-0956';
import { loadSubjectSteps, pickNextStep } from './steps.js?v=20261126-0956';
import { initVoiceAsk } from './voice.js?v=20261126-0956';

const app = document.getElementById('app');
const navLinks = document.getElementById('nav-links');
const navLearner = document.getElementById('nav-learner');
const footText = document.getElementById('foot-text');
const footLinks = document.getElementById('foot-links');
const vsbar = document.getElementById('vsbar');

const ROLE_LABEL = { summary: '핵심 요약', unit: '단원 정리', exam: '예상 문제지', answers: '정답 및 해설' };

const data = { exam: null, concepts: [] };

/* 같은 자료를 여러 화면이 동시에 달라고 해도 한 번만 내려받는다 (글자로 보관 → 화면마다 새 객체로 풀어 준다).
 * 받다가 끊기면 한 번 더 시도하고, 실패한 것은 보관하지 않아 다음에 다시 받는다. */
const jsonText = new Map();
async function fetchText(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(versioned(url));
      if (res.status === 404) throw Object.assign(new Error(`${url} → 404`), { final: true });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (err.final) break;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}
async function getJson(url) {
  if (!jsonText.has(url)) jsonText.set(url, fetchText(url).catch((err) => { jsonText.delete(url); throw err; }));
  return JSON.parse(await jsonText.get(url));
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

let lastLearnerNames = [];

const SYNC_LABEL = { connected: '실시간 공유', connecting: '연결 중', offline: '오프라인' };

function syncBadge() {
  const status = getSyncStatus();
  return el(`span.sync-badge.${status}`, { text: SYNC_LABEL[status] || status, title: '여러 기기 간 실시간 동기화 상태' });
}

function renderNavLearner(names) {
  if (!navLearner) return;
  if (Array.isArray(names) && names.length) lastLearnerNames = names;
  const current = getCurrentLearner();
  const list = [...new Set([...lastLearnerNames, current])];
  const select = el('select.learner-select', { 'aria-label': '참여자 선택' }, list.map((name) => el('option', { value: name, text: name })));
  select.value = current;
  select.addEventListener('change', async () => {
    if (!(await enterLearner(select.value))) select.value = getCurrentLearner(); // 비밀번호를 못 맞히면 그대로
    void route();
  });
  navLearner.replaceChildren(syncBadge(), el('a.nav-avatar', { href: '#/me', title: '캐릭터 고르기', 'aria-label': '캐릭터 고르기' }, avatar(current, 'xs')), select);
}

/** 홈의 큰 버튼들 — 상단 「메뉴」에서도 같은 목록을 고른다 */
const MENU = [
  ['#/units', '실전 연습'],
  ['#/assess', '수준 평가'],
  ['#/past', '기출문제'],
  ['#/notes', '오답 노트'],
  ['#/dashboard', '내 진도'],
  ['#/versus', '대결'],
  ['#/board', '질문 게시판'],
  ['#/me', '캐릭터 고르기']
];

const navMenu = document.getElementById('nav-menu');

function markNavMenu() {
  if (!navMenu) return;
  const hash = location.hash || '#/';
  for (const a of navMenu.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    a.toggleAttribute('aria-current', hash === href || hash.startsWith(href + '/'));
  }
}

function initNavMenu() {
  if (!navMenu) return;
  navMenu.replaceChildren(
    el('summary', { text: '메뉴', 'aria-label': '메뉴 열기' }),
    el('div.nav-menu-list', {}, MENU.map(([href, text]) => el('a', { href, text })))
  );
  const close = () => navMenu.removeAttribute('open');
  navMenu.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  document.addEventListener('click', (e) => { if (!navMenu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('hashchange', () => { close(); markNavMenu(); });
  markNavMenu();
}
initNavMenu();

function setNav(code) {
  navLinks.replaceChildren(
    ...data.exam.subjects.map((s) => el('a', { href: `#/s/${s.code}`, text: s.subject, 'aria-current': s.code === code ? 'page' : null }))
  );
  renderNavLearner();
}

function show(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function stat(value, label) {
  return el('li', {}, el('b', { text: String(value) }), label);
}

/* ── 홈 ─────────────────────────────────────────── */

/** 시험일 고르기 — 고르면 기록에 덧붙이고 화면을 다시 그린다 */
function examDatePicker(study) {
  const input = el('input.date-input', { type: 'date', value: study.examDate || '', 'aria-label': '시험일' });
  input.addEventListener('change', async () => {
    await saveRecords([{ type: 'setting', key: 'examDate', value: input.value || null }]);
    void renderHome();
  });
  return el('label.date-pick', {}, study.examDate ? '시험일 ' : '시험일을 정하면 남은 날을 보여 줍니다 ', input);
}

/** 참여자별 진도율 섹션 — 참여자 전환 · 새 참여자 추가 · 과목별 비교 */
function learnersSection(study) {
  const input = el('input.learner-input', {
    type: 'text',
    maxlength: 24,
    placeholder: '새 참여자 이름 (예: 학생 이름)',
    'aria-label': '새 참여자 이름',
  });
  const form = el('form.learner-form', {}, input, el('button.pill.small', { type: 'submit', text: '추가' }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const typed = input.value;
    if (isProtected(typed)) {
      // 비밀번호가 걸린 이름을 새로 적어 넣어도 비밀번호를 묻는다
      input.value = '';
      void enterLearner(typed).then((ok) => ok && renderHome());
      return;
    }
    const added = addLearner(typed);
    if (!added) {
      input.focus();
      return;
    }
    input.value = '';
    void renderHome();
  });

  let suppressClickUntil = 0;
  const switchTo = async (name) => {
    if (Date.now() < suppressClickUntil) return;
    if (name === study.learner) return;
    if (await enterLearner(name)) void renderHome();
  };
  const pinButton = isProtected(study.learner)
    ? el('button.pill.small.ghost', { type: 'button', text: '🔒 비밀번호 변경', onclick: async () => {
        if (await changePin()) alert('비밀번호를 바꿨습니다. 다음부터 새 비밀번호로 들어오세요.');
      } })
    : null;

  const chipsBox = el('div.chips', {},
    study.learners.map((item) =>
      el(`button.chip.pick${item.name === study.learner ? '.on' : ''}`, {
        type: 'button',
        'data-learner': item.name,
        'aria-pressed': String(item.name === study.learner),
        text: `${item.name} (${item.overall}%)`,
        onclick: () => switchTo(item.name),
      })
    )
  );

  const grid = el('div.learner-grid', {},
    study.learners.map((item) => {
      const active = item.name === study.learner;
      return el(`button.card.learner-card${active ? '.active' : ''}`, {
        type: 'button',
        'data-learner': item.name,
        'aria-pressed': String(active),
        title: '끌어서 위치 이동 · 클릭하면 참여자 전환',
        onclick: () => switchTo(item.name),
      },
        el('div.learner-portrait', {},
          avatar(item.name, 'portrait'),
          active ? el('span.learner-now', { text: '현재 보는 중' }) : null
        ),
        el('div.learner-body', {},
          el('div.learner-head', {},
            el('strong', { text: item.name }),
            el('span.learner-pct', { text: `${item.overall}%` })
          ),
          el('div.learner-progress', {}, el('i', { style: `width:${item.overall}%` })),
          el('p.learner-meta', {
            text: `푼 문제 ${item.triedQuestions} / ${item.totalQuestions} · 숙련도 ${item.mastery == null ? '–' : `${item.mastery}%`} · 오늘 복습 ${item.dueTotal}`,
          }),
          el('div.learner-subjects', {},
            item.subjects.map((sub) =>
              el(`span.learner-sub${sub.progress > 0 ? '.on' : ''}`, { text: `${sub.subject} ${sub.progress}%` })
            )
          )
        )
      );
    })
  );

  enableLearnerCardDrag(grid, chipsBox, (order) => {
    suppressClickUntil = Date.now() + 250;
    setLearnerOrder(order);
    renderNavLearner(order);
  });

  return el('div.wrap', {},
    el('section.section.learners-section', { style: 'padding-top:0' },
      el('div.section-head', {},
        el('h2', { text: '참여자별 진도율' }),
        el('p', { text: '참여자를 고르거나 추가하면 읽음·풀이·오답 기록과 진도율이 사람마다 따로 쌓입니다. 카드를 드래그하면 위치를 바꿀 수 있습니다.' })
      ),
      el('div.learner-controls', {},
        chipsBox,
        el('div.learner-tools', {}, pinButton, form)
      ),
      grid
    )
  );
}

/** 참여자 카드를 드래그하여 순서를 바꾸고 상단 칩과 동기화한다 */
function enableLearnerCardDrag(grid, chipsBox, onReordered) {
  grid.addEventListener('dragstart', (e) => e.preventDefault());

  const findOverCard = (x, y) => {
    const hit = document.elementFromPoint(x, y)?.closest('.learner-card');
    if (hit && hit.parentElement === grid) return hit;
    const cards = [...grid.querySelectorAll('.learner-card')];
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return c;
    }
    const last = cards.at(-1);
    if (last) {
      const r = last.getBoundingClientRect();
      const gr = grid.getBoundingClientRect();
      if (y >= r.top && y <= gr.bottom && x > r.right && x <= gr.right) return last;
    }
    return null;
  };

  const syncChips = () => {
    const byName = new Map([...chipsBox.querySelectorAll('[data-learner]')].map((c) => [c.dataset.learner, c]));
    for (const card of grid.querySelectorAll('.learner-card')) {
      const chip = byName.get(card.dataset.learner);
      if (chip) chipsBox.append(chip);
    }
  };

  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const card = e.target.closest('.learner-card');
    if (!card || card.parentElement !== grid) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = card.getBoundingClientRect();
    let dragging = false;
    let ghost = null;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 6) return;
        dragging = true;
        card.classList.add('is-dragging');
        ghost = card.cloneNode(true);
        ghost.classList.remove('is-dragging');
        ghost.classList.add('learner-drag-ghost');
        ghost.style.left = `${startRect.left}px`;
        ghost.style.top = `${startRect.top}px`;
        ghost.style.width = `${startRect.width}px`;
        ghost.style.height = `${startRect.height}px`;
        document.body.append(ghost);
      }
      ev.preventDefault();
      ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.02)`;

      const over = findOverCard(ev.clientX, ev.clientY);
      if (over && over !== card) {
        const cards = [...grid.querySelectorAll('.learner-card')];
        const from = cards.indexOf(card);
        const to = cards.indexOf(over);
        if (from !== -1 && to !== -1 && from !== to) {
          if (from < to) over.after(card);
          else over.before(card);
          syncChips();
        }
      }
    };

    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      if (!dragging) return;
      ghost?.remove();
      card.classList.remove('is-dragging');
      const order = [...grid.querySelectorAll('.learner-card')].map((c) => c.dataset.learner).filter(Boolean);
      onReordered(order);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  });
}

async function renderHome() {
  const { subjects, title } = data.exam;
  document.title = `시험 준비 — ${title}`;
  const study = await loadStudy(ctx, subjects, data.concepts, undefined, { fast: true });
  renderNavLearner(study.learners.map((l) => l.name));
  setNav(null);
  const infos = subjects.map((s) => study.bySubject.get(s.code));
  const total = subjects.reduce((a, s) => a + questionCount(s), 0);
  const left = dday(study.examDate, study.today);
  const overall = study.overall;

  show(
    el('section.hero', {},
      el('p.eyebrow.dday', { text: left ? `시험까지 ${left.label}` : '시험 준비' }),
      el('h1', { text: title }),
      el('p.sub', { text: `${study.learner} · 전체 진도율 ${overall}% · ${subjects.length}과목 · 문서 ${countDocs(subjects)}개 · 문제 ${total}개` }),
      examDatePicker(study),
      el('div.hero-actions', {},
        ...MENU.map(([href, text], i) => el(i === 0 ? 'a.pill' : 'a.pill.ghost', { href, text }))
      ),
      !study.ok ? el('p.save-warn', { text: '풀이 기록을 읽지 못해 진도율이 비어 보일 수 있습니다.' }) : null
    ),
    learnersSection(study),
    el('section.band', {},
      el('div.wrap', {},
        el('div.grid', {},
          infos.map((info) => {
            const s = info.subject;
            return el('a.card.subject-card.rise', { href: `#/s/${s.code}` },
              el('div.subject-head', {},
                subjectIcon(s),
                ring(info.progress, info.mastery, 84)
              ),
              el('div.subject-top', {},
                el('div', {}, el('h3', { text: s.subject }), el('p.units', { text: unitsOf(s).map(shortUnit).join(' · ') || '단원 정보 없음' }))
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

/* 과목 카드 아이콘 — assets/subjects/<이름>.webp (없으면 그림 자리 없이 보인다) */
const SUBJECT_ICON = { 과학: 'science', 국어: 'korean', 도덕: 'ethics', 사회: 'social', 수학: 'math', 영어: 'english', 베트남어: 'vietnamese' };
function subjectIcon(s, cls = 'subject-icon') {
  const name = SUBJECT_ICON[s.subject];
  return name ? el(`img.${cls}`, { src: `assets/subjects/${name}.webp?v=2`, alt: '', onerror: (e) => e.target.remove() }) : null;
}

/* ── 과목 ─────────────────────────────────────────── */
/* 개념 칩의 동영상 아이콘: 그 절(제목 아래부터 같은 급 제목 전까지)에 든 동영상 수만큼 🎬 */
const VIDEO_RE = /(youtube\.com\/|youtu\.be\/|vimeo\.com\/|notebook\.google\.com\/|notebooklm\.google\.com\/|\.(mp4|webm|mov|m4v)(\?|#|\)|"|'|\s|$))/i;
/* 문서를 제목·영상 단위로 나눈다 — 개념 칩과 단원 제목의 🎬 개수를 같은 기준으로 센다 */
const normHead = (t) => String(t || '').replace(/\*\*/g, '').trim();
function parseVideoDoc(md) {
  const lines = md.split('\n');
  const heads = [];
  const videos = []; // { line, urls }
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const m = l.match(/^(#{1,6})\s+(.*)/);
    if (m) { heads.push({ line: i, level: m[1].length, text: normHead(m[2]) }); return; }
    const urls = (l.match(/(https?:\/\/[^\s)"'<>]+|[^\s("'<>]+\.(mp4|webm|mov|m4v))/gi) || []).filter((u) => VIDEO_RE.test(u + ' '));
    if (urls.length) videos.push({ line: i, urls });
  });
  for (const [k, h] of heads.entries()) {
    const next = heads.slice(k + 1).find((x) => x.level <= h.level);
    h.end = next ? next.line : lines.length;
  }
  return { heads, videos };
}
/* 개념 제목 찾기 — 같은 제목이 여러 단원에 있으면(예: 8A·8B 의 「2) 단락별…」) 그 개념의 단원 안에 있는 것 */
function conceptHead(doc, c) {
  const same = doc.heads.filter((h) => h.text === normHead(c.heading));
  if (same.length < 2) return same[0] || null;
  const core = (t) => normHead(t).replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s*\(.*$/, '');
  const unitKey = core(c.unit);
  return same.find((h) => doc.heads.some((u) => u.line < h.line && h.line < u.end && unitKey && core(u.text).includes(unitKey))) || same[0];
}
const countIn = (doc, h) => new Set(doc.videos.filter((v) => v.line > h.line && v.line < h.end).flatMap((v) => v.urls)).size;

/* 개념 제목 밖(단원 제목 바로 아래 등)에 있는 영상 → { unit, heading, count } 목록 */
function unitVideos(doc, concepts) {
  const conceptHeads = concepts.map((c) => ({ c, h: conceptHead(doc, c) })).filter((x) => x.h);
  const out = new Map();
  for (const v of doc.videos) {
    if (conceptHeads.some(({ h }) => v.line > h.line && v.line < h.end)) continue; // 개념 칩에서 이미 센다
    // 영상을 품은 제목부터 바깥으로 올라가며, 그 안에 개념이 있는 첫 제목의 단원에 붙인다
    const around = doc.heads.filter((h) => h.line < v.line && v.line < h.end).sort((a, b) => b.level - a.level);
    for (const h of around) {
      const inside = conceptHeads.find((x) => x.h.line > h.line && x.h.line < h.end);
      if (!inside) continue;
      const key = `${inside.c.unit}\n${h.text}`;
      const rec = out.get(key) || { unit: inside.c.unit, heading: h.text, urls: new Set() };
      v.urls.forEach((u) => rec.urls.add(u));
      out.set(key, rec);
      break;
    }
  }
  return [...out.values()].map((r) => ({ ...r, count: r.urls.size }));
}

async function fillVideoIcons(root, concepts, docHref) {
  const texts = new Map();
  for (const c of concepts) {
    const slot = root.querySelector(`.videos[data-concept="${CSS.escape(c.id)}"]`);
    if (!slot || !c.doc) continue;
    if (!texts.has(c.doc)) {
      const url = `exam/${c.doc.normalize('NFC').split('/').map(encodeURIComponent).join('/')}`;
      texts.set(c.doc, fetch(versioned(url)).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
    }
    const md = await texts.get(c.doc);
    const parsed = md ? parseVideoDoc(md) : null;
    const h = parsed && conceptHead(parsed, c);
    const n = h ? countIn(parsed, h) : 0;
    if (!n) continue;
    slot.setAttribute('aria-label', `동영상 ${n}개`);
    slot.title = `동영상 ${n}개`;
    slot.textContent = '🎬'.repeat(n);
  }
  // 단원 제목 옆: 개념 칩 밖에 있는 영상
  if (!docHref) return;
  for (const file of new Set(concepts.map((c) => c.doc).filter(Boolean))) {
    const md = await texts.get(file);
    if (!md) continue;
    for (const v of unitVideos(parseVideoDoc(md), concepts.filter((c) => c.doc === file))) {
      const slot = root.querySelector(`.unit-videos[data-unit="${CSS.escape(v.unit)}"]`);
      if (!slot) continue;
      slot.append(el('a.unit-video', { href: `${docHref(file)}?h=${encodeURIComponent(v.heading)}`, title: `동영상 ${v.count}개`, 'aria-label': `동영상 ${v.count}개 보러 가기` }, `${'🎬'.repeat(v.count)} 영상`));
    }
  }
}

async function renderSubject(s) {
  document.title = `${s.subject} — 시험 준비`;
  const study = await loadStudy(ctx, data.exam.subjects, data.concepts);
  renderNavLearner(study.learners.map((l) => l.name));
  setNav(s.code);
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

  const docIndexByFile = new Map(docs.map((d, i) => [d.file, i]));

  const steps = await loadSubjectSteps(ctx, s, docs, study.merged, info);
  const conceptsByDoc = new Map();
  for (const c of conceptsOf(s)) {
    if (!conceptsByDoc.has(c.doc)) conceptsByDoc.set(c.doc, []);
    conceptsByDoc.get(c.doc).push(c);
  }
  const isRead = (c) => (stateOf.get(c.id)?.state || 'unseen') !== 'unseen';
  const docRows = readingDocs(s).map((d) => {
    const list = conceptsByDoc.get(d.file) || [];
    const st = steps.byDoc.get(d.file) || { drill: { done: 0, total: 0 }, quiz: null };
    return { doc: d, index: docs.indexOf(d), list, concepts: { read: list.filter(isRead).length, total: list.length }, drill: st.drill, quiz: st.quiz };
  });
  const next = pickNextStep(s.code, docRows, steps, info.due.length);
  const scoreText = (sc) => (sc ? `${sc.best}점${sc.tries > 1 ? ` (${sc.tries}번 · 최근 ${sc.last.score})` : ''}` : '아직');
  const badge = (done, total, label) => el(`span.step-badge${total && done >= total ? '.done' : done ? '.doing' : ''}`, { text: `${label} ${done}/${total}` });

  /* ① 공부하기 — 문서 한 편 = 카드 한 장, 그 안에 개념 목록과 진행 상황 */
  const studyCard = (r) => {
    const units = new Map();
    for (const c of r.list) {
      if (!units.has(c.unit)) units.set(c.unit, []);
      units.get(c.unit).push(c);
    }
    const tracked = r.concepts.total || r.drill.total || r.quiz; // 셀 것이 없는 문서(핵심 요약 등)는 상태를 매기지 않는다
    const allDone = tracked && (!r.concepts.total || r.concepts.read >= r.concepts.total)
      && (!r.drill.total || r.drill.done >= r.drill.total) && (!r.quiz || r.quiz.score);
    const started = r.concepts.read || r.drill.done || r.quiz?.score;
    return el(`div.card.study-card${allDone ? '.done' : ''}`, {},
      el('div.study-top', {},
        el('span.study-mark', { text: !tracked ? '📄' : allDone ? '✅' : started ? '◐' : '○', title: !tracked ? '읽을거리 (시험 직전에 다시 보기)' : allDone ? '다 함' : started ? '하는 중' : '시작 전' }),
        el('div', {},
          el('div.role', { text: ROLE_LABEL[r.doc.role] || r.doc.role }),
          el('h3', {}, el('a', { href: `#/s/${s.code}/${r.index}`, text: r.doc.title }))
        ),
        el('a.pill.small', { href: `#/s/${s.code}/${r.index}`, text: !tracked ? '읽기' : allDone ? '다시 보기' : started ? '이어 하기' : '읽기 시작' })
      ),
      el('div.step-badges', {},
        r.concepts.total ? badge(r.concepts.read, r.concepts.total, '📖 개념 읽음') : null,
        r.drill.total ? badge(r.drill.done, r.drill.total, '✏️ 확인 문제') : null,
        r.quiz ? el(`span.step-badge${r.quiz.score ? (r.quiz.score.best >= 80 ? '.done' : '.doing') : ''}`, { text: `📝 마무리 평가 ${scoreText(r.quiz.score)}` }) : null
      ),
      units.size
        ? [...units].map(([unit, list]) =>
            el('div.study-unit', {},
              units.size > 1 || unit !== r.doc.title ? el('h4', {}, unit, el('span.unit-videos', { 'data-unit': unit })) : el('span.unit-videos', { 'data-unit': unit }),
              el('ul.chips', {},
                list.map((c) =>
                  el('li', {},
                    el('a.chip', { href: `#/s/${s.code}/${r.index}?h=${encodeURIComponent(c.heading)}` },
                      el(`i.state-dot.${stateOf.get(c.id)?.state || 'unseen'}`, { title: CONCEPT_LABEL[stateOf.get(c.id)?.state || 'unseen'] }),
                      c.title,
                      el('span.dots', { 'aria-label': `중요도 ${c.importance}` }, [1, 2, 3].map((n) => el(n <= c.importance ? 'i.on' : 'i'))),
                      el('span.videos', { 'data-concept': c.id })
                    )
                  )
                )
              )
            )
          )
        : null
    );
  };

  const studySection = el('section.section', {},
    el('div.section-head', {},
      el('h2', { text: '① 공부하기' }),
      el('p', { text: '문서를 읽고(개념) → 중간중간 확인 문제 → 문서 끝 마무리 평가. 개념 칩을 누르면 그 부분으로 바로 갑니다.' }),
      conceptLegend()
    ),
    el('div.study-list', {}, docRows.map(studyCard))
  );

  /* ② 실전 연습 — 전 범위, 시험과 같은 모양 */
  const mockTile = (m) => el(`a.mock-tile${m.score ? (m.score.best >= 80 ? '.done' : '.doing') : ''}`, { href: `#/units/${s.code}/${m.id}` },
    el('b', { text: m.short }),
    el('span', { text: m.score ? `${m.score.best}점` : '아직' }),
    el('small', { text: `${m.count}문항${m.minutes ? ` · ${m.minutes}분` : ''}` })
  );
  const problems = el('section.section', {},
    el('div.section-head', {}, el('h2', { text: '② 실전 연습' }), el('p', { text: '시험 범위 전체를 실제 시험처럼 풉니다. 공부하기를 마친 뒤에 하세요.' })),
    steps.mocks.length
      ? el('div.card.solve-card.mock-card', {},
          el('div.role', { text: '단원평가 1~5 · 기출과 같은 문항 수·출제 유형' }),
          el('div.mock-tiles', {}, steps.mocks.map(mockTile)),
          el('div.meta', { text: `푼 세트 ${steps.mocks.filter((m) => m.score).length} / ${steps.mocks.length} · 80점이 넘으면 초록색` })
        )
      : null,
    el('div.grid', {},
      comp
        ? el('div.card.solve-card', {},
            el('div.role', { text: '예상 문제' }),
            el('h3', { text: `${comp.choice.count + comp.essay.count}문항 · ${comp.total}점` }),
            el('div.meta', { text: `실전 최고 ${scoreText(steps.exam)} · 연습은 한 문제씩 바로 채점, 실전은 시간을 재며 한 번에` }),
            el('div.hero-actions.left', {},
              el('a.pill', { href: `#/s/${s.code}/exam`, text: '실전으로 풀기' }),
              el('a.pill.ghost', { href: `#/s/${s.code}/practice`, text: '연습으로 풀기' })
            )
          )
        : null,
      el('div.card.solve-card', {},
        el('div.role', { text: '기출문제' }),
        el('h3', { text: '학교 시험지 보기' }),
        el('div.meta', { text: '지난 정기고사 원본입니다. 풀이 기록은 남지 않습니다.' }),
        el('div.hero-actions.left', {}, el('a.pill.ghost', { href: `#/past?s=${s.code}`, text: '기출 보기' }))
      ),
      docs.filter((d) => d.role === 'exam' || d.role === 'answers').map(docCard)
    )
  );

  /* ③ 마무리 */
  const finish = el('section.section', {},
    el('div.section-head', {}, el('h2', { text: '③ 마무리' }), el('p', { text: '틀린 문제를 다시 풀고, 시험 직전에 수준 평가로 점검합니다.' })),
    el('div.grid', {},
      el('div.card.solve-card', {},
        el('div.role', { text: '오답 노트' }),
        el('h3', { text: info.notes.length ? `오늘 복습 ${info.due.length}문제` : '틀린 문제 없음' }),
        el('div.meta', { text: info.notes.length ? `틀린 문제 ${info.notes.length}개 · 다른 날 한 번 더 ${info.waiting} · 졸업 ${info.graduated}` : '문제를 풀다 틀리면 여기에 모입니다.' }),
        el('div.hero-actions.left', {},
          info.due.length ? el('a.pill', { href: `#/s/${s.code}/review`, text: '복습 시작' }) : null,
          el(`a.pill${info.due.length ? '.ghost' : ''}`, { href: `#/s/${s.code}/notes`, text: '오답 노트 · 통계' })
        )
      ),
      el('div.card.solve-card', {},
        el('div.role', { text: '수준 평가' }),
        el('h3', { text: '1차 진단 → 2차 성취' }),
        el('div.meta', { text: '1차는 공부 시작할 때 한 번(지금 실력), 2차는 시험 직전에 한 번(얼마나 늘었나). 처음 본 점수만 기록됩니다.' }),
        el('div.hero-actions.left', {}, el('a.pill.ghost', { href: '#/assess', text: '수준 평가로' }))
      ),
      steps.plain.length
        ? el('div.card.solve-card', {},
            el('div.role', { text: '더 풀기 (보충)' }),
            el('h3', { text: `단원별 10문항 ${steps.plain.length}개` }),
            el('div.meta', { text: `푼 것 ${steps.plain.filter((u) => u.score).length} / ${steps.plain.length} · 약한 단원만 골라 더 풀 때` }),
            el('div.hero-actions.left', {}, el('a.pill.ghost', { href: `#/units?s=${s.code}`, text: '단원별로 더 풀기' }))
          )
        : null
    )
  );

  const nextBox = next
    ? el('a.next-step', { href: next.href },
        el('span.next-label', { text: '다음 할 일' }),
        el('b', { text: `${next.step} ${next.text}` }),
        el('span.more', { text: '바로 가기 →' })
      )
    : null;

  show(
    el('section.hero', {},
      el('a.back', { href: '#/', text: '전체 과목' }),
      el('div.subject-title', {}, subjectIcon(s, 'subject-title-icon'), el('h1', { text: s.subject })),
      paper?.scope ? el('p.scope', { text: `시험 범위 — ${paper.scope.replace(/\*\*/g, '')}` }) : null
    ),
    el('div.wrap', {},
      nextBox,
      el('section.section.progress-block', { style: 'padding-top:0' },
        ring(info.progress, info.mastery, 150),
        el('div.progress-text', {},
          el('h2', { text: `${study.learner}의 진도율 ${info.progress}%` }),
          el('p', { text: info.mastery == null ? '아직 푼 문제가 없습니다. 읽고 나서 연습 문제를 풀어 보세요.' : `숙련도 ${info.mastery}% (풀어 본 ${info.triedQuestions}문제 중 마지막에 맞힌 비율) · 안쪽 고리` }),
          el('ul.stats.plain', {},
            Object.entries(CONCEPT_LABEL).map(([key, label]) => stat(info.counts[key], label))
          ),
          info.weakest.length ? el('p.note', { text: `약한 개념: ${info.weakest.map((w) => `${w.concept.title} (${Math.round(w.accuracy * 100)}%)`).join(' · ')}` }) : null
        )
      ),

      studySection,
      problems,
      finish,
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '인쇄' }), el('p', { text: '종이로 풀거나 PDF 로 남길 수 있습니다. 문제지와 정답지는 따로 뽑힙니다.' })),
        printLinks(s)
      ),
      readingDocs(s).some((d) => d.role === 'summary')
        ? el('section.section', {},
            el('div.section-head', {}, el('h2', { text: '서브노트' }), el('p', { text: '요점 정리와 내가 틀린 문제를 A4 한 묶음으로 모았습니다. 오답은 문제를 풀 때마다 저절로 채워집니다.' })),
            el('a.card.subnote-card.rise', { href: `#/s/${s.code}/print/subnote` },
              el('div.subnote-thumb', { 'aria-hidden': 'true' }, el('b', { text: 'SUB NOTE' }), el('strong', { text: s.subject }), el('i'), el('i'), el('i'), el('i')),
              el('div.subnote-text', {},
                el('div.role', { text: 'A4 인쇄물' }),
                el('h3', { text: `${s.subject} 서브노트` }),
                el('p.meta', { text: `PART 1 요점 정리 · PART 2 ${study.learner}의 오답 노트${info.notes.length ? ` (예상 문제 오답 ${info.notes.length}개 + 평가 오답)` : ''}` }),
                el('span.more', { text: '열어서 보기 · 인쇄' })
              )
            )
          )
        : null
    )
  );
  void renderHistory(ctx, s, problems);
  void fillVideoIcons(app, conceptsOf(s), (file) => `#/s/${s.code}/${docIndexByFile.get(file) ?? 0}`);
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
  const res = await fetch(versioned(url));
  if (!res.ok) return renderMissing(`문서를 불러오지 못했습니다 (${res.status}).`);
  const body = el('article.doc');
  const { headings } = renderMarkdown(await res.text(), body, {
    imageBase: `exam/${folder.normalize('NFC').split('/').map(encodeURIComponent).join('/')}/`,
    onImage: openLightbox,
  });

  // 문서 끝 단원 평가 (있는 문서만)
  const quiz = await buildDocQuiz(ctx, s.code, doc.file, { subject: s.subject, docTitle: doc.title, docIndex: index });
  if (quiz) body.append(quiz.section);

  // PART 마다 확인 문제 (있는 문서만) — 단원 평가 앞에 넣는다
  if (quiz) quiz.section.remove();
  const drills = await attachDrills(ctx, s.code, doc.file, body, headings);
  if (quiz) body.append(quiz.section);

  // 목차 제목마다 그 절(다음 목차 제목 전까지)에 든 영상 수 — 첫 제목 앞의 영상은 첫 제목에 붙인다
  const tocHeads = headings.filter((h) => h.level === 2 || h.level === 3);
  const videoCount = new Map();
  for (const v of body.querySelectorAll('video')) {
    if (v.closest('.dq')) continue;
    const after = (h) => h.node.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING;
    // 바로 앞 제목이 목차에 없는 큰 제목(# Part 2 …)이면 그 아래 첫 목차 제목에 붙인다
    const prevAny = headings.filter(after).at(-1);
    let owner = tocHeads[0];
    if (prevAny && prevAny.level < 2) owner = tocHeads.find((h) => !after(h)) || tocHeads.at(-1);
    else for (const h of tocHeads) {
      if (after(h)) owner = h;
      else break;
    }
    if (owner) videoCount.set(owner.id, (videoCount.get(owner.id) || 0) + 1);
  }
  const toc = el('nav.toc', { 'aria-label': '목차' },
    el('p', { text: '목차' }),
    tocHeads.map((h) => {
      // 제목의 모양(수식 포함)을 그대로 옮긴다
      const link = el(`a.l${h.level}`, { href: `#${h.id}`, onclick: (e) => jump(e, h.id) });
      link.append(...[...h.node.childNodes].map((n) => n.cloneNode(true)));
      const n = videoCount.get(h.id);
      if (n) link.append(el('span.toc-video', { title: `영상 ${n}편`, 'aria-label': `영상 ${n}편`, text: ` ${'🎬'.repeat(n)}` }));
      return link;
    }),
    null,
    quiz ? el('a.l2.toc-quiz', { href: '#doc-quiz', text: '📝 마무리 평가', onclick: (e) => jump(e, 'doc-quiz') }) : null
  );

  for (const d of drills) {
    d.link = el(`a.l3.toc-drill${d.done ? '.done' : ''}`, { href: `#${d.id}`, text: `✏️ ${d.label} 확인 문제`, onclick: (e) => jump(e, d.id) });
    const before = (d.beforeId && toc.querySelector(`a[href="#${d.beforeId}"]`)) || toc.querySelector('a.toc-quiz');
    if (before) toc.insertBefore(d.link, before);
    else toc.append(d.link);
  }

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
  void attachWatchBoxes(body, s.code);
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
  const target = document.getElementById(id);
  if (!target) return;
  stopJumpFix?.();
  target.scrollIntoView({ behavior: 'auto' });
  // 지나쳐 온 그림(지연 불러오기)이 뒤늦게 펼쳐지면 목적지가 아래로 밀린다 → 2.5초 동안 높이가 바뀔 때마다 다시 맞춘다.
  // 사용자가 직접 스크롤하면 바로 그만둔다.
  const fix = () => target.scrollIntoView({ behavior: 'auto' });
  const ro = new ResizeObserver(fix);
  ro.observe(target.closest('article') || document.body);
  const stop = () => {
    ro.disconnect();
    clearTimeout(timer);
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) window.removeEventListener(ev, stop);
    stopJumpFix = null;
  };
  const timer = setTimeout(stop, 2500);
  for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) window.addEventListener(ev, stop, { passive: true });
  stopJumpFix = stop;
}
let stopJumpFix = null;

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

/** 머리말 아래 대결 띠 — 화면을 그린 뒤 잠깐 쉬었다가 그린다 (첫 화면을 늦추지 않게) */
let vsbarTimer = null;
function refreshVersusBar(delay = 150) {
  if (!vsbar) return;
  clearTimeout(vsbarTimer);
  vsbarTimer = setTimeout(() => {
    if (needsUnlock()) return;
    void renderVersusBar(ctx, data.exam, vsbar, () => {
      refreshVersusBar(0);
      if (location.hash.replace(/^#\/?/, '').split('?')[0] === 'versus') void route();
    }).catch(() => null);
  }, delay);
}

async function route() {
  spy?.disconnect();
  closeLightbox();
  for (const fn of leaving.splice(0)) fn();
  const [pathPart, queryPart] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');
  // 홈은 클라우드 연결을 기다리지 않고 이 브라우저의 기록으로 먼저 그린다
  await (parts.length ? refreshProfiles() : loadRecords({ fast: true }).then((r) => refreshProfiles(r.records))).catch(() => null);
  renderNavLearner();
  // 꼬리말의 성적 링크는 가족 참여자로 들어와 있을 때만 보인다
  if (footLinks) footLinks.hidden = !isProtected(getCurrentLearner()) || needsUnlock();
  if (needsUnlock()) {
    if (vsbar) vsbar.hidden = true;
    return renderLock(ctx, () => void route());
  }
  refreshVersusBar();
  if (!parts.length) return renderHome();
  if (parts[0] === 'me' && parts.length === 1) return renderCharacterSelect(ctx);
  if (parts[0] === 'notes' && parts.length === 1) return renderWrongbook(ctx, data.exam, await loadStudy(ctx, data.exam.subjects, data.concepts), query);
  if (parts[0] === 'board' && parts.length === 1) return renderBoard(ctx, data.exam, query);
  if (parts[0] === 'dashboard' && parts.length === 1) return renderDashboard(ctx, data.exam, data);
  if (parts[0] === 'grades' && parts.length === 1) return renderGrades(ctx, data.exam, query);
  if (parts[0] === 'versus' && parts.length === 1) return renderVersus(ctx, data.exam);
  const unitTesting = renderUnitsRoute(ctx, data.exam, parts, query);
  if (unitTesting) return unitTesting;
  const assessing = renderAssessRoute(ctx, data.exam, parts, query);
  if (assessing) return assessing;
  const past = renderPastRoute(ctx, parts, query);
  if (past) return past;
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
  window.addEventListener('versus-opp', () => refreshVersusBar(0));
  let refreshTimer = null;
  subscribeCloud((ev) => {
    renderNavLearner();
    if (ev?.source === 'ready' && ev.changed === false) return; // 먼저 그린 화면과 클라우드 기록이 같다
    refreshVersusBar(800);
    const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    const liveView = parts.length === 0 || (parts[0] === 'assess' && parts.length === 1) || (parts[0] === 'units' && parts.length === 1) || (parts[0] === 'notes' && parts.length === 1) || (parts[0] === 's' && (parts.length === 2 || (parts.length === 3 && parts[2] === 'notes')));
    const tag = document.activeElement?.tagName;
    if (!liveView || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.learner-drag-ghost')) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void go(), 300);
  });
  await go();
}

// 🎙 이 문제 물어보기 — 켜 둔 기기에서만 움직인다. 여기서 탈이 나도 앱은 그대로 뜬다
try { initVoiceAsk(); } catch { /* 음성 연결 없이 계속 */ }
void start();
