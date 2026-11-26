/*
 * 시험 준비 웹앱 — 학습 현황 대시보드 (#/dashboard)
 *
 *   영상 시청 진도율   단원 정리 문서 속 영상 중 1번 이상 본 영상 비율 (반복 시청은 5회까지 따로 보여 준다)
 *   문제 풀이 진도율   읽기 문서 끝 단원 평가에서 한 번이라도 답을 낸 문항 비율
 *   문제 풀이 점수     단원 평가를 낸 문서마다 가장 최근 회차의 정답률 평균
 *   종합 성취도        영상 30% + 풀이 진도 30% + 점수 40%
 *   (개념 진도율은 과목 페이지와 같은 값 — 개념 읽기·예상 문제 풀이로 계산)
 */

import { el, CIRCLED, plainStem } from './dom.js?v=20261126-1353';
import { loadRecords } from './store.js?v=20261126-1353';
import { mergeRecordsForLearner, summarize } from './grade.mjs?v=20261126-1353';
import { watchCounts, videoKey, MAX_WATCH } from './watch.js?v=20261126-1353';
import { loadStudy } from './study.js?v=20261126-1353';
import { avatar, refreshProfiles } from './characters.js?v=20261126-1353';

const COMPARE = ['문종배', '문현'];
const UNIT_ROUND_BASE = 10;
const QUIZ_ROUND_BASE = 40;
const normQ = (q) => String(q).replace(/^([a-z]+)-d(\d+)-(\d+)$/, '$1-q$2-$3');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
const docUrl = (file) => `exam/${file.normalize('NFC').split('/').map(encodeURIComponent).join('/')}`;
const ansText = (list) => (list && list.length ? list.map((n) => CIRCLED[n - 1] || String(n)).join(',') : '–');
const shortDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}.${d.getDate()}`;
};

const textCache = new Map();
const fetchText = (url) => {
  if (!textCache.has(url)) textCache.set(url, fetch(url).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
  return textCache.get(url);
};

/** 문서 속 영상 이름 목록 */
async function docVideos(file) {
  const md = await fetchText(docUrl(file));
  const keys = [];
  for (const m of md.matchAll(/<video\b[^>]*\bsrc="([^"]+)"/g)) keys.push(videoKey(m[1]));
  return keys;
}

function bar(value, kind = '') {
  const v = Math.max(0, Math.min(100, value || 0));
  return el(`div.db-bar${kind ? `.${kind}` : ''}`, { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(v) },
    el('i', { style: `width:${v}%` }));
}

function summarizeAll(subjects) {
  const V = subjects.reduce((a, x) => a + x.v, 0);
  const W = subjects.reduce((a, x) => a + x.w, 0);
  const VIEWS = subjects.reduce((a, x) => a + x.views, 0);
  const QT = subjects.reduce((a, x) => a + x.qT, 0);
  const QA = subjects.reduce((a, x) => a + x.qA, 0);
  const lastScores = subjects.flatMap((x) => x.rows.filter((r) => r.last != null).map((r) => r.last));
  const triedDocs = lastScores.length;
  const allDocs = subjects.reduce((a, x) => a + x.rows.filter((r) => r.qTotal).length, 0);
  const videoPct = pct(W, V);
  const quizPct = pct(QA, QT);
  const scorePct = avg(lastScores);
  const overall = Math.round(videoPct * 0.3 + quizPct * 0.3 + (scorePct || 0) * 0.4);
  return { V, W, VIEWS, QT, QA, triedDocs, allDocs, videoPct, quizPct, scorePct, overall };
}

function compareCard(title, rows, kind, foot = null) {
  return el(`div.db-card.db-cmp-card.${kind}`, {},
    el('div.db-card-title', { text: title }),
    el('div.db-cmp-list', {},
      rows.map((r) => el(`div.db-cmp-row.${r.side}`, {},
        el('div.db-cmp-top', {},
          el('span.db-who', {}, el(`i.db-dot.${r.side}`), r.name),
          el(`b.db-cmp-num.${r.side}`, {}, r.value == null ? '–' : String(r.value), r.value == null ? '' : el('small', { text: '%' }))
        ),
        bar(r.value, r.side),
        r.sub ? el('p.db-card-sub', { text: r.sub }) : null
      ))
    ),
    foot ? el('p.db-card-foot', { text: foot }) : null
  );
}

function compareLine(label, a, b) {
  const row = (side, item) => el(`div.db-cline-row.${side}`, {},
    el(`i.db-dot.${side}`, { title: item.name }),
    bar(item.value, side),
    el(`span.db-line-num.${side}`, { text: item.value == null ? '–' : `${item.value}%` }),
    el('span.db-cline-detail', { text: item.detail })
  );
  return el('div.db-cline', {},
    el('span.db-line-label', { text: label }),
    el('div.db-cline-bars', {}, row('a', a), row('b', b))
  );
}

/**
 * 참여자 한 명의 과목·단원별 진도 (대결 화면도 함께 쓴다)
 * rows[].correct = 가장 최근 회차에서 맞힌 문항 수
 */
export async function computeProgress(ctx, exam, records, learner) {
  const counts = watchCounts(records, learner);
  const merged = mergeRecordsForLearner(records, learner);
  return Promise.all(exam.subjects.map(async (s) => {
    const quizData = await ctx.getJson(`data/docquiz/${s.code}.json`).catch(() => ({ docs: {} }));
    const docs = await Promise.all((s.docs || []).map(async (d, index) => {
      const quiz = quizData.docs?.[d.file];
      const videos = d.role === 'unit' || d.role === 'summary' ? await docVideos(d.file) : [];
      if (!quiz && !videos.length) return null;
      const watched = videos.filter((k) => (counts.get(k) || 0) > 0).length;
      const views = videos.reduce((a, k) => a + Math.min(MAX_WATCH, counts.get(k) || 0), 0);
      let qTotal = 0;
      let answered = 0;
      let tries = [];
      let questions = [];
      if (quiz) {
        const qs = quiz.questions || [];
        qTotal = qs.length;
        let cNo = 0;
        let eNo = 0;
        questions = qs.map((q) => ({
          id: q.id,
          type: q.type,
          label: q.type === 'choice' ? `${++cNo}번` : `서술형 ${++eNo}`,
          shortLabel: q.type === 'choice' ? `${cNo}번` : `서${eNo}`,
          stem: plainStem(q.stem, 64),
          answer: q.type === 'choice' && q.answer != null ? [q.answer] : [],
        }));
        const ids = new Set(qs.map((q) => q.id));
        const sessions = [...merged.sessions.values()]
          .filter((x) => x.mode === 'assess' && x.subject === s.code && x.round === QUIZ_ROUND_BASE + index)
          .sort((a, b) => String(a.at).localeCompare(String(b.at)));
        const byS = new Map(sessions.map((x) => [x.session, new Map()]));
        for (const a of merged.attempts.filter((x) => byS.has(x.session)).sort((p, q) => String(p.at).localeCompare(String(q.at)))) {
          const q = normQ(a.q);
          if (ids.has(q)) byS.get(a.session).set(q, a);
        }
        const touched = new Set();
        for (const m of byS.values()) for (const [q, a] of m) if ((a.picked && a.picked.length) || (a.text && a.text.trim()) || a.correct === true) touched.add(q);
        answered = touched.size;
        tries = sessions.map((x) => {
          const m = byS.get(x.session);
          let correct = 0;
          let wrong = 0;
          let pending = 0;
          for (const q of qs) {
            const a = m.get(q.id);
            if (a?.correct === true) correct++;
            else if (a?.correct === false) wrong++;
            else pending++;
          }
          return { at: x.at, correct, wrong, pending, total: qTotal, score: pct(correct, qTotal), max: 100, byQ: m };
        });
      }
      return {
        doc: d, index, videos: videos.length, watched, views,
        qTotal, answered, tries, questions,
        correct: tries.at(-1)?.correct ?? 0,
        last: tries.at(-1)?.score ?? null,
        best: tries.length ? Math.max(...tries.map((t) => t.score)) : null,
      };
    }));
    const rows = docs.filter(Boolean);
    const v = rows.reduce((a, r) => a + r.videos, 0);
    const w = rows.reduce((a, r) => a + r.watched, 0);
    const views = rows.reduce((a, r) => a + r.views, 0);
    const qT = rows.reduce((a, r) => a + r.qTotal, 0);
    const qA = rows.reduce((a, r) => a + r.answered, 0);
    const qC = rows.reduce((a, r) => a + r.correct, 0);
    const score = avg(rows.filter((r) => r.last != null).map((r) => r.last));
    return { s, rows, v, w, views, qT, qA, qC, score };
  }));
}

/** #/units (단원별 10문항 평가) 중 두 사람 중 한 명이라도 응시한 기록 수집 */
async function loadUnitComparisons(ctx, exam, records, nameA, nameB) {
  const mergedA = mergeRecordsForLearner(records, nameA);
  const mergedB = mergeRecordsForLearner(records, nameB);
  const triesOf = (merged, code, unit) => {
    const round = UNIT_ROUND_BASE + Number(String(unit.id).replace(/^u/, ''));
    const sessions = [...merged.sessions.values()]
      .filter((x) => x.mode === 'assess' && x.subject === code && x.round === round)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return sessions.map((sess) => {
      const sum = summarize(unit.questions || [], merged.attempts.filter((a) => a.session === sess.session));
      const byQ = new Map();
      let correct = 0;
      let wrong = 0;
      let pending = 0;
      for (const r of sum.rows) {
        const c = r.state === 'correct' ? true : r.state === 'pending' ? null : false;
        if (c === true) correct++;
        else if (c === false) wrong++;
        else pending++;
        byQ.set(r.question.id, {
          picked: r.attempt?.picked || [],
          correct: c,
          state: r.state,
          earned: r.earned,
          points: r.question.points,
        });
      }
      return { at: sess.at, correct, wrong, pending, total: sum.rows.length, score: sum.earned, max: sum.max || 100, byQ };
    });
  };

  const out = [];
  await Promise.all(exam.subjects.map(async (s, sIdx) => {
    const d = await ctx.getJson(`data/units/${s.code}.json`).catch(() => ({ units: [] }));
    (d.units || []).forEach((u, uIdx) => {
      const triesA = triesOf(mergedA, s.code, u);
      const triesB = triesOf(mergedB, s.code, u);
      if (!triesA.length && !triesB.length) return;
      const questions = (u.questions || []).map((q) => ({
        id: q.id,
        type: q.type,
        label: q.type === 'essay' ? `서술형 ${q.no}` : `${q.no}번`,
        shortLabel: q.type === 'essay' ? `서${q.no}` : `${q.no}번`,
        stem: plainStem(q.stem, 64),
        answer: q.type === 'choice' ? (q.answer || []) : [],
      }));
      out.push({
        order: sIdx * 100 + 50 + uIdx,
        subjectCode: s.code,
        subjectName: s.subject,
        kind: '단원별 평가',
        title: u.short || u.title,
        href: `#/units/${s.code}/${u.id}`,
        goText: '단원별로 가기 →',
        questions,
        triesA,
        triesB,
      });
    });
  }));
  return out.sort((a, b) => a.order - b.order);
}

