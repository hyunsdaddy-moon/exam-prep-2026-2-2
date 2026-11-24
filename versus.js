/*
 * 시험 준비 웹앱 — 대결 (#/versus)
 *
 *   지금 참여자(나)와 상대 한 명의 진도를 나란히 그린다. 따로 입력하는 것은 없고 쌓인 기록만 쓴다.
 *
 *   과목 점수   영상 30(본 편수) + 풀이 30(답을 낸 문항) + 정답 40(최근 회차에서 맞힌 문항) — 모두 "전체 대비"
 *               → 무엇을 하든 점수가 내려가지 않는다 (영상·문제가 없는 쪽은 빼고 100점으로 맞춘다)
 *   과목 승패   점수 차가 MARGIN 점을 넘으면 승, 아니면 무승부
 *   이기는 방법 영상 1편·새 문제 1개·틀린 문제 1개가 올려 주는 점수로, 역전에 필요한 가장 적은 개수를 센다
 *   이번 주     월요일 0시 이전 기록만으로 다시 계산한 점수와의 차이
 */

import { el } from './dom.js?v=20261124-2057';
import { loadRecords, getCurrentLearner, getSavedLearners } from './store.js?v=20261124-2057';
import { listLearners, filterRecordsByLearner } from './grade.mjs?v=20261124-2057';
import { computeProgress } from './dashboard.js?v=20261124-2057';
import { avatar, characterOf } from './characters.js?v=20261124-2057';

const MARGIN = 3;
const OPP_KEY = 'examprep.versus.opp';
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => String(Math.round(n));

/** 영상·풀이·정답 → 0~100점. 없는 항목은 빼고 다시 100점으로 맞춘다 */
function scoreOf({ v, w, qT, qA, qC }) {
  const weight = (v ? 30 : 0) + (qT ? 70 : 0);
  if (!weight) return 0;
  return ((v ? (30 * w) / v : 0) + (qT ? (30 * qA + 40 * qC) / qT : 0)) / weight * 100;
}
const rowScore = (r) => scoreOf({ v: r.videos, w: r.watched, qT: r.qTotal, qA: r.answered, qC: r.correct });
const sumOf = (subjects) => subjects.reduce((a, x) => ({ v: a.v + x.v, w: a.w + x.w, qT: a.qT + x.qT, qA: a.qA + x.qA, qC: a.qC + x.qC }), { v: 0, w: 0, qT: 0, qA: 0, qC: 0 });

/** need 점을 올리는 가장 적은 일거리. { parts: [글], items, ok } */
function plan(x, need) {
  const weight = (x.v ? 30 : 0) + (x.qT ? 70 : 0);
  if (!weight || need <= 0) return { parts: [], items: 0, ok: need <= 0 };
  const kinds = [
    { left: x.qT - x.qA, gain: x.qT ? (70 / x.qT / weight) * 100 : 0, text: (n) => `새 문제 ${n}개 맞히기` },
    { left: x.v - x.w, gain: x.v ? (30 / x.v / weight) * 100 : 0, text: (n) => `영상 ${n}편 보기` },
    { left: Math.max(0, x.qA - x.qC), gain: x.qT ? (40 / x.qT / weight) * 100 : 0, text: (n) => `틀린 문제 ${n}개 다시 맞히기` },
  ].filter((k) => k.left > 0 && k.gain > 0).sort((a, b) => b.gain - a.gain);
  let rest = need;
  let items = 0;
  const parts = [];
  for (const k of kinds) {
    if (rest <= 1e-9) break;
    const n = Math.min(k.left, Math.ceil(rest / k.gain - 1e-9));
    rest -= n * k.gain;
    items += n;
    parts.push(k.text(n));
  }
  return { parts, items, ok: rest <= 1e-9 };
}

