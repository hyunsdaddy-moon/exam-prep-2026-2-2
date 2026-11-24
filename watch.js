/*
 * 시험 준비 웹앱 — 영상 시청 횟수 (영상마다 체크박스 5칸, 끝까지 보면 자동으로 한 칸)
 *
 * 저장: Firestore 규칙을 바꾸지 않으려고 'read' 기록에 concept = "v:<영상 이름>:<횟수>" 로 남긴다.
 *       기록은 고칠 수 없으므로 바꿀 때마다 새 기록을 하나 더 남기고, 영상마다 가장 나중 기록이 이긴다.
 *       ('v:' 로 시작하는 값은 개념 id 와 겹치지 않으므로 개념 읽음 계산에는 섞이지 않는다.)
 */

import { el } from './dom.js?v=20261124-2212';
import { loadRecords, saveRecords, getCurrentLearner } from './store.js?v=20261124-2212';
import { filterRecordsByLearner } from './grade.mjs?v=20261124-2212';

export const MAX_WATCH = 5;
const PREFIX = 'v:';

/** <video> 의 영상 이름 (파일 이름에서 확장자를 뺀 것) */
export function videoKey(src) {
  const name = decodeURIComponent(String(src || '').split(/[?#]/)[0].split('/').pop() || '');
  return name.replace(/\.(mp4|webm|mov|m4v)$/i, '').slice(0, 48);
}

/** 기록 → Map(영상 이름 → 횟수) */
export function watchCounts(records, learner = getCurrentLearner()) {
  const latest = new Map();
  for (const r of filterRecordsByLearner(records, learner)) {
    if (r.type !== 'read' || typeof r.concept !== 'string' || !r.concept.startsWith(PREFIX)) continue;
    const m = r.concept.slice(PREFIX.length).match(/^(.+):(\d)$/);
    if (!m) continue;
    const prev = latest.get(m[1]);
    if (!prev || String(r.at) >= String(prev.at)) latest.set(m[1], { at: r.at, n: Math.min(MAX_WATCH, Number(m[2])) });
  }
  return new Map([...latest].map(([k, v]) => [k, v.n]));
}

/** 읽기 문서 안의 영상마다 아래에 「시청 □□□□□」 줄을 붙인다 */
export async function attachWatchBoxes(container, subjectCode) {
  const videos = [...container.querySelectorAll('video')].filter((v) => !v.closest('.dq'));
  if (!videos.length) return;
  const loaded = await loadRecords();
  const counts = watchCounts(loaded.records);
  for (const v of videos) {
    const key = videoKey(v.getAttribute('src') || v.querySelector('source')?.getAttribute('src'));
    if (!key || v.nextElementSibling?.classList.contains('watch-row')) continue;
    let n = counts.get(key) || 0;
    const boxes = [];
    const label = el('span.watch-count');
    const paint = () => {
      boxes.forEach((b, i) => {
        b.checked = i < n;
        b.setAttribute('aria-label', `${i + 1}번째 시청${i < n ? ' (완료)' : ''}`);
      });
      label.textContent = n ? `${n}회 시청${n >= MAX_WATCH ? ' · 완료!' : ''}` : '아직 안 봄';
      row.classList.toggle('done', n >= MAX_WATCH);
    };
    for (let i = 0; i < MAX_WATCH; i++) {
      const box = el('input', { type: 'checkbox' });
      box.addEventListener('change', () => {
        // i 번째 칸을 누르면 i+1 회로, 이미 그 칸까지 찬 상태에서 다시 누르면 하나 줄인다
        n = box.checked ? i + 1 : i;
        paint();
        void saveRecords([{ type: 'read', concept: `${PREFIX}${key}:${n}`, subject: subjectCode }]);
      });
      boxes.push(box);
    }
    const row = el('div.watch-row', { 'data-video': key },
      el('span.watch-label', { text: '🎬 시청' }),
      el('span.watch-boxes', {}, boxes.map((b, i) => el('label.watch-box', { title: `${i + 1}회` }, b, el('i')))),
      label
    );
    paint();
    v.after(row);

    // 자동 체크: 영상을 실제로 재생한 시간이 길이의 80% 를 넘은 채 끝나면 한 칸을 채운다 (끝으로 건너뛰면 세지 않는다)
    let played = 0;
    let lastTime = null;
    v.addEventListener('timeupdate', () => {
      const t = v.currentTime;
      if (lastTime != null && !v.seeking && t > lastTime && t - lastTime < 1.5) played += t - lastTime;
      lastTime = t;
    });
    v.addEventListener('seeking', () => { lastTime = null; });
    v.addEventListener('ended', () => {
      const enough = v.duration > 0 && played >= v.duration * 0.8;
      played = 0;
      lastTime = null;
      if (!enough || n >= MAX_WATCH) return;
      n += 1;
      paint();
      label.textContent += ' · 자동 체크';
      void saveRecords([{ type: 'read', concept: `${PREFIX}${key}:${n}`, subject: subjectCode }]);
    });
  }
}
