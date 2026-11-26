/*
 * 시험 준비 웹앱 — 수준 평가 (1차 진단평가 → 공부 → 2차 성취평가)
 *
 *   #/assess                              평가 홈: 응시 현황 · 내 성장 그래프 · 경쟁자 비교 · 순위표
 *   #/assess/<d1|d2>/<과목>               응시 (실전과 같은 화면, 시간 제한)
 *   #/assess/<d1|d2>/<과목>/result/<id>   결과
 *
 * 문항: data/assess/<과목 코드>.json  { rounds: { d1: {groups, questions}, d2: {...} } }
 * 기록: attempt·session 의 mode 'assess', session.round 1(1차) · 2(2차).
 * 점수는 과목·회차마다 「처음 응시한 것」으로 센다 — 진단은 한 번이 의미가 있으므로.
 */

import { el, newId } from './dom.js?v=20261126-1051';
import { loadRecords, getCurrentLearner, getSavedLearners } from './store.js?v=20261126-1051';
import { enterLearner } from './lock.js?v=20261126-1051';
import { mergeRecords, recordLearner, listLearners, summarize } from './grade.mjs?v=20261126-1051';
import { runExam, renderResult, readExamState } from './solve.js?v=20261126-1051';
import { avatar } from './characters.js?v=20261126-1051';

export const ROUNDS = [
  { id: 'd1', n: 1, title: '1차 진단평가', short: '1차', note: '지금 실력을 재는 첫 시험' },
  { id: 'd2', n: 2, title: '2차 성취평가', short: '2차', note: '공부한 뒤 다시 보는 같은 수준의 시험' },
];
const roundById = (id) => ROUNDS.find((r) => r.id === id);
const roundByNo = (n) => ROUNDS.find((r) => r.n === n);
const MINUTES = 25;

/** 그래프 색 — 1차·2차는 같은 파랑의 옅음·짙음, 나·경쟁자는 파랑·주황 (dataviz 검사 통과) */
const COLOR = { d1: '#8fbaf0', d2: '#0071e3', me: '#0071e3', rival: '#d9730d' };
/** 경쟁자들 색 — 나(파랑) 다음으로 주황·초록·보라·분홍·청록 순 */
const RIVAL_COLORS = ['#d9730d', '#2e9d5b', '#8e5bd0', '#d6457a', '#1a9aa0', '#8a8f98'];

const papers = new Map();
function loadAssess(ctx, code) {
  if (!papers.has(code)) {
    papers.set(code, ctx.getJson(`data/assess/${code}.json`).then(
      (d) => d,
      (err) => {
        papers.delete(code);
        throw err;
      }
    ));
  }
  return papers.get(code);
}

async function paperOf(ctx, code, roundId) {
  const d = await loadAssess(ctx, code);
  const r = d.rounds?.[roundId];
  if (!r) return null;
  return { questions: r.questions || [], groups: new Map((r.groups || []).map((g) => [g.id, g])) };
}

/** 모든 참여자의 과목·회차별 첫 응시 점수 */
async function loadScores(ctx, subjects) {
  const loaded = await loadRecords();
  const merged = mergeRecords(loaded.records);
  const all = new Map(); // `${code}/${round}` → paper
  await Promise.all(
    subjects.flatMap((s) => ROUNDS.map(async (r) => {
      try {
        all.set(`${s.code}/${r.id}`, await paperOf(ctx, s.code, r.id));
      } catch {
        all.set(`${s.code}/${r.id}`, null);
      }
    }))
  );
  const scores = new Map(); // 이름 → { d1: {code: {...}}, d2: {...} }
  const sessions = [...merged.sessions.values()].filter((x) => x.mode === 'assess').sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const sess of sessions) {
    const r = roundByNo(sess.round);
    const paper = all.get(`${sess.subject}/${r?.id}`);
    if (!r || !paper) continue;
    const name = recordLearner(sess);
    if (!scores.has(name)) scores.set(name, { d1: {}, d2: {} });
    const mine = scores.get(name)[r.id];
    if (mine[sess.subject]) {
      mine[sess.subject].tries++;
      mine[sess.subject].lastSession = sess.session;
      continue; // 첫 응시만 센다
    }
    const sum = summarize(paper.questions, merged.attempts.filter((a) => a.session === sess.session));
    mine[sess.subject] = { score: sum.earned, max: sum.max, correct: sum.choice.correct, count: sum.choice.count, session: sess.session, lastSession: sess.session, at: sess.at, tries: 1 };
  }
  const names = listLearners(loaded.records, [...getSavedLearners(), getCurrentLearner()]);
  for (const n of scores.keys()) if (!names.includes(n)) names.push(n);
  return { ok: loaded.ok, scores, names, papers: all };
}