/** 단원 평가 1개의 점수 + 틀린 문제 비교 카드 */
function buildQuizCompareCard(item, nameA, nameB) {
  let idxA = item.triesA.length - 1;
  let idxB = item.triesB.length - 1;
  const bothDone = item.triesA.length > 0 && item.triesB.length > 0;
  const body = el('div.db-qcmp-body');

  const cellText = (q, t) => {
    if (!t) return el('span.na', { text: '미응시' });
    const a = t.byQ.get(q.id);
    if (!a) return el('span.na', { text: '–' });
    if (q.type === 'choice') {
      const pick = ansText(a.picked);
      if (a.correct === true) return el('span.ok', { text: `${pick} ○` });
      if (a.correct === false) return el('span.ng', { text: `${pick} ✕` });
      return el('span.na', { text: pick });
    }
    if (a.correct === true) return el('span.ok', { text: '○ 맞음' });
    if (a.correct === false) return el('span.ng', { text: '✕ 틀림' });
    return el('span.na', { text: '미채점' });
  };

  const scoreBox = (side, name, tries, idx, onPick) => {
    const t = idx >= 0 ? tries[idx] : null;
    let picker = null;
    if (tries.length > 1) {
      picker = el('select.db-qcmp-select', { 'aria-label': `${name} 회차 고르기` },
        tries.map((x, i) => el('option', { value: String(i), text: `${i + 1}차 (${x.score}점 · ${shortDate(x.at)})` }))
      );
      picker.value = String(idx);
      picker.addEventListener('change', () => onPick(Number(picker.value)));
    } else if (tries.length === 1) {
      picker = el('span.db-muted', { text: `1차 · ${shortDate(tries[0].at)}` });
    }
    const pctVal = t ? (t.max ? Math.round((t.score / t.max) * 100) : t.score) : 0;
    return el(`div.db-qcmp-box.${side}`, {},
      el('div.db-qcmp-box-top', {},
        el('span.db-who', {}, el(`i.db-dot.${side}`), name),
        picker
      ),
      t
        ? el('div.db-qcmp-score-line', {},
            el('b', { text: `${t.score}점` }),
            el('span', { text: `맞힘 ${t.correct}/${t.total} · 틀림 ${t.wrong}${t.pending ? ` · 미채점 ${t.pending}` : ''}` })
          )
        : el('div.db-qcmp-score-line', {}, el('b.na', { text: '미응시' }), el('span', { text: `${item.questions.length}문항` })),
      bar(pctVal, side)
    );
  };

  const render = () => {
    const tA = idxA >= 0 ? item.triesA[idxA] : null;
    const tB = idxB >= 0 ? item.triesB[idxB] : null;
    const bothWrong = [];
    const onlyA = [];
    const onlyB = [];
    const pendingList = [];
    const detailRows = [];

    for (const q of item.questions) {
      const wA = tA ? tA.byQ.get(q.id)?.correct === false : false;
      const wB = tB ? tB.byQ.get(q.id)?.correct === false : false;
      const pA = tA ? tA.byQ.get(q.id)?.correct == null : false;
      const pB = tB ? tB.byQ.get(q.id)?.correct == null : false;
      if (wA && wB) {
        bothWrong.push(q);
        detailRows.push({ q, tag: '함께 틀림', cls: 'both' });
      } else if (wA) {
        onlyA.push(q);
        detailRows.push({ q, tag: `${nameA} 틀림`, cls: 'a' });
      } else if (wB) {
        onlyB.push(q);
        detailRows.push({ q, tag: `${nameB} 틀림`, cls: 'b' });
      } else if (pA || pB) {
        pendingList.push(q);
      }
    }

    const chipRow = (cls, label, list) =>
      list.length
        ? el('div.db-qcmp-wrow', {},
            el(`span.db-qcmp-wlabel.${cls}`, { text: `${label} (${list.length})` }),
            el('div.db-qcmp-chips', {}, list.map((q) => el(`span.db-qchip.${cls}`, { title: q.stem, text: q.shortLabel })))
          )
        : null;

    const autoOpen = bothDone && detailRows.length > 0 && detailRows.length <= 12;
    const details = detailRows.length
      ? el('details.db-qcmp-details', { open: autoOpen },
          el('summary', { text: `틀린 문제 ${detailRows.length}개 자세히 보기 (번호 · 문제 · 고른 답 · 정답)` }),
          el('div.table-scroll', {},
            el('table.db-qcmp-table', {},
              el('thead', {}, el('tr', {},
                el('th', { text: '번호' }),
                el('th', { text: '구분' }),
                el('th', { text: '문제' }),
                el('th', { text: nameA }),
                el('th', { text: nameB }),
                el('th', { text: '정답' })
              )),
              el('tbody', {}, detailRows.map(({ q, tag, cls }) => el('tr', {},
                el('td.no', { text: q.label }),
                el('td', {}, el(`span.db-qchip.${cls}`, { text: tag })),
                el('td', { text: q.stem }),
                el('td.ans', {}, cellText(q, tA)),
                el('td.ans', {}, cellText(q, tB)),
                el('td.ans', { text: q.type === 'choice' ? ansText(q.answer) : '서술형' })
              )))
            )
          )
        )
      : null;

    body.replaceChildren(
      el('div.db-qcmp-scores', {},
        scoreBox('a', nameA, item.triesA, idxA, (n) => { idxA = n; render(); }),
        scoreBox('b', nameB, item.triesB, idxB, (n) => { idxB = n; render(); })
      ),
      el('div.db-qcmp-wrongs', {},
        detailRows.length
          ? [
              chipRow('both', '함께 틀린 문제', bothWrong),
              chipRow('a', `${nameA}만 틀림`, onlyA),
              chipRow('b', `${nameB}만 틀림`, onlyB),
              chipRow('pending', '서술형 미채점', pendingList),
            ]
          : [
              el('p.db-qcmp-ok', { text: '틀린 문제가 없습니다 ✓' }),
              chipRow('pending', '서술형 미채점', pendingList),
            ]
      ),
      details
    );
  };
  render();

  return el(`article.db-qcmp-card${bothDone ? '.both' : ''}`, {},
    el('div.db-qcmp-head', {},
      el('div.db-qcmp-title', {},
        el('div.db-qcmp-badges', {},
          el('span.db-qcmp-tag.sub', { text: item.subjectName }),
          el('span.db-qcmp-tag', { text: item.kind }),
          bothDone ? el('span.db-qcmp-tag.both', { text: '둘 다 완료' }) : null
        ),
        el('h3', { text: item.title })
      ),
      el('a.db-qcmp-go', { href: item.href, text: item.goText })
    ),
    body
  );
}

