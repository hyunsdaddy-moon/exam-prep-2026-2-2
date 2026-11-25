/*
 * 시험 준비 웹앱 — 기출문제 (학교 정기고사 7학년 시험지 보기)
 *
 *   #/past                     기출문제 홈: 시험 회차 카드 (과목 단추)
 *   #/past?s=<과목>             한 과목만 회차별로 모아 보기
 *   #/past/<회차>/<과목>        시험지 보기 (쪽 그림을 위에서 아래로)
 *
 * 자료: data/past.json  { subjects, exams: [{ id, title, month, note, parts: [{ code, from, to }] }] }
 * 그림: assets/past/<회차>/p<쪽 두 자리>.webp  (원본 PDF 「KIS 정기고사 기출문제」를 130dpi 로 바꾼 것)
 * 「다 봤어요」 표시는 이 기기에만 참여자별로 남긴다.
 */

import { el } from './dom.js?v=20261125-2125';
import { getCurrentLearner } from './store.js?v=20261125-2125';
import { inkTools } from './ink.js?v=20261125-2125';

let cache = null;
function loadPast(ctx) {
  if (!cache) cache = ctx.getJson('data/past.json').catch((e) => { cache = null; throw e; });
  return cache;
}

const seenKey = () => `examprep.past.${getCurrentLearner()}`;
function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(seenKey()) || '[]')); } catch { return new Set(); }
}
function setSeen(id, on) {
  const s = readSeen();
  if (on) s.add(id); else s.delete(id);
  localStorage.setItem(seenKey(), JSON.stringify([...s]));
}

const pageSrc = (examId, n) => `assets/past/${examId}/p${String(n).padStart(2, '0')}.webp`;
const pagesOf = (p) => p.to - p.from + 1;
const label = (month) => month.replace(/^(\d{4})-0?(\d+)$/, '$1년 $2월');

export function renderPastRoute(ctx, parts, query) {
  if (parts[0] !== 'past') return null;
  if (parts.length === 1) return renderPastHome(ctx, query);
  if (parts.length === 3) return renderPastPaper(ctx, parts[1], parts[2]);
  return null;
}

/* ── 홈 ─────────────────────────────────────────── */
async function renderPastHome(ctx, query) {
  ctx.setNav('past');
  document.title = '기출문제 — 시험 준비';
  let data;
  try { data = await loadPast(ctx); } catch { return ctx.renderMissing('기출문제 목록을 불러오지 못했습니다.'); }
  const names = new Map(data.subjects.map((s) => [s.code, s.name]));
  const sel = names.has(query.get('s')) ? query.get('s') : 'all';
  const seen = readSeen();
  const go = (s) => (location.hash = s === 'all' ? '#/past' : `#/past?s=${s}`);

  const partBtn = (exam, p) => {
    const id = `${exam.id}/${p.code}`;
    return el(`a.chip.past-part${seen.has(id) ? '.seen' : ''}`, { href: `#/past/${id}` },
      names.get(p.code), el('small', { text: ` ${pagesOf(p)}쪽` }), seen.has(id) ? ' ✓' : null);
  };

  const exams = data.exams.filter((x) => sel === 'all' || x.parts.some((p) => p.code === sel));
  const cards = exams.map((x) => {
    const parts = sel === 'all' ? x.parts : x.parts.filter((p) => p.code === sel);
    return el(`div.card.past-card${x.star ? '.hot' : ''}`, {},
      el('div.assess-top', {}, el('h3', { text: x.title }), x.note ? el('span.badge.graduated', { text: x.note }) : null),
      el('p.meta', { text: `${label(x.month)} · ${data.grade} · ${x.parts.length}과목` }),
      el('div.chips.past-parts', {}, parts.map((p) => partBtn(x, p)))
    );
  });

  ctx.show(
    el('section.hero', {},
      el('p.eyebrow', { text: `${getCurrentLearner()} · 기출문제` }),
      el('h1', { text: '학교 기출문제' }),
      el('p.sub', { text: '지난 정기고사 7학년 시험지입니다. ⭐ 작년 같은 시기 시험(2025학년도 2학기 2차)부터 보면 출제 모양을 알 수 있어요.' })
    ),
    el('div.wrap', {},
      el('div.filter-bar', {},
        el('div.chips', {},
          el('button.chip.pick', { type: 'button', 'aria-pressed': String(sel === 'all'), text: '모든 과목', onclick: () => go('all') }),
          data.subjects.map((s) => el('button.chip.pick', { type: 'button', 'aria-pressed': String(sel === s.code), text: s.name, onclick: () => go(s.code) }))
        )
      ),
      exams.length ? el('div.grid', {}, cards) : el('p.meta', { text: '이 과목 기출문제가 없습니다.' }),
      el('p.past-source', { text: `출처: ${data.source}` })
    )
  );
}