const emptyScore = () => ({ d1: {}, d2: {} });
/** 평균. both 를 주면 두 쪽 모두 점수가 있는 과목만 센다(공정한 비교) */
function average(byCode, subjects, both = null) {
  const vals = subjects.filter((s) => !both || typeof both[s.code]?.score === 'number').map((s) => byCode[s.code]?.score).filter((v) => typeof v === 'number');
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
}
const fmt = (v) => (v == null ? '–' : String(v));
function deltaText(a, b) {
  if (a == null || b == null) return null;
  const d = Math.round((b - a) * 10) / 10;
  return { d, text: d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${Math.abs(d)}` : '― 0', cls: d > 0 ? 'up' : d < 0 ? 'down' : 'same' };
}

/* ── SVG 막대그래프 ─────────────────────────────────────────── */
const SVG = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}

/** 위 모서리만 둥근 막대 (아래는 기준선에 붙는다) */
function barPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * 묶음 막대그래프. categories: [{label, sub?}], series: [{name, color, values: [숫자|null]}]
 * 값 글자는 막대 위에 검은 글씨로, 빈 값은 「미응시」로 적는다.
 */
function groupedBars(categories, series, { max = 100, height = 300 } = {}) {
  const W = Math.max(560, categories.length * (series.length * (series.length > 2 ? 22 : 34) + 40));
  const top = 26, bottom = 54, left = 34, right = 8;
  const H = height;
  const plotH = H - top - bottom;
  const band = (W - left - right) / categories.length;
  const gap = 2;
  const barW = Math.min(36, (band - 22 - gap * (series.length - 1)) / series.length);
  const y = (v) => top + plotH - (Math.max(0, Math.min(max, v)) / max) * plotH;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (const t of [0, 25, 50, 75, 100]) {
    svg.append(
      s('line', { x1: left, x2: W - right, y1: y(t), y2: y(t), class: t === 0 ? 'axis' : 'grid' }),
      s('text', { x: left - 6, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, String(t))
    );
  }
  categories.forEach((c, i) => {
    const groupW = series.length * barW + (series.length - 1) * gap;
    const x0 = left + band * i + (band - groupW) / 2;
    series.forEach((ser, k) => {
      const v = ser.values[i];
      const x = x0 + k * (barW + gap);
      if (typeof v === 'number') {
        const yy = y(v);
        svg.append(
          s('path', { d: barPath(x, yy, barW, top + plotH - yy) || `M${x},${top + plotH - 1.5}h${barW}v1.5h${-barW}Z`, fill: ser.color, class: 'bar' },
            s('title', {}, `${c.label} · ${ser.name} ${v}점`)),
          s('text', { x: x + barW / 2, y: yy - 6, class: 'val', 'text-anchor': 'middle' }, String(v))
        );
      } else {
        svg.append(s('text', { x: x + barW / 2, y: top + plotH - 6, class: 'none', 'text-anchor': 'middle' }, '–'));
      }
    });
    svg.append(s('text', { x: left + band * i + band / 2, y: top + plotH + 20, class: 'cat', 'text-anchor': 'middle' }, c.label));
    if (c.sub) svg.append(s('text', { x: left + band * i + band / 2, y: top + plotH + 40, class: `delta ${c.subCls || ''}`, 'text-anchor': 'middle' }, c.sub));
  });
  const legend = el('div.chart-legend', {}, series.map((ser) => el('span', {}, el('i', { style: `background:${ser.color}` }), ser.name)));
  return el('figure.chart-box', {}, legend, el('div.chart-scroll', {}, svg));
}

/* ── 평가 홈 ─────────────────────────────────────────── */
async function renderAssessHome(ctx, exam, query) {
  const subjects = exam.subjects;
  document.title = `수준 평가 — ${exam.title}`;
  ctx.setNav('assess');
  const data = await loadScores(ctx, subjects);
  const me = getCurrentLearner();
  const mine = data.scores.get(me) || emptyScore();
  const others = data.names.filter((n) => n !== me);
  const rival = others.includes(query.get('vs')) ? query.get('vs') : others[0] || null;
  const cmpRound = roundById(query.get('r')) ? query.get('r') : (rival && Object.keys((data.scores.get(rival) || emptyScore()).d2).length && Object.keys(mine.d2).length ? 'd2' : 'd1');

  const go = (params) => {
    const q = new URLSearchParams({ ...(rival ? { vs: rival } : {}), r: cmpRound, ...params });
    location.hash = `#/assess?${q}`;
  };

  /* 응시 카드 */
  const roundBlock = (r) =>
    el('section.section', {},
      el('div.section-head', {}, el('h2', { text: r.title }), el('p', { text: `${r.note} · 과목마다 12문항 100점 · ${MINUTES}분` })),
      el('div.grid.tight', {},
        subjects.map((sub) => {
          const got = mine[r.id][sub.code];
          const hasPaper = !!data.papers.get(`${sub.code}/${r.id}`);
          const locked = r.id === 'd2' && !mine.d1[sub.code];
          const inProgress = readExamState(sub.code, assessKey(r.id, sub.code));
          const prev = r.id === 'd2' ? mine.d1[sub.code]?.score : null;
          const dl = got && prev != null ? deltaText(prev, got.score) : null;
          return el(`div.card.assess-card${got ? '.done' : ''}`, {},
            el('div.assess-top', {}, el('h3', { text: sub.subject }), got ? el('span.badge.graduated', { text: got.tries > 1 ? `${got.tries}차 완료` : '응시 완료' }) : locked ? el('span.badge.waiting', { text: '1차 먼저' }) : null),
            got
              ? el('div.assess-score', {}, el('b', { text: String(got.score) }), el('small', { text: ' / 100점' }), dl ? el(`span.delta.${dl.cls}`, { text: dl.text }) : null)
              : el('p.meta', { text: !hasPaper ? '문제 준비 중' : locked ? '1차 진단평가를 먼저 보면 열립니다.' : inProgress ? '풀던 시험이 있습니다.' : '아직 응시하지 않았습니다.' }),
            el('div.hero-actions.left', {},
              got
                ? [
                    el(`a.pill.small${inProgress ? '' : '.ghost'}`, { href: `#/assess/${r.id}/${sub.code}`, text: inProgress ? '이어서 풀기' : `${(got.tries || 1) + 1}차 재시험 시도` }),
                    el('a.pill.ghost.small', { href: `#/assess/${r.id}/${sub.code}/result/${got.lastSession || got.session}`, text: got.tries > 1 ? '최근 결과' : '결과 보기' }),
                  ]
                : hasPaper && !locked
                  ? el('a.pill.small', { href: `#/assess/${r.id}/${sub.code}`, text: inProgress ? '이어서 풀기' : '응시하기' })
                  : null
            )
          );
        })
      )
    );

  /* 내 성장 그래프 */
  const cats = [...subjects.map((sub) => {
    const dl = deltaText(mine.d1[sub.code]?.score, mine.d2[sub.code]?.score);
    return { label: sub.subject, sub: dl?.text, subCls: dl?.cls };
  })];
  // 평균은 1·2차를 모두 본 과목끼리만 — 본 과목 수가 달라 생기는 착시를 막는다
  const all1 = average(mine.d1, subjects);
  const avg1 = average(mine.d1, subjects, mine.d2);
  const avg2 = average(mine.d2, subjects, mine.d1);
  const avgDl = deltaText(avg1, avg2);
  const nBoth = subjects.filter((x) => mine.d1[x.code] && mine.d2[x.code]).length;
  cats.push({ label: '평균', sub: avgDl?.text, subCls: avgDl?.cls });
  const growth = el('section.section', {},
    el('div.section-head', {},
      el('h2', { text: `${me}의 성장 그래프` }),
      el('p', { text: all1 == null ? '1차 진단평가를 보면 여기에 점수가 그려집니다.' : avg2 == null ? `1차 평균 ${all1}점. 공부한 뒤 2차 성취평가를 보면 얼마나 올랐는지 나란히 보입니다.` : `1·2차를 모두 본 ${nBoth}과목 평균 ${avg1}점 → ${avg2}점 (${avgDl.text}점)` })
    ),
    groupedBars(cats, [
      { name: '1차 진단평가', color: COLOR.d1, values: [...subjects.map((sub) => mine.d1[sub.code]?.score ?? null), avg2 == null ? all1 : avg1] },
      { name: '2차 성취평가', color: COLOR.d2, values: [...subjects.map((sub) => mine.d2[sub.code]?.score ?? null), avg2] },
    ])
  );

  /* 경쟁자 비교 — 나와 다른 참여자 모두를 한 그래프에 나란히 */
  let compare;
  if (!others.length) {
    compare = el('section.section', {},
      el('div.section-head', {}, el('h2', { text: '경쟁자와 비교' }), el('p', { text: '홈 화면의 「참여자별 진도율」에서 다른 참여자를 추가하면 점수를 나란히 비교할 수 있습니다.' })),
      el('a.pill.ghost', { href: '#/', text: '참여자 추가하러 가기' })
    );
  } else {
    const people = [me, ...others];
    const colorOf = (i) => (i === 0 ? COLOR.me : RIVAL_COLORS[(i - 1) % RIVAL_COLORS.length]);
    const shown = new Set(people);
    const roundSeg = el('div.segment', { role: 'group', 'aria-label': '비교할 회차' },
      ROUNDS.map((r) => el('button', { type: 'button', text: r.short, 'aria-pressed': String(r.id === cmpRound), onclick: () => go({ r: r.id }) }))
    );
    const avgOf = (name) => average((data.scores.get(name) || emptyScore())[cmpRound], subjects);
    const summary = el('p');
    const chartBox = el('div');
    const draw = () => {
      const list = people.filter((n) => shown.has(n));
      const ranked = list.map((n) => ({ n, a: avgOf(n) })).filter((x) => x.a != null).sort((a, b) => b.a - a.a);
      summary.textContent = ranked.length
        ? `${roundById(cmpRound).title} 평균(본 과목 기준) — ${ranked.map((x, i) => `${i + 1}위 ${x.n} ${x.a}점`).join(' · ')}`
        : `${roundById(cmpRound).title} 점수를 과목별로 나란히 봅니다. 응시한 과목부터 막대가 생깁니다.`;
      chartBox.replaceChildren(groupedBars(
        [...subjects.map((sub) => ({ label: sub.subject })), { label: '평균' }],
        list.map((name) => {
          const sc = (data.scores.get(name) || emptyScore())[cmpRound];
          return { name: name === me ? `${name}(나)` : name, color: colorOf(people.indexOf(name)), values: [...subjects.map((sub) => sc[sub.code]?.score ?? null), avgOf(name)] };
        })
      ));
    };
    const chips = el('div.compare-people', { role: 'group', 'aria-label': '그래프에 보일 사람' },
      people.map((name, i) => {
        const box = el('input', { type: 'checkbox', checked: true, onchange: () => {
          if (box.checked) shown.add(name);
          else if (shown.size > 1) shown.delete(name);
          else box.checked = true; // 한 명은 남겨 둔다
          draw();
        } });
        return el('label.person-chip', {}, box, el('i', { style: `background:${colorOf(i)}` }), name === me ? `${name}(나)` : name);
      })
    );
    draw();
    compare = el('section.section', {},
      el('div.section-head', {}, el('h2', { text: '경쟁자와 비교' }), summary),
      el('div.compare-controls', {}, chips, roundSeg),
      chartBox
    );
  }

  /* 순위표 (그래프의 표 보기도 겸한다) */
  const rows = data.names.map((name) => {
    const sc = data.scores.get(name) || emptyScore();
    const a1 = average(sc.d1, subjects);
    const a2 = average(sc.d2, subjects);
    return { name, a1, a2, n1: Object.keys(sc.d1).length, n2: Object.keys(sc.d2).length, dl: deltaText(a1, a2), sc };
  }).sort((a, b) => (b.a2 ?? -1) - (a.a2 ?? -1) || (b.a1 ?? -1) - (a.a1 ?? -1));
  const board = el('section.section', {},
    el('div.section-head', {}, el('h2', { text: '순위표' }), el('p', { text: '2차 평균이 높은 순, 같으면 1차 평균 순입니다. 이름을 누르면 그 참여자로 바뀝니다.' })),
    el('div.table-scroll', {},
      el('table.rank-table', {},
        el('thead', {}, el('tr', {}, el('th', { text: '순위' }), el('th', { text: '이름' }), el('th', { text: '1차 평균' }), el('th', { text: '2차 평균' }), el('th', { text: '변화' }),
          subjects.map((sub) => el('th', { text: sub.subject })))),
        el('tbody', {}, rows.map((r, i) =>
          el(`tr${r.name === me ? '.me' : ''}`, {},
            el('td', { text: r.a1 == null && r.a2 == null ? '–' : String(i + 1) }),
            el('td', {}, avatar(r.name, 'xs'), ' ', el('button.link', { type: 'button', text: r.name, onclick: async () => {
              if (await enterLearner(r.name)) go({ vs: r.name === rival ? me : rival || '' });
            } })),
            el('td', { text: r.a1 == null ? '–' : `${r.a1} (${r.n1}과목)` }),
            el('td', { text: r.a2 == null ? '–' : `${r.a2} (${r.n2}과목)` }),
            el('td', {}, r.dl ? el(`span.delta.${r.dl.cls}`, { text: r.dl.text }) : '–'),
            subjects.map((sub) => el('td', { text: `${fmt(r.sc.d1[sub.code]?.score)} → ${fmt(r.sc.d2[sub.code]?.score)}` }))
          )
        ))
      )
    )
  );

  ctx.show(
    el('section.hero', {},
      el('p.eyebrow', { text: `${me} · 수준 평가` }),
      el('h1', { text: '1차 진단 → 2차 성취' }),
      el('p.sub', { text: '처음 실력을 재고, 공부한 뒤 같은 수준의 시험으로 다시 재서 얼마나 올랐는지 봅니다.' }),
      !data.ok ? el('p.save-warn', { text: '서버에서 기록을 읽지 못했습니다. 이 브라우저에 보관된 것만 보입니다.' }) : null
    ),
    el('div.wrap', {}, ...(all1 == null ? [...ROUNDS.map(roundBlock), growth, compare, board] : [growth, compare, board, ...ROUNDS.map(roundBlock)]))
  );
}

