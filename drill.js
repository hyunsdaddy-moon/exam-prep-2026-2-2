/*
 * 시험 준비 웹앱 — 읽기 문서의 PART 마다 붙는 「확인 문제」 (핵심 개념 외우기용)
 *
 * 문항: data/drill/<과목 코드>.json  { docs: { "<문서 경로>": [ { part, title, items: [...] } ] } }
 *   blank { id, k:'blank', q }            — q 안의 [[정답]] 칸이 가려진다
 *   ox    { id, k:'ox', q, a:'O'|'X', why }
 *   qa    { id, k:'qa', q, a }
 *   글자 안의 **굵게** 를 쓸 수 있다.
 *
 * 푸는 법: 가려진 칸을 눌러 정답을 본 뒤, 스스로 ○(맞혔다)·×(틀렸다)를 매긴다.
 * 기록: 이 기기(localStorage)에 바로 두고, 서버에도 'read' 기록으로 남겨 기기끼리 맞춘다.
 *       concept = "d:<문항 id>:<o|x|->" ('-' = 지움). 같은 문항은 가장 나중 기록이 이긴다.
 *       (Firestore 규칙을 바꾸지 않으려고 영상 시청 'v:' 과 같은 방식으로 끼워 넣었다.)
 */

import { el } from './dom.js?v=20261126-0923';
import { getCurrentLearner, loadRecords, saveRecords } from './store.js?v=20261126-0923';
import { recordLearner } from './grade.mjs?v=20261126-0923';

const KEY = 'examprep.2026-2-2.drill';
const files = new Map();

function loadMarks() {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    return all[getCurrentLearner()] || {};
  } catch {
    return {};
  }
}
function writeMarks(marks) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[getCurrentLearner()] = marks;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* 저장 못 해도 푸는 데는 지장 없다 */ }
}
/** 이 기기에 저장하고, 바뀐 문항만 서버 기록으로도 보낸다 */
function saveMarks(marks, subject) {
  const before = loadMarks();
  writeMarks(marks);
  const changed = new Set([...Object.keys(before), ...Object.keys(marks)]);
  const recs = [];
  for (const id of changed) {
    if ((before[id] || '') === (marks[id] || '')) continue;
    recs.push({ type: 'read', concept: `${PREFIX}${id}:${marks[id] || '-'}`, subject: subject || null });
  }
  if (recs.length) void saveRecords(recs);
}

const PREFIX = 'd:';
const SYNCED_KEY = 'examprep.2026-2-2.drill.synced';
let syncing = null;

/**
 * 서버 기록과 이 기기의 표시를 맞춘다 (화면을 열 때 한 번).
 *  - 처음 한 번: 이 기기에만 있던 예전 표시를 서버로 올린다.
 *  - 그다음: 서버 기록(아직 못 보낸 것 포함)의 문항별 마지막 표시가 정답이다.
 */
export function syncDrillMarks() {
  if (syncing) return syncing;
  syncing = (async () => {
    const learner = getCurrentLearner();
    const loaded = await loadRecords();
    const latest = new Map();
    const recs = (loaded.records || [])
      .filter((r) => r && r.type === 'read' && typeof r.concept === 'string' && r.concept.startsWith(PREFIX) && recordLearner(r) === learner)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    for (const r of recs) {
      const m = /^d:(.+):([ox-])$/.exec(r.concept);
      if (m) latest.set(m[1], m[2]);
    }
    const local = loadMarks();
    let flag = {};
    try { flag = JSON.parse(localStorage.getItem(SYNCED_KEY) || '{}'); } catch { flag = {}; }
    if (!flag[learner]) {
      // 예전 표시 올리기: 서버에 아직 없는 문항만
      const up = Object.entries(local).filter(([id, m]) => (m === 'o' || m === 'x') && !latest.has(id));
      if (up.length) await saveRecords(up.map(([id, m]) => ({ type: 'read', concept: `${PREFIX}${id}:${m}`, subject: null })));
      for (const [id, m] of up) latest.set(id, m);
      flag[learner] = new Date().toISOString();
      try { localStorage.setItem(SYNCED_KEY, JSON.stringify(flag)); } catch { /* 다음에 다시 */ }
    }
    const merged = {};
    for (const [id, m] of latest) if (m === 'o' || m === 'x') merged[id] = m;
    writeMarks(merged);
    return merged;
  })().finally(() => { syncing = null; });
  return syncing;
}

