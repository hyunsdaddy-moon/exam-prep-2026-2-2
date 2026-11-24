/*
 * 시험 준비 웹앱 — 공부 상태 읽어 오기.
 * 풀이 기록과 전 과목의 문제를 읽어 참여자별 진도율·오답 복습 상태를 계산한다(계산은 progress.mjs).
 * 화면을 열 때마다 새로 읽는다 — 다른 기기에서 푼 것도 바로 보이게.
 */

import { loadRecords, getCurrentLearner, getSavedLearners, DEFAULT_LEARNER } from './store.js?v=20261124-1703';
import { mergeRecordsForLearner, listLearners } from './grade.mjs?v=20261124-1703';
import { buildHistories, subjectStudy, localDay } from './progress.mjs?v=20261124-1703';

const paperCache = new Map();

/** 과목의 문제지. 문제 데이터는 풀이 중에 바뀌지 않으므로 한 번만 읽는다. */
export function loadPaper(ctx, subject) {
  if (!paperCache.has(subject.code)) {
    paperCache.set(
      subject.code,
      ctx.getJson(`data/${subject.questions}`).then(
        (paper) => ({ questions: paper.questions || [], groups: new Map((paper.groups || []).map((g) => [g.id, g])) }),
        (err) => {
          paperCache.delete(subject.code); // 실패는 붙들어 두지 않는다
          throw err;
        }
      )
    );
  }
  return paperCache.get(subject.code);
}

/** 참여자 한 명의 전체·과목별 공부 상태를 계산한다 */
export function computeStudyFor(subjects, concepts, papers, records, learner, today) {
  const merged = mergeRecordsForLearner(records, learner);
  const histories = buildHistories(merged.attempts);
  const bySubject = new Map();
  const subjectRows = [];
  let totalWeight = 0;
  let weightedSum = 0;
  let totalQuestions = 0;
  let triedQuestions = 0;
  let dueTotal = 0;
  let readCount = 0;
  let lastRightTotal = 0;

  subjects.forEach((s, i) => {
    const mine = concepts.filter((c) => c.subject === s.subject);
    const qs = papers[i].questions;
    const st = subjectStudy(mine, qs, histories, merged.reads, today);
    bySubject.set(s.code, { subject: s, ...papers[i], concepts: mine, ...st });
    for (let k = 0; k < mine.length; k++) {
      const w = mine[k].importance || 1;
      totalWeight += w;
      weightedSum += st.states[k].score * w;
      if (st.states[k].read) readCount++;
    }
    totalQuestions += qs.length;
    triedQuestions += st.triedQuestions;
    dueTotal += st.due.length;
    for (const q of qs) {
      const h = histories.get(q.id);
      if (h && h.length && h.at(-1).correct) lastRightTotal++;
    }
    subjectRows.push({
      code: s.code,
      subject: s.subject,
      progress: st.progress,
      mastery: st.mastery,
      triedQuestions: st.triedQuestions,
      totalQuestions: qs.length,
      due: st.due.length,
    });
  });

  return {
    merged,
    histories,
    bySubject,
    overall: totalWeight ? Math.round((weightedSum / totalWeight) * 100) : 0,
    mastery: triedQuestions ? Math.round((lastRightTotal / triedQuestions) * 100) : null,
    triedQuestions,
    totalQuestions,
    dueTotal,
    readCount,
    subjectRows,
  };
}

/**
 * @returns {{ ok, today, learner, merged, histories, examDate, overall, bySubject, learners }}
 */
export async function loadStudy(ctx, subjects, concepts, learner = getCurrentLearner(), { fast = false } = {}) {
  const [loaded, papers] = await Promise.all([
    loadRecords({ fast }),
    Promise.all(subjects.map((s) => loadPaper(ctx, s).catch(() => ({ questions: [], groups: new Map() })))),
  ]);
  const today = localDay(new Date());
  const current = computeStudyFor(subjects, concepts, papers, loaded.records, learner, today);

  const saved = getSavedLearners().filter((n) => n !== DEFAULT_LEARNER);
  const extra = learner === DEFAULT_LEARNER ? [...saved, learner] : saved.includes(learner) ? saved : [...saved, learner];
  const allLearners = listLearners(loaded.records, extra);

  const learners = allLearners.map((name) => {
    const s = name === learner ? current : computeStudyFor(subjects, concepts, papers, loaded.records, name, today);
    return {
      name,
      overall: s.overall,
      mastery: s.mastery,
      triedQuestions: s.triedQuestions,
      totalQuestions: s.totalQuestions,
      dueTotal: s.dueTotal,
      readCount: s.readCount,
      subjects: s.subjectRows,
    };
  });

  return {
    ok: loaded.ok,
    today,
    learner,
    merged: current.merged,
    histories: current.histories,
    examDate: current.merged.settings.examDate || null,
    overall: current.overall,
    bySubject: current.bySubject,
    learners,
  };
}
