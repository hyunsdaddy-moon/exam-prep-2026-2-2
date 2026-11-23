/*
 * 시험 준비 웹앱 — 단원 평가 (과목마다 단원별 10문항 · 100점 · 15분)
 *
 *   #/units                              단원 평가 홈: 과목 → 단원 카드 (내 점수 · 다른 참여자 점수)
 *   #/units?s=<과목>                      한 과목만
 *   #/units/<과목>/<u1…>                  응시
 *   #/units/<과목>/<u1…>/result/<id>      결과
 *
 * 문항: data/units/<과목 코드>.json  { units: [{ id, title, short, doc, minutes, groups, questions }] }
 * 기록: Firestore 규칙을 바꾸지 않으려고 mode 'assess' 에 round = 10 + 단원 번호(u1 → 11)로 남긴다.
 *       수준 평가(round 1·2)는 그 범위의 기록만 세므로 서로 섞이지 않는다.
 *       단원 평가는 몇 번이든 다시 볼 수 있고, 카드에는 첫 점수 · 최고 점수 · 최근 점수를 보여 준다.
 */

import { el, newId } from './dom.js?v=20261123-1850';
import { loadRecords, getCurrentLearner, getSavedLearners } from './store.js?v=20261123-1850';
import { mergeRecords, recordLearner, listLearners, summarize } from './grade.mjs?v=20261123-1850';
import { runExam, renderResult, readExamState } from './solve.js?v=20261123-1850';

const ROUND_BASE = 10;
const unitNo = (id) => Number(String(id).replace(/^u/, ''));
const unitRound = (id) => ROUND_BASE + unitNo(id);
const unitKey = (code, uid) => `examprep.unit.${getCurrentLearner()}.${code}.${uid}`;

const files = new Map();
function loadUnits(ctx, code) {
  if (!files.has(code)) {
    files.set(code, ctx.getJson(`data/units/${code}.json`).then(
      (d) => (d.units || []).map((u) => ({ ...u, groupsMap: new Map((u.groups || []).map((g) => [g.id, g])) })),
      () => {
        files.delete(code);
        return [];
      }
    ));
  }
  return files.get(code);
}

/** 이름 → `${code}/${uid}` → [{score, session, at}] (오래된 것부터) */
async function loadUnitScores(ctx, subjects) {
  const loaded = await loadRecords();
  const merged = mergeRecords(loaded.records);
  const papers = new Map();
  await Promise.all(subjects.map(async (s) => {
    for (const u of await loadUnits(ctx, s.code)) papers.set(`${s.code}/${unitRound(u.id)}`, u);
  }));
  const scores = new Map();
  const sessions = [...merged.sessions.values()]
    .filter((x) => x.mode === 'assess' && x.round > ROUND_BASE)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const sess of sessions) {
    const u = papers.get(`${sess.subject}/${sess.round}`);
    if (!u) continue;
    const name = recordLearner(sess);
    if (!scores.has(name)) scores.set(name, new Map());
    const key = `${sess.subject}/${u.id}`;
    const list = scores.get(name).get(key) || [];
    const sum = summarize(u.questions, merged.attempts.filter((a) => a.session === sess.session));
    list.push({ score: sum.earned, session: sess.session, at: sess.at });
    scores.get(name).set(key, list);
  }
  const names = listLearners(loaded.records, [...getSavedLearners(), getCurrentLearner()]);
  for (const n of scores.keys()) if (!names.includes(n)) names.push(n);
  return { ok: loaded.ok, scores, names };
}

const statsOf = (list) => (list && list.length
  ? { first: list[0].score, best: Math.max(...list.map((x) => x.score)), last: list.at(-1), tries: list.length }
  : null);