/** 그 과목에서 할 일이 가장 많이 남은 단원 */
function nextUnit(x) {
  let best = null;
  for (const r of x.rows) {
    const left = (r.videos - r.watched) + (r.qTotal - r.answered) + Math.max(0, r.answered - r.correct);
    if (left > 0 && (!best || left > best.left)) best = { r, left };
  }
  return best?.r || null;
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 최근 7일, 날마다 { 영상 표시 수, 푼 문항 수 } */
function activity(records, learner, days) {
  const map = new Map(days.map((d) => [d, { video: 0, quiz: 0 }]));
  const seen = new Set();
  for (const r of filterRecordsByLearner(records, learner)) {
    const t = Date.parse(r.at);
    if (!t) continue;
    const slot = map.get(dayKey(new Date(t)));
    if (!slot) continue;
    if (r.type === 'attempt' && r.id && !seen.has(r.id)) {
      seen.add(r.id);
      slot.quiz += 1;
    } else if (r.type === 'read' && /^v:.+:[1-5]$/.test(String(r.concept))) slot.video += 1;
  }
  return days.map((d) => map.get(d));
}

/** 점수판의 큰 캐릭터 — 권투 자세 그림(오른쪽을 봄). 상대는 좌우로 뒤집어 서로 마주 보게 한다 */
function face(name, flip) {
  const c = characterOf(name);
  if (!c) return avatar(name, 'md');
  const img = el(`img.vs-face${flip ? '.flip' : ''}`, { src: `assets/characters/${c.id}-box.webp?v=1`, alt: `${c.name} (권투)`, title: c.name, decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(avatar(name, 'md')));
  return img;
}

function tug(icon, label, a, b, total, unit) {
  const pa = total ? Math.min(100, (a / total) * 100) : 0;
  const pb = total ? Math.min(100, (b / total) * 100) : 0;
  return el('div.vs-tug', { title: `${label}: ${a} 대 ${b} (전체 ${total}${unit})` },
    el('span.vs-tug-num.a', { text: String(a) }),
    el('span.vs-tug-bar.a', {}, el('i', { style: `width:${pa}%` })),
    el('span.vs-tug-mid', {}, el('b', { text: icon }), el('small', { text: `${label} ${total}${unit}` })),
    el('span.vs-tug-bar.b', {}, el('i', { style: `width:${pb}%` })),
    el('span.vs-tug-num.b', { text: String(b) })
  );
}

export async function renderVersus(ctx, exam) {
  document.title = `대결 — ${exam.title}`;
  ctx.setNav('versus');
  const me = getCurrentLearner();
  const loaded = await loadRecords();
  const records = loaded.records;
  const others = listLearners(records, getSavedLearners()).filter((n) => n !== me);

  if (!others.length) {
    return ctx.show(
      el('section.hero', {},
        el('p.eyebrow', { text: '대결' }),
        el('h1', { text: '상대가 아직 없습니다' }),
        el('p.sub', { text: '오른쪽 위 참여자 칸에서 두 번째 참여자를 만들고 영상을 보거나 문제를 풀면 대결이 시작됩니다.' })
      )
    );
  }

  let opp = null;
  try { opp = localStorage.getItem(OPP_KEY); } catch { /* 저장 공간을 못 쓰는 브라우저 */ }
  if (!others.includes(opp)) opp = others[0];

  // 이번 주 월요일 0시
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const before = records.filter((r) => !(Date.parse(r?.at) >= monday.getTime()));

  const hasWork = (x) => x.v || x.qT;
  const [A, B, A0, B0] = (await Promise.all([
    computeProgress(ctx, exam, records, me),
    computeProgress(ctx, exam, records, opp),
    computeProgress(ctx, exam, before, me),
    computeProgress(ctx, exam, before, opp),
  ])).map((list) => list.filter(hasWork));

  const pairs = A.map((a, i) => {
    const b = B[i];
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    const diff = sa - sb;
    return { a, b, sa, sb, diff, win: diff > MARGIN ? 'a' : diff < -MARGIN ? 'b' : 'draw' };
  });
  const winsA = pairs.filter((p) => p.win === 'a').length;
  const winsB = pairs.filter((p) => p.win === 'b').length;
  const draws = pairs.length - winsA - winsB;
  const totalA = scoreOf(sumOf(A));
  const totalB = scoreOf(sumOf(B));
  const weekA = totalA - scoreOf(sumOf(A0));
  const weekB = totalB - scoreOf(sumOf(B0));

  /* ── 이기는 방법 ── */
  const missions = [];
  const unitHref = (x) => {
    const r = nextUnit(x);
    return r ? { href: `#/s/${x.s.code}/${r.index}`, title: r.doc.title } : { href: `#/s/${x.s.code}`, title: x.s.subject };
  };
  const attack = pairs.filter((p) => p.win !== 'a')
    .map((p) => ({ p, plan: plan(p.a, MARGIN - p.diff + 0.01) }))
    .filter((m) => m.plan.items > 0)
    .sort((x, y) => x.plan.items - y.plan.items);
  for (const { p, plan: pl } of attack.slice(0, 3)) {
    const u = unitHref(p.a);
    const state = p.win === 'draw' ? `무승부(${p.diff >= 0 ? '+' : ''}${r1(p.diff)}점)` : `${r1(-p.diff)}점 뒤짐`;
    missions.push(el('a.vs-mission.attack', { href: u.href },
      el('span.vs-mission-tag', { text: p.win === 'draw' ? '승부 가르기' : '역전 미션' }),
      el('b', { text: `${p.a.s.subject} · ${state}` }),
      el('p', { text: pl.ok ? `${pl.parts.join(' + ')} → 이 과목을 가져옵니다.` : `${pl.parts.join(' + ')}까지 하면 최대한 따라붙습니다.` }),
      el('small', { text: `추천 단원: ${u.title} →` })
    ));
  }
  const defend = pairs.filter((p) => p.win === 'a')
    .map((p) => ({ p, plan: plan(p.b, p.diff - MARGIN + 0.01) }))
    .filter((m) => m.plan.items > 0 && m.plan.ok)
    .sort((x, y) => x.plan.items - y.plan.items)[0];
  if (defend) {
    const u = unitHref(defend.p.a);
    missions.push(el('a.vs-mission.defend', { href: u.href },
      el('span.vs-mission-tag', { text: '수비 미션' }),
      el('b', { text: `${defend.p.a.s.subject} · ${r1(defend.p.diff)}점 앞섬` }),
      el('p', { text: `${opp} 님이 ${defend.plan.parts.join(' + ')}만 하면 무승부가 됩니다. 먼저 더 벌려 두세요.` }),
      el('small', { text: `추천 단원: ${u.title} →` })
    ));
  }
  const empty = [];
  pairs.forEach((p) => p.a.rows.forEach((r, i) => {
    if (rowScore(r) === 0 && rowScore(p.b.rows[i]) === 0) empty.push({ s: p.a.s, r });
  }));
  if (empty.length) {
    const pick = empty.slice(0, 3);
    missions.push(el('div.vs-mission.land', {},
      el('span.vs-mission-tag', { text: '빈 땅 미션' }),
      el('b', { text: `아무도 안 건드린 단원 ${empty.length}곳` }),
      el('p', { text: '먼저 영상을 보거나 문제를 풀면 내 땅이 됩니다.' }),
      el('div.vs-mission-links', {}, pick.map((e) => el('a', { href: `#/s/${e.s.code}/${e.r.index}`, text: `${e.s.subject} · ${e.r.doc.title}` })))
    ));
  }
  if (!missions.length) missions.push(el('div.vs-mission.defend', {}, el('b', { text: '모든 과목을 끝냈습니다' }), el('p', { text: '더 올릴 점수가 없습니다. 대단해요!' })));

  /* ── 최근 7일 ── */
  const days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return dayKey(d);
  });
  const actA = activity(records, me, days);
  const actB = activity(records, opp, days);
  const actMax = Math.max(1, ...[...actA, ...actB].map((x) => x.video + x.quiz));
  const actBar = (x, side) => {
    const n = x.video + x.quiz;
    return el(`span.vs-act-bar.${side}`, { style: `height:${Math.max(n ? 6 : 2, (n / actMax) * 100)}%`, title: `영상 ${x.video} · 문제 ${x.quiz}` }, n ? el('em', { text: String(n) }) : null);
  };
  const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

  const select = el('select.learner-select', { 'aria-label': '상대 고르기' }, others.map((n) => el('option', { value: n, text: n })));
  select.value = opp;
  select.addEventListener('change', () => {
    try { localStorage.setItem(OPP_KEY, select.value); } catch { /* 무시 */ }
    window.dispatchEvent(new Event('versus-opp')); // 머리말 아래 대결 띠도 같은 상대로
    void renderVersus(ctx, exam);
  });

  const lead = totalA - totalB;
  const headline = winsA > winsB ? `${me} 님이 앞서고 있어요` : winsA < winsB ? `${opp} 님이 앞서고 있어요` : '팽팽합니다';
  const weekLine = Math.abs(weekA - weekB) < 0.05
    ? `이번 주에 올린 점수가 같습니다 (+${r1(weekA)}점)`
    : `이번 주 승부: ${weekA > weekB ? me : opp} 님 우세 (${me} +${r1(weekA)}점 · ${opp} +${r1(weekB)}점)`;

  ctx.show(
    el('section.hero.vs-hero', {},
      el('p.eyebrow', { text: '대결' }),
      el('div.vs-board', {},
        el('div.vs-player.a', {}, face(me), el('b', { text: me }), el('span', { text: `종합 ${fmt(totalA)}점` })),
        el('div.vs-score', {}, el('span.a', { text: String(winsA) }), el('i', { text: ':' }), el('span.b', { text: String(winsB) }),
          el('small', { text: `과목 승${draws ? ` · 무승부 ${draws}` : ''}` })),
        el('div.vs-player.b', {}, face(opp, true), el('b', { text: opp }), el('span', { text: `종합 ${fmt(totalB)}점` }))
      ),
      el('p.sub', { text: `${headline} · 종합 ${lead >= 0 ? '+' : ''}${r1(lead)}점` }),
      el('p.vs-week', { text: weekLine }),
      others.length > 1 ? el('div.vs-opp', {}, '상대 ', select) : null,
      !loaded.ok ? el('p.save-warn', { text: '서버에서 기록을 읽지 못했습니다. 이 브라우저에 보관된 것만 보입니다.' }) : null
    ),
    el('div.wrap', {},
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '이기는 방법' }), el('p', { text: `${me} 님이 가장 적은 노력으로 과목을 가져올 수 있는 순서입니다.` })),
        el('div.vs-missions', {}, missions)
      ),
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '과목별 줄다리기' }), el('p', { text: `왼쪽 ${me} · 오른쪽 ${opp}. 막대가 길수록 많이 한 것입니다.` })),
        el('div.vs-subjects', {}, pairs.map((p) => el('section.vs-subject', {},
          el('div.vs-subject-head', {},
            el('span.vs-pt.a', { text: fmt(p.sa) }),
            el('h3', {}, el('a', { href: `#/s/${p.a.s.code}`, text: p.a.s.subject }),
              el(`span.vs-badge.${p.win}`, { text: p.win === 'draw' ? '무승부' : `${p.win === 'a' ? me : opp} 우세` })),
            el('span.vs-pt.b', { text: fmt(p.sb) })
          ),
          p.a.v ? tug('🎬', '영상', p.a.w, p.b.w, p.a.v, '편') : null,
          p.a.qT ? tug('📝', '푼 문제', p.a.qA, p.b.qA, p.a.qT, '개') : null,
          p.a.qT ? tug('🎯', '맞힌 문제', p.a.qC, p.b.qC, p.a.qT, '개') : null
        )))
      ),
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '단원 땅따먹기' }), el('p', { text: '한 칸이 한 단원입니다. 그 단원 점수가 높은 사람의 색으로 칠합니다. 칸을 누르면 그 단원으로 갑니다.' })),
        el('div.vs-legend', {}, el('span.a', { text: me }), el('span.b', { text: opp }), el('span.draw', { text: '동점' }), el('span.none', { text: '빈 땅' })),
        el('div.vs-land', {}, pairs.map((p) => el('div.vs-land-row', {},
          el('span.vs-land-name', { text: p.a.s.subject }),
          el('div.vs-land-cells', {}, p.a.rows.map((r, i) => {
            const x = rowScore(r);
            const y = rowScore(p.b.rows[i]);
            const kind = !x && !y ? 'none' : Math.abs(x - y) < 0.05 ? 'draw' : x > y ? 'a' : 'b';
            return el(`a.vs-cell.${kind}`, { href: `#/s/${p.a.s.code}/${r.index}`, title: `${r.doc.title} — ${me} ${fmt(x)}점 · ${opp} ${fmt(y)}점` },
              el('span', { text: r.doc.title }), el('small', { text: `${fmt(x)} : ${fmt(y)}` }));
          }))
        )))
      ),
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '최근 7일' }), el('p', { text: '날마다 본 영상 수와 푼 문제 수를 더한 것입니다.' })),
        el('div.vs-act', {}, days.map((d, i) => el('div.vs-act-day', {},
          el('div.vs-act-bars', {}, actBar(actA[i], 'a'), actBar(actB[i], 'b')),
          el('span', { text: i === 6 ? '오늘' : WEEKDAY[new Date(`${d}T00:00:00`).getDay()] })
        )))
      ),
      el('p.vs-note', { text: `점수 = 영상 30(본 편수) + 풀이 30(답을 낸 문항) + 정답 40(가장 최근 회차에서 맞힌 문항), 모두 전체 대비입니다. 과목 점수 차가 ${MARGIN}점 이하면 무승부입니다.` })
    )
  );
}