/* ── 응시 ─────────────────────────────────────────── */
const assessKey = (roundId, code) => `examprep.assess.${getCurrentLearner()}.${roundId}.${code}`;

async function renderAssessStart(ctx, exam, roundId, subject) {
  const r = roundById(roundId);
  const paper = await paperOf(ctx, subject.code, roundId).catch(() => null);
  if (!paper || !paper.questions.length) return ctx.renderMissing('이 평가 문제는 아직 준비되지 않았습니다.');
  document.title = `${subject.subject} ${r.title} — 시험 준비`;
  ctx.setNav('assess');
  const data = await loadScores(ctx, exam.subjects);
  const mine = data.scores.get(getCurrentLearner()) || emptyScore();
  if (roundId === 'd2' && !mine.d1[subject.code]) return ctx.renderMissing(`${subject.subject} 1차 진단평가를 먼저 보세요.`);
  const done = mine[roundId][subject.code];
  const key = assessKey(roundId, subject.code);
  const saved = readExamState(subject.code, key);
  const limit = MINUTES * 60;
  const begin = (state) => runExam(ctx, subject, paper.questions, paper.groups, limit, state, {
    mode: 'assess',
    key,
    inkScope: `assess.${roundId}.${subject.code}`,
    round: r.n,
    title: `${subject.subject} ${r.title}`,
    paper: { kicker: `${exam.title} · 수준 평가`, kind: r.title, note: `선택형 ${paper.questions.length}문항 · 총 100점 · ${MINUTES}분 · 답 번호를 누르면 표시되고, 한 번 더 누르면 지워집니다.` },
    resultHref: (sid) => `#/assess/${roundId}/${subject.code}/result/${sid}`,
  });
  ctx.show(
    el('section.hero', {},
      el('a.back', { href: '#/assess', text: '수준 평가' }),
      el('p.eyebrow', { text: `${getCurrentLearner()} · ${subject.subject}` }),
      el('h1', { text: r.title }),
      el('p.sub', { text: `${paper.questions.length}문항 · 100점 · ${MINUTES}분` }),
      el('p.scope', { text: done
        ? `이미 ${done.tries}차 응시했습니다(처음 ${done.score}점). 재시험을 볼 수 있지만 그래프와 순위에는 처음 점수가 남습니다.`
        : '시작을 누르면 시간이 흐릅니다. 모든 문제를 풀어야 제출할 수 있고, 제출하면 바로 채점합니다.' }),
      el('div.hero-actions', {},
        saved ? el('button.pill', { type: 'button', text: '풀던 시험 이어서', onclick: () => begin(saved) }) : null,
        el(`button.pill${saved ? '.ghost' : ''}`, { type: 'button', text: saved ? '처음부터 새로' : done ? `${(done.tries || 1) + 1}차 재시험 시도` : '시작', onclick: () => begin({ session: newId('d'), startedAt: Date.now(), answers: {} }) })
      )
    )
  );
}

