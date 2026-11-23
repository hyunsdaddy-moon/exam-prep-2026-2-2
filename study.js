/*
 * 시험 준비 웹앱 — 공부 상태 읽어 오기.
 * 풀이 기록과 전 과목의 문제를 읽어 진도율·오답 복습 상태를 계산한다(계산은 progress.mjs).
 * 화면을 열 때마다 새로 읽는다 — 다른 기기에서 푼 것도 바로 보이게.
 */

import { loadRecords } from './store.js';
import { mergeRecords } from './grade.mjs';
import { buildHistories, subjectStudy, localDay } from './progress.mjs';

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

/**
 * @returns {{ ok, today, merged, histories, examDate, bySubject: Map<코드, {subject, questions, groups, concepts, ...subjectStudy}> }}
 */
export async function loadStudy(ctx, subjects, concepts) {
  const [loaded, papers] = await Promise.all([loadRecords(), Promise.all(subjects.map((s) => loadPaper(ctx, s).catch(() => ({ questions: [], groups: new Map() }))))]);
  const merged = mergeRecords(loaded.records);
  const histories = buildHistories(merged.attempts);
  const today = localDay(new Date());
  const bySubject = new Map();
  subjects.forEach((s, i) => {
    const mine = concepts.filter((c) => c.subject === s.subject);
    bySubject.set(s.code, { subject: s, ...papers[i], concepts: mine, ...subjectStudy(mine, papers[i].questions, histories, merged.reads, today) });
  });
  return { ok: loaded.ok, today, merged, histories, examDate: merged.settings.examDate || null, bySubject };
}