/* ── 홈 ─────────────────────────────────────────── */
async function renderUnitsHome(ctx, exam, query) {
  document.title = `단원 평가 — ${exam.title}`;
  ctx.setNav('units');
  const sel = exam.subjects.some((s) => s.code === query.get('s')) ? query.get('s') : 'all';
  const data = await loadUnitScores(ctx, exam.subjects);
  const me = getCurrentLearner();
  const mine = data.scores.get(me) || new Map();
  const others = data.names.filter((n) => n !== me);

  const shown = exam.subjects.filter((s) => sel === 'all' || s.code === sel);
  const blocks = await Promise.all(shown.map(async (s) => {
    const units = await loadUnits(ctx, s.code);
    if (!units.length) return el('section.section', {}, el('div.section-head', {}, el('h2', { text: s.subject }), el('p', { text: '단원 평가 문제를 준비 중입니다.' })));
    const done = units.filter((u) => mine.get(`${s.code}/${u.id}`)).length;
    return el('section.section', {},
      el('div.section-head', {}, el('h2', { text: s.subject }), el('p', { text: `${units.length}개 단원 · 응시 ${done} / ${units.length}` })),
      el('div.grid.tight', {},
        units.map((u) => {
          const st = statsOf(mine.get(`${s.code}/${u.id}`));
          const saved = readExamState(s.code, unitKey(s.code, u.id));
          const rivals = others.map((n) => ({ n, st: statsOf(data.scores.get(n)?.get(`${s.code}/${u.id}`)) })).filter((x) => x.st);
          return el(`div.card.assess-card.unit-card${st ? '.done' : ''}`, {},
            el('div.assess-top', {}, el('h3', { text: u.short || u.title }), st ? el('span.badge.graduated', { text: `${st.tries}번 응시` }) : null),
            el('p.meta', { text: `${u.questions.length}문항 · 100점 · ${u.minutes || 15}분` }),
            st
              ? el('div.assess-score', {}, el('b', { text: String(st.best) }), el('small', { text: ' 최고점' }),
                  el('span.unit-sub', { text: st.tries > 1 ? ` 처음 ${st.first} · 최근 ${st.last.score}` : '' }))
              : el('p.meta', { text: saved ? '풀던 시험이 있습니다.' : '아직 응시하지 않았습니다.' }),
            rivals.length ? el('p.unit-rivals', { text: rivals.map((x) => `${x.n} ${x.st.best}`).join(' · ') }) : null,
            el('div.hero-actions.left', {},
              el(`a.pill.small${st && !saved ? '.ghost' : ''}`, { href: `#/units/${s.code}/${u.id}`, text: saved ? '이어서 풀기' : st ? '다시 풀기' : '응시하기' }),
              st ? el('a.pill.ghost.small', { href: `#/units/${s.code}/${u.id}/result/${st.last.session}`, text: '최근 결과' }) : null
            )
          );
        })
      )
    );
  }));

  const go = (s) => (location.hash = s === 'all' ? '#/units' : `#/units?s=${s}`);
  ctx.show(
    el('section.hero', {},
      el('p.eyebrow', { text: `${me} · 단원 평가` }),
      el('h1', { text: '단원별로 시험 보기' }),
      el('p.sub', { text: '단원마다 새 문제 10개 · 100점 · 15분. 몇 번이든 다시 볼 수 있고, 카드에는 최고 점수가 남습니다.' }),
      !data.ok ? el('p.save-warn', { text: '서버에서 기록을 읽지 못했습니다. 이 브라우저에 보관된 것만 보입니다.' }) : null
    ),
    el('div.wrap', {},
      el('div.filter-bar', {},
        el('div.chips', {},
          el('button.chip.pick', { type: 'button', 'aria-pressed': String(sel === 'all'), text: '모든 과목', onclick: () => go('all') }),
          exam.subjects.map((s) => el('button.chip.pick', { type: 'button', 'aria-pressed': String(sel === s.code), text: s.subject, onclick: () => go(s.code) }))
        )
      ),
      blocks
    )
  );
}

/* ── 응시 ─────────────────────────────────────────── */
async function renderUnitStart(ctx, exam, subject, unit) {
  document.title = `${subject.subject} ${unit.short || unit.title} 단원 평가 — 시험 준비`;
  ctx.setNav('units');
  const data = await loadUnitScores(ctx, exam.subjects);
  const st = statsOf((data.scores.get(getCurrentLearner()) || new Map()).get(`${subject.code}/${unit.id}`));
  const key = unitKey(subject.code, unit.id);
  const saved = readExamState(subject.code, key);
  const limit = (unit.minutes || 15) * 60;
  const title = `${subject.subject} 단원 평가 · ${unit.short || unit.title}`;
  const begin = (state) => runExam(ctx, subject, unit.questions, unit.groupsMap, limit, state, {
    mode: 'assess',
    key,
    round: unitRound(unit.id),
    title,
    resultHref: (sid) => `#/units/${subject.code}/${unit.id}/result/${sid}`,
  });
  ctx.show(
    el('section.hero', {},
      el('a.back', { href: `#/units?s=${subject.code}`, text: '단원 평가' }),
      el('p.eyebrow', { text: `${getCurrentLearner()} · ${subject.subject}` }),
      el('h1', { text: unit.short || unit.title }),
      el('p.sub', { text: `${unit.questions.length}문항 · 100점 · ${Math.round(limit / 60)}분` }),
      el('p.scope', { text: st
        ? `지금까지 ${st.tries}번 응시 · 최고 ${st.best}점. 다시 풀면 새 기록으로 남습니다.`
        : '시작을 누르면 시간이 흐릅니다. 다 풀고 제출하면 바로 채점하고 해설을 보여 줍니다.' }),
      el('div.hero-actions', {},
        saved ? el('button.pill', { type: 'button', text: '풀던 시험 이어서', onclick: () => begin(saved) }) : null,
        el(`button.pill${saved ? '.ghost' : ''}`, { type: 'button', text: saved ? '처음부터 새로' : '시작', onclick: () => begin({ session: newId('u'), startedAt: Date.now(), answers: {} }) })
      )
    )
  );
}