async function renderAssessResult(ctx, exam, roundId, subject, sessionId) {
  const r = roundById(roundId);
  const paper = await paperOf(ctx, subject.code, roundId).catch(() => null);
  if (!paper) return ctx.renderMissing('이 평가 문제를 찾지 못했습니다.');
  const data = await loadScores(ctx, exam.subjects);
  const me = getCurrentLearner();
  const mine = data.scores.get(me) || emptyScore();
  const first = mine[roundId][subject.code];
  const nextTry = (first?.tries || 1) + 1;
  return renderResult(ctx, subject, sessionId, {
    paper,
    title: `${subject.subject} ${r.title}`,
    backHref: '#/assess',
    backText: '수준 평가',
    extra: (sum) => {
      const notFirst = first && first.session !== sessionId;
      const prev = roundId === 'd2' ? mine.d1[subject.code] : null;
      const dl = prev ? deltaText(prev.score, sum.earned) : null;
      const lines = [];
      if (notFirst) lines.push(`재시험 기록입니다(${first.tries}차). 그래프와 순위에는 처음 점수 ${first.score}점이 남습니다.`);
      if (dl) lines.push(`1차 ${prev.score}점 → 2차 ${sum.earned}점 (${dl.text}점)`);
      const others = data.names.filter((n) => n !== me).map((n) => ({ n, v: data.scores.get(n)?.[roundId][subject.code]?.score })).filter((x) => typeof x.v === 'number');
      if (others.length) lines.push(`같은 시험을 본 다른 참여자: ${others.map((x) => `${x.n} ${x.v}점`).join(' · ')}`);
      return lines.length ? el('div.assess-note', {}, lines.map((t) => el('p', { text: t }))) : null;
    },
    actions: () => [
      el('a.pill', { href: `#/assess/${roundId}/${subject.code}`, text: `${nextTry}차 재시험 시도` }),
      el('a.pill.ghost', { href: '#/assess', text: '성장 그래프 보기' }),
      roundId === 'd1' && paper ? el('a.pill.ghost', { href: `#/s/${subject.code}`, text: `${subject.subject} 공부하러 가기` }) : null,
      roundId === 'd1' ? el('a.pill.ghost', { href: `#/assess/d2/${subject.code}`, text: '2차 성취평가 보기' }) : null,
    ],
  });
}

