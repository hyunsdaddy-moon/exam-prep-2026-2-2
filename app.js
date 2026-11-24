/*
 * 시험 준비 웹앱 — 홈 · 과목 · 읽기 (docs/시험준비탭개발계획서.md 1단계)
 *
 * 데이터는 읽기만 한다:
 *   /data/exam.json, /data/concepts.json   가져오기(import.mjs)가 만든 것
 *   /exam/<과목>_시험공부/<문서>.md          요약·문제지 원문 (마크다운이 원본이다)
 * 화면 주소는 #/ , #/s/<과목 코드> , #/s/<과목 코드>/<문서 번호> 셋이다.
 */

import { renderMarkdown, headingKey } from './markdown.js?v=20261124-1948';
import { el, versioned } from './dom.js?v=20261124-1948';
import { renderSolveRoute, renderHistory } from './solve.js?v=20261124-1948';
import { renderUnitsRoute } from './units.js?v=20261124-1948';
import { buildDocQuiz } from './docquiz.js?v=20261124-1948';
import { attachWatchBoxes } from './watch.js?v=20261124-1948';
import { renderDashboard } from './dashboard.js?v=20261124-1948';
import { renderGrades } from './grades.js?v=20261124-1948';
import { renderVersus, renderVersusBar } from './versus.js?v=20261124-1948';
import { renderAssessRoute } from './assess.js?v=20261124-1948';
import { renderPastRoute } from './past.js?v=20261124-1948';
import { renderWrongbook } from './wrongbook.js?v=20261124-1948';
import { renderBoard } from './board.js?v=20261124-1948';
import { renderCharacterSelect, refreshProfiles, avatar } from './characters.js?v=20261124-1948';
import { loadStudy } from './study.js?v=20261124-1948';
import { renderPrint, printLinks } from './print.js?v=20261124-1948';
import { ring, conceptLegend, renderNotes } from './notes.js?v=20261124-1948';
import { saveRecords, loadRecords, getCurrentLearner, setCurrentLearner, addLearner, subscribeCloud, getSyncStatus } from './store.js?v=20261124-1948';
import { enterLearner, changePin, isProtected, needsUnlock, renderLock } from './lock.js?v=20261124-1948';
import { dday, CONCEPT_LABEL } from './progress.mjs?v=20261124-1948';

const app = document.getElementById('app');
const navLinks = document.getElementById('nav-links');
const navLearner = document.getElementById('nav-learner');
const footText = document.getElementById('foot-text');
const vsbar = document.getElementById('vsbar');

const ROLE_LABEL = { summary: '핵심 요약', unit: '단원 정리', exam: '예상 문제지', answers: '정답 및 해설' };

const data = { exam: null, concepts: [] };

async function getJson(url) {
  const res = await fetch(versioned(url));
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

  const switchTo = async (name) => {
    if (name === study.learner) return;
    if (await enterLearner(name)) void renderHome();
  };
  const pinButton = isProtected(study.learner)
    ? el('button.pill.small.ghost', { type: 'button', text: '🔒 비밀번호 변경', onclick: async () => {
        if (await changePin()) alert('비밀번호를 바꿨습니다. 다음부터 새 비밀번호로 들어오세요.');
      } })
    : null;

  return el('div.wrap', {},
    el('section.section.learners-section', { style: 'padding-top:0' },
      el('div.section-head', {},
        el('h2', { text: '참여자별 진도율' }),
        el('p', { text: '참여자를 고르거나 추가하면 읽음·풀이·오답 기록과 진도율이 사람마다 따로 쌓입니다.' })
      ),
      el('div.learner-controls', {},
        el('div.chips', {},
          study.learners.map((item) =>
            el(`button.chip.pick${item.name === study.learner ? '.on' : ''}`, {
              type: 'button',
              'aria-pressed': String(item.name === study.learner),
              text: `${item.name} (${item.overall}%)`,
              onclick: () => switchTo(item.name),
            })
          )
        ),
        el('div.learner-tools', {}, pinButton, form)
      ),
      el('div.learner-grid', {},
        study.learners.map((item) => {
          const active = item.name === study.learner;
          return el(`button.card.learner-card${active ? '.active' : ''}`, {
            type: 'button',
            'aria-pressed': String(active),
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
      )
    )
  );
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
        el('a.pill', { href: '#/units', text: '단원 평가' }),
        el('a.pill.ghost', { href: '#/assess', text: '수준 평가' }),
        el('a.pill.ghost', { href: '#/past', text: '기출문제' }),
        el('a.pill.ghost', { href: '#/notes', text: '오답 노트' }),
        el('a.pill.ghost', { href: '#/dashboard', text: '학습 현황' }),
        isProtected(study.learner) ? el('a.pill.ghost', { href: '#/grades', text: '성적' }) : null,
        el('a.pill.ghost', { href: '#/versus', text: '대결' }),
        el('a.pill.ghost', { href: '#/board', text: '질문 게시판' }),
        el('a.pill.ghost', { href: '#/me', text: '캐릭터 고르기' })
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
  return name ? el(`img.${cls}`, { src: `assets/subjects/${name}.webp`, alt: '', onerror: (e) => e.target.remove() }) : null;
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
            el('div.role', { text: '단원 평가' }),
            el('h3', { text: '단원별로 시험 보기' }),
            el('div.meta', { text: '단원마다 새 문제 10개 · 100점 · 15분' }),
            el('div.hero-actions.left', {}, el('a.pill', { href: `#/units?s=${s.code}`, text: '단원 평가 보기' }))
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
      el('div.subject-title', {}, subjectIcon(s, 'subject-title-icon'), el('h1', { text: s.subject })),
      paper?.scope ? el('p.scope', { text: `시험 범위 — ${paper.scope.replace(/\*\*/g, '')}` }) : null
    ),
    el('div.wrap', {},
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

      byUnit.size
        ? el('section.section', {},
            el('div.section-head', {}, el('h2', { text: '개념' }), el('p', { text: '점이 많을수록 시험에 자주 나오는 개념입니다. 누르면 그 부분으로 갑니다.' }), conceptLegend()),
            [...byUnit].map(([unit, list]) =>
              el('div.unit', {},
                el('h3', {}, unit, el('span.unit-videos', { 'data-unit': unit })),
                el('ul.chips', {},
                  list.map((c) =>
                    el('li', {},
                      el('a.chip', { href: `#/s/${s.code}/${docIndexByFile.get(c.doc) ?? 0}?h=${encodeURIComponent(c.heading)}` },
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
          )
        : null,

      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '읽기' }), el('p', { text: '핵심 요약부터 읽고 단원 정리로 넘어가세요.' })),
        el('div.grid', {}, readingDocs(s).map(docCard))
      ),

      problems,
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '인쇄' }), el('p', { text: '종이로 풀거나 PDF 로 남길 수 있습니다. 문제지와 정답지는 따로 뽑힙니다.' })),
        printLinks(s)
      )
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
    quiz ? el('a.l2.toc-quiz', { href: '#doc-quiz', text: '📝 단원 평가', onclick: (e) => jump(e, 'doc-quiz') }) : null
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
    if (!liveView || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void go(), 300);
  });
  await go();
}

void start();