async function renderUnitResult(ctx, exam, subject, unit, sessionId) {
  const data = await loadUnitScores(ctx, exam.subjects);
  const me = getCurrentLearner();
  const units = await loadUnits(ctx, subject.code);
  const next = units[units.indexOf(unit) + 1];
  return renderResult(ctx, subject, sessionId, {
    paper: { questions: unit.questions, groups: unit.groupsMap },
    title: `${subject.subject} 단원 평가 · ${unit.short || unit.title}`,
    backHref: `#/units?s=${subject.code}`,
    backText: '단원 평가',
    extra: (sum) => {
      const st = statsOf((data.scores.get(me) || new Map()).get(`${subject.code}/${unit.id}`));
      const lines = [];
      if (st && st.tries > 1) lines.push(`이 단원 ${st.tries}번째 기록 · 처음 ${st.first}점 · 최고 ${st.best}점 · 이번 ${sum.earned}점`);
      const others = data.names.filter((n) => n !== me).map((n) => ({ n, st: statsOf(data.scores.get(n)?.get(`${subject.code}/${unit.id}`)) })).filter((x) => x.st);
      if (others.length) lines.push(`같은 단원을 본 다른 참여자(최고점): ${others.map((x) => `${x.n} ${x.st.best}점`).join(' · ')}`);
      return lines.length ? el('div.assess-note', {}, lines.map((t) => el('p', { text: t }))) : null;
    },
    actions: () => [
      el('a.pill', { href: `#/units/${subject.code}/${unit.id}`, text: '다시 풀기' }),
      next ? el('a.pill.ghost', { href: `#/units/${subject.code}/${next.id}`, text: `다음 단원: ${next.short || next.title}` }) : null,
      el('a.pill.ghost', { href: `#/units?s=${subject.code}`, text: '단원 목록' }),
    ],
  });
}

/** app.js 의 길 찾기에서 부른다. 처리하면 Promise, 아니면 null */
export function renderUnitsRoute(ctx, exam, parts, query) {
  if (parts[0] !== 'units') return null;
  if (parts.length === 1) return renderUnitsHome(ctx, exam, query);
  return (async () => {
    const subject = exam.subjects.find((x) => x.code === parts[1]);
    const unit = subject && (await loadUnits(ctx, subject.code)).find((u) => u.id === parts[2]);
    if (!subject || !unit) return ctx.renderMissing('그런 단원 평가가 없습니다.');
    if (parts.length === 3) return renderUnitStart(ctx, exam, subject, unit);
    if (parts.length === 5 && parts[3] === 'result') return renderUnitResult(ctx, exam, subject, unit, parts[4]);
    return ctx.renderMissing('주소가 올바르지 않습니다.');
  })();
}

/** 오답 노트에 넣을 단원 평가의 틀린 문제 — 같은 문제를 나중에 맞혔으면 뺀다 (assessWrongs 와 같은 모양) */
export async function unitWrongs(ctx, subjects, attempts) {
  const mine = attempts.filter((a) => a.mode === 'assess' && a.qtype === 'choice').sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = new Map();
  for (const a of mine) last.set(a.q, a);
  const out = [];
  for (const sub of subjects) {
    for (const u of await loadUnits(ctx, sub.code)) {
      for (const q of u.questions) {
        const a = last.get(q.id);
        if (a && a.correct === false) out.push({ subject: sub, round: { title: `단원 평가 · ${u.short || u.title}` }, question: q, group: u.groupsMap.get(q.group) || null, attempt: a });
      }
    }
  }
  return out;
}