/** app.js 의 길 찾기에서 부른다. 처리하면 Promise, 아니면 null */
export function renderAssessRoute(ctx, exam, parts, query) {
  if (parts[0] !== 'assess') return null;
  if (parts.length === 1) return renderAssessHome(ctx, exam, query);
  const r = roundById(parts[1]);
  const subject = exam.subjects.find((x) => x.code === parts[2]);
  if (!r || !subject) return ctx.renderMissing('그런 평가가 없습니다.');
  if (parts.length === 3) return renderAssessStart(ctx, exam, r.id, subject);
  if (parts.length === 5 && parts[3] === 'result') return renderAssessResult(ctx, exam, r.id, subject, parts[4]);
  return ctx.renderMissing('주소가 올바르지 않습니다.');
}

/** 오답 노트에 넣을 수준 평가의 틀린 문제 — 같은 문제를 나중에 맞혔으면 뺀다 */
export async function assessWrongs(ctx, subjects, attempts) {
  // 읽기 문서 단원 평가(docquiz, session dqs-…) 기록은 뺀다
  const mine = attempts.filter((a) => a.mode === 'assess' && a.qtype === 'choice' && !String(a.session || '').startsWith('dqs-')).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = new Map();
  for (const a of mine) last.set(a.q, a);
  const out = [];
  for (const sub of subjects) {
    for (const r of ROUNDS) {
      let paper;
      try {
        paper = await paperOf(ctx, sub.code, r.id);
      } catch {
        paper = null;
      }
      if (!paper) continue;
      for (const q of paper.questions) {
        const a = last.get(q.id);
        if (a && a.correct === false) out.push({ subject: sub, round: r, question: q, group: paper.groups.get(q.group) || null, attempt: a });
      }
    }
  }
  return out;
}