/** '**굵게**' 만 알아듣는 작은 글자 그리기 */
function inline(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
    .map((t) => (t.startsWith('**') && t.endsWith('**') ? el('strong', { text: t.slice(2, -2) }) : document.createTextNode(t)));
}

/** 누르면 열리는 가림 칸 */
function cover(answer, onOpen, cls = '') {
  const btn = el(`button.dr-cover${cls}`, { type: 'button', 'aria-label': '가려진 정답 보기' }, el('span.dr-ans', {}, inline(answer)));
  btn.addEventListener('click', () => {
    if (btn.classList.contains('open')) return;
    btn.classList.add('open');
    btn.removeAttribute('aria-label');
    onOpen();
  });
  return btn;
}

function buildCard(item, n, marks, onMark) {
  const covers = [];
  const markRow = el('div.dr-mark', { hidden: true });
  const card = el('li.dr-card', { 'data-id': item.id });
  const opened = () => {
    if (covers.every((c) => c.classList.contains('open'))) markRow.hidden = false;
  };

  const q = el('div.dr-q', {}, el('span.dr-no', { text: `${n}` }));
  if (item.k === 'blank') {
    for (const part of item.q.split(/(\[\[[^\]]+\]\])/).filter(Boolean)) {
      if (part.startsWith('[[')) {
        const c = cover(part.slice(2, -2), opened);
        covers.push(c);
        q.append(c);
      } else q.append(...inline(part));
    }
    card.append(q);
  } else if (item.k === 'ox') {
    q.append(...inline(item.q));
    const c = cover(item.a, opened, '.ox');
    covers.push(c);
    const why = item.why ? el('span.dr-why', {}, inline(item.why)) : null;
    card.append(q, el('div.dr-a', {}, el('span.dr-label', { text: 'O / X' }), c, why));
  } else {
    q.append(...inline(item.q));
    const c = cover(item.a, opened);
    covers.push(c);
    card.append(q, el('div.dr-a', {}, el('span.dr-label', { text: '답' }), c));
  }

  const setMark = (m) => {
    card.dataset.mark = m || '';
    for (const b of markRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.m === m));
    onMark(item.id, m);
  };
  markRow.append(
    el('span', { text: '나는…' }),
    el('button.dr-o', { type: 'button', 'data-m': 'o', onclick: () => setMark('o') }, '○ 맞혔어요'),
    el('button.dr-x', { type: 'button', 'data-m': 'x', onclick: () => setMark('x') }, '× 틀렸어요')
  );
  card.append(markRow);

  // 이미 매긴 문항은 열어 둔 채로 보여 준다
  const m = marks[item.id];
  if (m) {
    for (const c of covers) c.classList.add('open');
    markRow.hidden = false;
    card.dataset.mark = m;
    for (const b of markRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.m === m));
  }
  card.reset = () => {
    for (const c of covers) c.classList.remove('open');
    markRow.hidden = true;
    card.dataset.mark = '';
    for (const b of markRow.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
  };
  return card;
}

