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
 * 기록: 이 기기에만 둔다 (Firestore 를 쓰지 않는다). 참여자마다 따로 둔다.
 */

import { el } from './dom.js?v=20261125-0946';
import { getCurrentLearner } from './store.js?v=20261125-0946';

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
function saveMarks(marks) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[getCurrentLearner()] = marks;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* 저장 못 해도 푸는 데는 지장 없다 */ }
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
  const id = `drill-p${set.part}`;
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
    saveMarks(now);
    update();
  };

  const cards = set.items.map((it, i) => buildCard(it, i + 1, marks, onMark));
  list.append(...cards);

  const resetBtn = el('button.dr-btn', { type: 'button', text: '처음부터 다시' });
  const wrongBtn = el('button.dr-btn', { type: 'button', text: '× 만 다시' });
  resetBtn.addEventListener('click', () => {
    const now = loadMarks();
    for (const it of set.items) delete now[it.id];
    saveMarks(now);
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
      saveMarks(now);
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

/**
 * 문서에 확인 문제를 붙인다. 붙인 것마다 { id, title, part, section, done(bool) } 을 돌려준다.
 * 각 세트는 그 PART 의 끝(다음 PART 제목 앞, 바로 앞의 가로줄 앞)에 넣는다. 마지막 PART 는 문서 끝.
 */
export async function attachDrills(ctx, code, file, body, headings) {
  if (!files.has(code)) files.set(code, ctx.getJson(`data/drill/${code}.json`).catch(() => ({ docs: {} })));
  const sets = (await files.get(code)).docs?.[file.normalize('NFC')] || [];
  if (!sets.length) return [];
  const parts = headings
    .filter((h) => h.level <= 2)
    .map((h) => ({ h, m: /^\s*PART\s*(\d+)/i.exec(h.node.textContent) }));
  const out = [];
  for (const set of sets) {
    const i = parts.findIndex((p) => p.m && Number(p.m[1]) === set.part);
    if (i < 0) continue;
    const nextHead = parts.slice(i + 1).find((p) => p.m)?.h || null;
    let anchor = nextHead?.node || null;
    if (anchor && anchor.previousElementSibling?.tagName === 'HR') anchor = anchor.previousElementSibling;
    const rec = { id: `drill-p${set.part}`, title: set.title, part: set.part, beforeId: nextHead?.id || null, done: false, link: null };
    const built = buildSet(set, (done) => {
      rec.done = done;
      rec.link?.classList.toggle('done', done);
    });
    rec.section = built.section;
    if (anchor) anchor.parentNode.insertBefore(built.section, anchor);
    else body.append(built.section);
    built.update();
    out.push(rec);
  }
  return out;
}