/* ── 시험지 보기 ─────────────────────────────────── */
async function renderPastPaper(ctx, examId, code) {
  ctx.setNav('past');
  let data;
  try { data = await loadPast(ctx); } catch { return ctx.renderMissing('기출문제 목록을 불러오지 못했습니다.'); }
  const exam = data.exams.find((x) => x.id === examId);
  const part = exam?.parts.find((p) => p.code === code);
  if (!part) return ctx.renderMissing('그런 기출문제가 없습니다.');
  const names = new Map(data.subjects.map((s) => [s.code, s.name]));
  const subject = names.get(code);
  const id = `${examId}/${code}`;
  document.title = `${subject} · ${exam.title} — 기출문제`;

  // 같은 과목의 다른 회차 (최근 것부터)
  const sameSubject = data.exams.filter((x) => x.parts.some((p) => p.code === code));
  const i = sameSubject.indexOf(exam);
  const newer = sameSubject[i - 1];
  const older = sameSubject[i + 1];

  const pages = [];
  const pageNo = [];
  for (let n = part.from; n <= part.to; n++) {
    const src = pageSrc(examId, n);
    pageNo.push(n);
    pages.push(el('figure.past-page', {},
      el('a', { href: src, target: '_blank', rel: 'noopener', title: '새 창에서 크게 보기' },
        el('img', { src, alt: `${subject} ${n - part.from + 1}쪽`, loading: n === part.from ? 'eager' : 'lazy', width: '1075', height: '1521' })),
      el('figcaption', { text: `${n - part.from + 1} / ${pagesOf(part)}쪽` })
    ));
  }

  const seenBtn = el('button.pill.small', { type: 'button' });
  const paintSeen = () => {
    const on = readSeen().has(id);
    seenBtn.textContent = on ? '✓ 다 봤어요 (취소)' : '다 봤어요';
    seenBtn.classList.toggle('ghost', on);
  };
  seenBtn.addEventListener('click', () => { setSeen(id, !readSeen().has(id)); paintSeen(); });
  paintSeen();

  const view = el('div.wrap.past-view', {},
      el('a.back', { href: `#/past?s=${code}`, text: `기출문제 · ${subject}` }),
      el('h1.past-title', { text: `${subject} — ${exam.title}` }),
      el('p.meta', { text: `${label(exam.month)} · ${data.grade} · ${pagesOf(part)}쪽${exam.note ? ` · ${exam.note}` : ''}` }),
      el('div.chips.past-parts', {},
        exam.parts.map((p) => el(`a.chip.pick`, { href: `#/past/${examId}/${p.code}`, 'aria-pressed': String(p.code === code), text: names.get(p.code) }))
      ),
      el('p.past-tip', { text: '종이에 답을 먼저 써 보고 풀어 보세요. 그림을 누르면 새 창에서 크게 볼 수 있어요. (정답지는 없습니다)' }),
      pages,
      el('div.hero-actions', {},
        seenBtn,
        newer ? el('a.pill.ghost.small', { href: `#/past/${newer.id}/${code}`, text: `← 최근 회차 (${label(newer.month)})` }) : null,
        older ? el('a.pill.ghost.small', { href: `#/past/${older.id}/${code}`, text: `이전 회차 (${label(older.month)}) →` }) : null
      )
    );
  // 연필·지우개 — 쪽 그림마다 그림판을 덮는다
  const ink = inkTools(view, `past.${examId}.${code}`);
  pages.forEach((fig, i) => ink.add(fig, `p${pageNo[i]}`));
  ctx.show(view);
}