export async function renderDashboard(ctx, exam, data) {
  document.title = `내 진도 — ${exam.title}`;
  ctx.setNav('dashboard');
  const [nameA, nameB] = COMPARE;
  const [loaded, study] = await Promise.all([loadRecords(), loadStudy(ctx, exam.subjects, data.concepts)]);
  await refreshProfiles(loaded.records);
  const [progA, progB, unitCmps] = await Promise.all([
    computeProgress(ctx, exam, loaded.records, nameA),
    computeProgress(ctx, exam, loaded.records, nameB),
    loadUnitComparisons(ctx, exam, loaded.records, nameA, nameB),
  ]);

  const conceptMap = (name) => {
    const found = (study.learners || []).find((l) => l.name === name);
    return new Map((found?.subjects || []).map((s) => [s.code, s.progress ?? 0]));
  };
  const conA = conceptMap(nameA);
  const conB = conceptMap(nameB);
  const sumA = summarizeAll(progA);
  const sumB = summarizeAll(progB);
  const diff = sumA.overall - sumB.overall;
  const diffText = diff === 0 ? '두 사람 종합 성취도가 같습니다' : `${diff > 0 ? nameA : nameB} +${Math.abs(diff)}%p 앞섬`;

  /* ── 단원 평가 결과 비교 (문서 단원 평가 + 단원별 10문항 평가 중 응시 기록이 있는 것만) ── */
  const docCmps = [];
  progA.forEach((a, sIdx) => {
    const b = progB[sIdx];
    a.rows.forEach((ra, rIdx) => {
      const rb = b.rows[rIdx];
      if (!ra.qTotal || (!ra.tries.length && !rb.tries.length)) return;
      docCmps.push({
        order: sIdx * 100 + rIdx,
        subjectCode: a.s.code,
        subjectName: a.s.subject,
        kind: '마무리 평가',
        title: ra.doc.title,
        href: `#/s/${a.s.code}/${ra.index}`,
        goText: '마무리 평가로 가기 →',
        questions: ra.questions || [],
        triesA: ra.tries,
        triesB: rb.tries,
      });
    });
  });
  const allCmps = [...docCmps, ...unitCmps].sort((x, y) => {
    const bx = x.triesA.length > 0 && x.triesB.length > 0 ? 0 : 1;
    const by = y.triesA.length > 0 && y.triesB.length > 0 ? 0 : 1;
    return bx - by || x.order - y.order;
  });

  let compareSection = null;
  if (allCmps.length) {
    const subCodes = [];
    for (const c of allCmps) if (!subCodes.some((x) => x.code === c.subjectCode)) subCodes.push({ code: c.subjectCode, name: c.subjectName });
    let sel = 'all';
    const filterHost = el('div.chips');
    const listHost = el('div.db-qcmp-list');
    const drawCmps = () => {
      if (subCodes.length > 1) {
        filterHost.replaceChildren(
          el('button.chip.pick', { type: 'button', 'aria-pressed': String(sel === 'all'), text: `전체 (${allCmps.length})`, onclick: () => { sel = 'all'; drawCmps(); } }),
          ...subCodes.map((sc) => el('button.chip.pick', {
            type: 'button',
            'aria-pressed': String(sel === sc.code),
            text: `${sc.name} (${allCmps.filter((c) => c.subjectCode === sc.code).length})`,
            onclick: () => { sel = sc.code; drawCmps(); },
          }))
        );
      }
      const shown = sel === 'all' ? allCmps : allCmps.filter((c) => c.subjectCode === sel);
      listHost.replaceChildren(...shown.map((item) => buildQuizCompareCard(item, nameA, nameB)));
    };
    drawCmps();
    compareSection = el('section.section', {},
      el('div.section-head', {},
        el('h2', { text: '평가 점수 · 틀린 문제 비교' }),
        el('p', { text: '제출한 평가(마무리 평가 · 단원평가)마다 점수와 틀린 문제(함께 틀린 문제 · 각자 틀린 문제 · 고른 답 · 정답)를 비교합니다. 여러 번 푼 경우 회차를 바꿔 비교할 수 있습니다.' })
      ),
      subCodes.length > 1 ? el('div.filter-bar', {}, filterHost) : null,
      listHost
    );
  }

  const unitPerson = (side, name, r) => {
    const lastTry = r.tries.at(-1);
    return el(`div.db-unit-person.${side}`, {},
      el('div.db-unit-stats', {},
        el(`span.db-unit-who.${side}`, {}, el(`i.db-dot.${side}`), name),
        r.videos ? el('span', { title: '영상 시청' }, `🎬 ${r.watched}/${r.videos}`) : null,
        r.qTotal ? el('span', { title: '마무리 평가 문항' }, `📝 ${r.answered}/${r.qTotal}`) : null,
        r.tries.length
          ? el('span', { title: '회차별 점수' }, `${r.tries.map((t, i) => `${i + 1}차 ${t.score}점`).join(' · ')}${lastTry ? ` (틀림 ${lastTry.wrong})` : ''}`)
          : (r.qTotal ? el('span.db-muted', { text: '미응시' }) : null)
      ),
      bar(r.qTotal ? r.last ?? 0 : pct(r.watched, r.videos), side)
    );
  };

  const subjectBlock = (a, b) => {
    const vpA = pct(a.w, a.v);
    const vpB = pct(b.w, b.v);
    const qpA = pct(a.qA, a.qT);
    const qpB = pct(b.qA, b.qT);
    const totalA = Math.round(vpA * 0.3 + qpA * 0.3 + (a.score || 0) * 0.4);
    const totalB = Math.round(vpB * 0.3 + qpB * 0.3 + (b.score || 0) * 0.4);
    const triedA = a.rows.filter((r) => r.last != null).length;
    const triedB = b.rows.filter((r) => r.last != null).length;
    return el('section.db-subject', {},
      el('div.db-subject-head', {},
        el('h3', {}, el('a', { href: `#/s/${a.s.code}`, text: a.s.subject })),
        el('span.db-subject-total', {},
          el('span', {}, `${nameA} `, el('b.a', { text: `${totalA}%` })),
          el('span.db-sep', { text: '·' }),
          el('span', {}, `${nameB} `, el('b.b', { text: `${totalB}%` }))
        )
      ),
      compareLine('영상 시청',
        { name: nameA, value: vpA, detail: `${nameA} ${a.w}/${a.v}편 · 반복 ${a.views}/${a.v * MAX_WATCH}회` },
        { name: nameB, value: vpB, detail: `${nameB} ${b.w}/${b.v}편 · 반복 ${b.views}/${b.v * MAX_WATCH}회` }
      ),
      compareLine('문제 풀이',
        { name: nameA, value: qpA, detail: `${nameA} ${a.qA}/${a.qT}문항` },
        { name: nameB, value: qpB, detail: `${nameB} ${b.qA}/${b.qT}문항` }
      ),
      compareLine('최근 점수',
        { name: nameA, value: a.score, detail: a.score == null ? `${nameA} 미응시` : `${nameA} ${triedA}개 단원 평균` },
        { name: nameB, value: b.score, detail: b.score == null ? `${nameB} 미응시` : `${nameB} ${triedB}개 단원 평균` }
      ),
      compareLine('개념 진도',
        { name: nameA, value: conA.get(a.s.code) ?? 0, detail: `${nameA} 개념 읽기 · 예상 문제` },
        { name: nameB, value: conB.get(b.s.code) ?? 0, detail: `${nameB} 개념 읽기 · 예상 문제` }
      ),
      el('div.db-units', {},
        a.rows.map((ra, i) => {
          const rb = b.rows[i];
          return el('a.db-unit', { href: `#/s/${a.s.code}/${ra.index}` },
            el('span.db-unit-title', { text: ra.doc.title }),
            el('div.db-unit-cmp', {}, unitPerson('a', nameA, ra), unitPerson('b', nameB, rb))
          );
        })
      )
    );
  };

  ctx.show(
    el('section.hero.db-hero', {},
      el('p.eyebrow', { text: `내 진도 · ${nameA} · ${nameB} 함께 비교` }),
      el('div.db-hero-pair', {},
        el('div.db-hero-one.a', {}, avatar(nameA, 'sm'), el('span.db-hero-name', { text: nameA }), el('b.db-hero-num', { text: `${sumA.overall}%` })),
        el('span.db-hero-vs', { text: 'vs' }),
        el('div.db-hero-one.b', {}, avatar(nameB, 'sm'), el('span.db-hero-name', { text: nameB }), el('b.db-hero-num', { text: `${sumB.overall}%` }))
      ),
      el('p.sub', { text: `${diffText} · 영상 30% · 문제 풀이 진도 30% · 마무리 평가 최근 점수 40%로 계산합니다.` }),
      el('div.hero-actions', {}, el('a.pill', { href: '#/versus', text: '⚔️ 대결 보기' })),
      !loaded.ok ? el('p.save-warn', { text: '서버에서 기록을 읽지 못했습니다. 이 브라우저에 보관된 것만 보입니다.' }) : null
    ),
    el('div.wrap', {},
      el('section.section', {},
        el('div.db-cards', {},
          compareCard('영상 시청 진도율', [
            { side: 'a', name: nameA, value: sumA.videoPct, sub: `${sumA.W}/${sumA.V}편 봄 · 반복 ${sumA.VIEWS}/${sumA.V * MAX_WATCH}회` },
            { side: 'b', name: nameB, value: sumB.videoPct, sub: `${sumB.W}/${sumB.V}편 봄 · 반복 ${sumB.VIEWS}/${sumB.V * MAX_WATCH}회` },
          ], 'video'),
          compareCard('문제 풀이 진도율', [
            { side: 'a', name: nameA, value: sumA.quizPct, sub: `마무리 평가 ${sumA.QA}/${sumA.QT}문항` },
            { side: 'b', name: nameB, value: sumB.quizPct, sub: `마무리 평가 ${sumB.QA}/${sumB.QT}문항` },
          ], 'quiz'),
          compareCard('문제 풀이 점수', [
            { side: 'a', name: nameA, value: sumA.scorePct, sub: sumA.triedDocs ? `${sumA.triedDocs}/${sumA.allDocs}개 단원 최근 평균` : '아직 낸 마무리 평가 없음' },
            { side: 'b', name: nameB, value: sumB.scorePct, sub: sumB.triedDocs ? `${sumB.triedDocs}/${sumB.allDocs}개 단원 최근 평균` : '아직 낸 마무리 평가 없음' },
          ], 'score'),
          compareCard('종합 성취도', [
            { side: 'a', name: nameA, value: sumA.overall, sub: '영상 30 · 풀이 30 · 점수 40' },
            { side: 'b', name: nameB, value: sumB.overall, sub: '영상 30 · 풀이 30 · 점수 40' },
          ], 'overall', diffText)
        )
      ),
      compareSection,
      el('section.section', {},
        el('div.section-head', {},
          el('h2', { text: '과목별 비교' }),
          el('p', { text: '단원 이름을 누르면 그 단원 정리로 갑니다. 영상 아래 체크박스로 시청 횟수를 남기세요.' }),
          el('div.db-legend', {},
            el('span', {}, el('i.db-dot.a'), nameA),
            el('span', {}, el('i.db-dot.b'), nameB)
          )
        ),
        el('div.db-subjects', {}, progA.map((a, i) => subjectBlock(a, progB[i])))
      )
    )
  );
}