/* ── 머리말 아래 대결 띠 — 모든 화면에서 과목별 줄다리기를 한 줄로 보여 준다 ── */
const BAR_CACHE = 'examprep.versus.bar';
let barRun = 0;

function paintBar(host, d, onPick) {
  const wins = (side) => d.subjects.filter((s) => s.win === side).length;
  let who = el('b.b', { text: d.opp });
  if (d.others.length > 1) {
    who = el('select.vsbar-select', { 'aria-label': '대결 상대 고르기', title: '대결 상대 고르기' }, d.others.map((n) => el('option', { value: n, text: n })));
    who.value = d.opp;
    who.addEventListener('change', () => {
      try { localStorage.setItem(OPP_KEY, who.value); } catch { /* 무시 */ }
      onPick?.();
    });
  }
  host.replaceChildren(el('div.vsbar-inner', {},
    el('div.vsbar-who', {},
      el('a.vsbar-score', { href: '#/versus', title: '대결 페이지 열기' },
        el('b.a', { text: String(wins('a')) }), el('i', { text: ':' }), el('b.b', { text: String(wins('b')) })),
      el('span.vsbar-names', {}, el('b.a', { text: d.me }), el('i', { text: 'vs' }), who)
    ),
    el('div.vsbar-list', {}, d.subjects.map((s) => {
      const state = s.win === 'draw' ? '무승부' : `${s.win === 'a' ? d.me : d.opp} 우세`;
      return el(`a.vsbar-item.${s.win}`, { href: '#/versus', title: `${s.subject}: ${d.me} ${s.sa}점 · ${d.opp} ${s.sb}점 (${state})` },
        el('span.vsbar-top', {}, el('b.a', { text: String(s.sa) }), el('span', { text: s.subject }), el('b.b', { text: String(s.sb) })),
        el('span.vsbar-rope', {}, el('span.a', {}, el('i', { style: `width:${Math.min(100, s.sa)}%` })), el('span.b', {}, el('i', { style: `width:${Math.min(100, s.sb)}%` })))
      );
    }))
  ));
  host.dataset.key = `${d.me}|${d.opp}`;
  host.hidden = false;
}