function buildSet(set, onChange) {
  const marks = loadMarks();
  const id = set.domId;
  const score = el('p.dr-score');
  const list = el('ol.dr-list');
  let onlyWrong = false;

  const update = () => {
    const now = loadMarks();
    const o = set.items.filter((it) => now[it.id] === 'o').length;
    const x = set.items.filter((it) => now[it.id] === 'x').length;
    const left = set.items.length - o - x;
    score.replaceChildren(
      el('span.o', { text: `○ ${o}` }), ' · ', el('span.x', { text: `× ${x}` }), ' · ', el('span', { text: `남음 ${left}` }),
      o === set.items.length ? el('strong.dr-done', { text: '  🎉 모두 맞혔어요!' }) : null
    );
    wrongBtn.disabled = !x && !onlyWrong;
    onChange(o === set.items.length);
  };
  const onMark = (itemId, m) => {
    const now = loadMarks();
    if (m) now[itemId] = m;
    else delete now[itemId];
    saveMarks(now, set.subject);
    update();
  };

  const cards = set.items.map((it, i) => buildCard(it, i + 1, marks, onMark));
  list.append(...cards);

  const resetBtn = el('button.dr-btn', { type: 'button', text: '처음부터 다시' });
  const wrongBtn = el('button.dr-btn', { type: 'button', text: '× 만 다시' });
  resetBtn.addEventListener('click', () => {
    const now = loadMarks();
    for (const it of set.items) delete now[it.id];
    saveMarks(now, set.subject);
    onlyWrong = false;
    wrongBtn.textContent = '× 만 다시';
    for (const c of cards) { c.reset(); c.hidden = false; }
    update();
  });
  wrongBtn.addEventListener('click', () => {
    const now = loadMarks();
    if (onlyWrong) {
      onlyWrong = false;
      wrongBtn.textContent = '× 만 다시';
      for (const c of cards) c.hidden = false;
    } else {
      onlyWrong = true;
      wrongBtn.textContent = '전체 보기';
      for (const c of cards) {
        const wrong = now[c.dataset.id] === 'x';
        c.hidden = !wrong;
        if (wrong) { c.reset(); delete now[c.dataset.id]; }
      }
      saveMarks(now, set.subject);
    }
    update();
  });

  const section = el('section.drill', { id, 'aria-label': set.title },
    el('div.dr-head', {},
      el('h3', { text: `✏️ ${set.title}` }),
      el('p.dr-help', { text: '가려진 칸을 눌러 정답을 보고, 맞혔으면 ○ 틀렸으면 × 를 눌러요.' })
    ),
    list,
    el('div.dr-foot', {}, score, el('div', {}, wrongBtn, ' ', resetBtn))
  );
  return { section, update };
}

/** 제목 맞추기용: 앞의 그림 글자·기호·빈칸을 떼고 소문자로 */
const norm = (t) => String(t).normalize('NFC').replace(/^[^0-9A-Za-z가-힣]+/u, '').replace(/\s+/g, ' ').toLowerCase();

/**
 * 문서에 확인 문제를 붙인다. 붙인 것마다 { id, label, title, section, beforeId, done, link } 를 돌려준다.
 * 세트가 붙는 자리: set.anchor(제목 앞부분, 예: "01." · "PART 1" · "7강") 또는 set.part(PART 번호)로 찾은 큰 제목(# · ##)의
 * 절이 끝나는 곳 = 같은 높이 이상의 다음 제목 앞(바로 앞이 가로줄이면 그 앞). 다음 제목이 없으면 문서 끝.
 */
export async function attachDrills(ctx, code, file, body, headings) {
  if (!files.has(code)) files.set(code, ctx.getJson(`data/drill/${code}.json`).catch(() => ({ docs: {} })));
  const sets = (await files.get(code)).docs?.[file.normalize('NFC')] || [];
  if (!sets.length) return [];
  await syncDrillMarks().catch(() => null); // 다른 기기에서 매긴 것도 보이게
  const big = headings.filter((h) => h.level <= 2);
  const out = [];
  sets.forEach((set, n) => {
    let target = null;
    if (set.anchor) target = big.find((h) => norm(h.node.textContent).startsWith(norm(set.anchor)));
    else if (set.part) target = big.find((h) => Number(/PART\s*(\d+)/i.exec(h.node.textContent)?.[1]) === set.part);
    if (!target) return;
    const ti = headings.indexOf(target);
    const endHead = headings.slice(ti + 1).find((h) => h.level <= target.level) || null;
    let anchor = endHead?.node || null;
    if (anchor && anchor.previousElementSibling?.tagName === 'HR') anchor = anchor.previousElementSibling;
    const tocNext = endHead ? headings.slice(headings.indexOf(endHead)).find((h) => h.level === 2 || h.level === 3) : null;
    const label = set.label || (set.part ? `PART ${set.part}` : set.anchor);
    const rec = { id: `drill-${n + 1}`, label, title: set.title, beforeId: tocNext?.id || null, done: false, link: null };
    const built = buildSet({ ...set, domId: rec.id, subject: code }, (done) => {
      rec.done = done;
      rec.link?.classList.toggle('done', done);
    });
    rec.section = built.section;
    if (anchor) anchor.parentNode.insertBefore(built.section, anchor);
    else body.append(built.section);
    built.update();
    out.push(rec);
  });
  return out;
}
