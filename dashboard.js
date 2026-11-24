/*
 * 시험 준비 웹앱 — 학습 현황 대시보드 (#/dashboard)
 *
 *   영상 시청 진도율   단원 정리 문서 속 영상 중 1번 이상 본 영상 비율 (반복 시청은 5회까지 따로 보여 준다)
 *   문제 풀이 진도율   읽기 문서 끝 단원 평가에서 한 번이라도 답을 낸 문항 비율
 *   문제 풀이 점수     단원 평가를 낸 문서마다 가장 최근 회차의 정답률 평균
 *   종합 성취도        영상 30% + 풀이 진도 30% + 점수 40%
 *   (개념 진도율은 과목 페이지와 같은 값 — 개념 읽기·예상 문제 풀이로 계산)
 */

import { el } from './dom.js?v=20261124-1653';
import { loadRecords, getCurrentLearner } from './store.js?v=20261124-1653';
import { mergeRecordsForLearner } from './grade.mjs?v=20261124-1653';
import { watchCounts, videoKey, MAX_WATCH } from './watch.js?v=20261124-1653';
import { loadStudy } from './study.js?v=20261124-1653';

const QUIZ_ROUND_BASE = 40;
const normQ = (q) => String(q).replace(/^([a-z]+)-d(\d+)-(\d+)$/, '$1-q$2-$3');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
const docUrl = (file) => `exam/${file.normalize('NFC').split('/').map(encodeURIComponent).join('/')}`;

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

function card(title, value, sub, kind) {
  return el(`div.db-card.${kind}`, {},
    el('div.db-card-title', { text: title }),
    el('div.db-card-num', {}, value == null ? '–' : String(value), value == null ? '' : el('small', { text: '%' })),
    bar(value, kind),
    el('p.db-card-sub', { text: sub })
  );
}

const line = (label, value, detail, kind) => el('div.db-line', {},
  el('span.db-line-label', { text: label }),
  bar(value, kind),
  el('span.db-line-num', { text: value == null ? '–' : `${value}%` }),
  el('span.db-line-detail', { text: detail })
);

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
      if (quiz) {
        const qs = quiz.questions || [];
        qTotal = qs.length;
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
          const correct = [...m.values()].filter((a) => a.correct === true).length;
          return { at: x.at, correct, score: pct(correct, qTotal) };
        });
      }
      return {
        doc: d, index, videos: videos.length, watched, views,
        qTotal, answered, tries,
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

export async function renderDashboard(ctx, exam, data) {
  document.title = `학습 현황 — ${exam.title}`;
  ctx.setNav('dashboard');
  const learner = getCurrentLearner();
  const [loaded, study] = await Promise.all([loadRecords(), loadStudy(ctx, exam.subjects, data.concepts)]);
  const subjects = (await computeProgress(ctx, exam, loaded.records, learner)).map((x) => ({ ...x, info: study.bySubject.get(x.s.code) }));

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

  const subjectBlock = (x) => {
    const vp = pct(x.w, x.v);
    const qp = pct(x.qA, x.qT);
    const total = Math.round(vp * 0.3 + qp * 0.3 + (x.score || 0) * 0.4);
    return el('section.db-subject', {},
      el('div.db-subject-head', {},
        el('h3', {}, el('a', { href: `#/s/${x.s.code}`, text: x.s.subject })),
        el('span.db-subject-total', {}, '종합 ', el('b', { text: `${total}%` }))
      ),
      line('영상 시청', vp, `${x.w}/${x.v}편 · 반복 ${x.views}/${x.v * MAX_WATCH}회`, 'video'),
      line('문제 풀이', qp, `${x.qA}/${x.qT}문항`, 'quiz'),
      line('최근 점수', x.score, x.score == null ? '단원 평가를 아직 내지 않음' : `${x.rows.filter((r) => r.last != null).length}개 단원 평균`, 'score'),
      line('개념 진도', x.info?.progress ?? 0, '개념 읽기 · 예상 문제', 'concept'),
      el('div.db-units', {},
        x.rows.map((r) => el('a.db-unit', { href: `#/s/${x.s.code}/${r.index}` },
          el('span.db-unit-title', { text: r.doc.title }),
          el('span.db-unit-stats', {},
            r.videos ? el('span', { title: '영상 시청' }, `🎬 ${r.watched}/${r.videos}`) : null,
            r.qTotal ? el('span', { title: '단원 평가 문항' }, `📝 ${r.answered}/${r.qTotal}`) : null,
            r.tries.length ? el('span', { title: '회차별 점수' }, r.tries.map((t, i) => `${i + 1}차 ${t.score}`).join(' · ')) : (r.qTotal ? el('span.db-muted', { text: '미응시' }) : null)
          ),
          bar(r.qTotal ? r.last ?? 0 : pct(r.watched, r.videos), r.qTotal ? 'score' : 'video')
        ))
      )
    );
  };

  ctx.show(
    el('section.hero', {},
      el('p.eyebrow', { text: `${learner} · 학습 현황` }),
      el('h1', { text: `종합 성취도 ${overall}%` }),
      el('p.sub', { text: '영상 30% · 문제 풀이 진도 30% · 단원 평가 최근 점수 40%로 계산합니다.' }),
      el('div.hero-actions', {}, el('a.pill', { href: '#/versus', text: '⚔️ 대결 보기' })),
      !loaded.ok ? el('p.save-warn', { text: '서버에서 기록을 읽지 못했습니다. 이 브라우저에 보관된 것만 보입니다.' }) : null
    ),
    el('div.wrap', {},
      el('section.section', {},
        el('div.db-cards', {},
          card('영상 시청 진도율', videoPct, `${W}/${V}편 봄 · 반복 시청 ${VIEWS}/${V * MAX_WATCH}회`, 'video'),
          card('문제 풀이 진도율', quizPct, `단원 평가 ${QA}/${QT}문항 풀어 봄`, 'quiz'),
          card('문제 풀이 점수', scorePct, triedDocs ? `${triedDocs}/${allDocs}개 단원 · 최근 회차 평균` : '아직 낸 단원 평가가 없습니다', 'score'),
          card('종합 성취도', overall, '영상 30 · 풀이 30 · 점수 40', 'overall')
        )
      ),
      el('section.section', {},
        el('div.section-head', {}, el('h2', { text: '과목별' }), el('p', { text: '단원 이름을 누르면 그 단원 정리로 갑니다. 영상 아래 체크박스로 시청 횟수를 남기세요.' })),
        el('div.db-subjects', {}, subjects.map(subjectBlock))
      )
    )
  );
}