export async function renderVersusBar(ctx, exam, host, onPick) {
  if (!host) return;
  const run = ++barRun;
  const me = getCurrentLearner();
  let opp = null;
  let cached = null;
  try {
    opp = localStorage.getItem(OPP_KEY);
    cached = JSON.parse(localStorage.getItem(BAR_CACHE) || 'null');
  } catch { /* 저장 공간을 못 쓰는 브라우저 */ }
  // 지난번에 그린 것을 먼저 보여 주고(자리 흔들림 방지) 기록을 읽은 뒤 고쳐 그린다
  const fresh = cached && cached.me === me && (!opp || cached.opp === opp);
  if (fresh && host.dataset.key !== `${cached.me}|${cached.opp}`) paintBar(host, cached, onPick);
  else if (!fresh && host.dataset.key && !host.dataset.key.startsWith(`${me}|`)) host.hidden = true;

  const records = (await loadRecords()).records;
  if (run !== barRun) return;
  const others = listLearners(records, getSavedLearners()).filter((n) => n !== me);
  if (!others.length) {
    host.hidden = true;
    host.replaceChildren();
    delete host.dataset.key;
    return;
  }
  if (!others.includes(opp)) opp = others[0];
  const hasWork = (x) => x.v || x.qT;
  const [A, B] = (await Promise.all([computeProgress(ctx, exam, records, me), computeProgress(ctx, exam, records, opp)])).map((list) => list.filter(hasWork));
  if (run !== barRun) return;
  const d = {
    me, opp, others,
    subjects: A.map((a, i) => {
      const sa = scoreOf(a);
      const sb = scoreOf(B[i]);
      const diff = sa - sb;
      return { subject: a.s.subject, sa: Math.round(sa), sb: Math.round(sb), win: diff > MARGIN ? 'a' : diff < -MARGIN ? 'b' : 'draw' };
    }),
  };
  try { localStorage.setItem(BAR_CACHE, JSON.stringify(d)); } catch { /* 무시 */ }
  paintBar(host, d, onPick);
}
