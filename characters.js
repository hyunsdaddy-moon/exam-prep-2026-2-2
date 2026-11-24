/*
 * 시험 준비 웹앱 — 캐릭터 고르기 (옛날 비트맵 게임의 「PLAYER SELECT」 화면)
 *   #/me   참여자마다 캐릭터 10종 가운데 하나를 고른다
 *
 * 고른 것은 기록(records)에 type 'profile' 로 덧붙인다 — 마지막에 고른 것이 이긴다. 모든 기기에 바로 보인다.
 * 그림 파일: assets/characters/c01.webp … c10.webp. 고르지 않은 참여자는 기본 그림 c00.webp.
 */

import { el } from './dom.js?v=20261124-1859';
import { loadRecords, saveRecords, getCurrentLearner } from './store.js?v=20261124-1859';
import { recordLearner } from './grade.mjs?v=20261124-1859';
import { changePin, isProtected } from './lock.js?v=20261124-1859';

export const CHARACTERS = [
  { id: 'c01', name: '탐험가 하루', role: '모험 · 지리', color: '#e0a030', line: '지도만 있으면 어디든 간다!' },
  { id: 'c02', name: '실험왕 소라', role: '과학', color: '#3fa7a0', line: '왜 그런지 실험해 보자!' },
  { id: 'c03', name: '책벌레 준', role: '국어 · 독서', color: '#7a5bc4', line: '한 줄 더 읽으면 보인다.' },
  { id: 'c04', name: '수학 마법사 별이', role: '수학', color: '#3a63c9', line: '공식은 나의 주문!' },
  { id: 'c05', name: '축구 소년 민호', role: '체력 · 끈기', color: '#d6453b', line: '끝까지 달린다!' },
  { id: 'c06', name: '꼬마 화가 다온', role: '미술 · 상상', color: '#e0679a', line: '틀려도 다시 그리면 돼.' },
  { id: 'c07', name: '우주비행사 유나', role: '지구와 달', color: '#5b6b80', line: '달의 모양을 맞혀 볼까?' },
  { id: 'c08', name: '요리사 도윤', role: '꼼꼼함', color: '#e87d2f', line: '재료도 공식도 정확하게!' },
  { id: 'c09', name: '기사 지안', role: '도덕 · 정의', color: '#8a8f99', line: '옳은 길을 지킨다!' },
  { id: 'c10', name: '로봇 박사 세온', role: '영어 · 코딩', color: '#4f9d4a', line: 'Let’s go, robot!' },
];
const byId = new Map(CHARACTERS.map((c) => [c.id, c]));
const imageOf = (id) => `assets/characters/${id}.webp?v=2`;

/* ── 참여자 → 캐릭터 (모든 화면이 함께 쓴다) ── */
let profiles = new Map();

/** 기록을 읽어 참여자별 마지막 캐릭터를 다시 센다 */
export async function refreshProfiles(records) {
  const list = records || (await loadRecords()).records;
  const next = new Map();
  const sorted = list.filter((r) => r && r.type === 'profile' && byId.has(r.character)).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const r of sorted) next.set(recordLearner(r), r.character);
  profiles = next;
  return profiles;
}

export const characterOf = (name) => byId.get(profiles.get(name)) || null;

/** 캐릭터 그림. 아직 고르지 않았으면 기본 그림(c00). size: 'xs' | 'sm' | 'md' | 'lg' | 'portrait' */
export function charPicture(c, size = 'md') {
  const box = el(`span.char-pic.${size}`, { style: `--char:${c ? c.color : '#b9b9c0'}`, title: c ? c.name : '캐릭터를 고르지 않았습니다' });
  const img = el('img', { src: imageOf(c ? c.id : 'c00'), alt: c ? c.name : '기본 캐릭터', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.remove());
  box.append(img);
  return box;
}

/** 이름 앞에 붙이는 작은 얼굴 */
export const avatar = (name, size = 'xs') => charPicture(characterOf(name), size);

/* ── 캐릭터 고르기 화면 ── */
export async function renderCharacterSelect(ctx) {
  document.title = '캐릭터 고르기 — 시험 준비';
  ctx.setNav('me');
  const loaded = await loadRecords();
  await refreshProfiles(loaded.records);
  const me = getCurrentLearner();
  let mine = characterOf(me);
  let cursor = mine ? CHARACTERS.indexOf(mine) : 0;

  const preview = el('div.px-preview');
  const status = el('p.px-status', { 'aria-live': 'polite' });
  const cells = CHARACTERS.map((c, i) =>
    el('button.px-cell', { type: 'button', 'aria-label': c.name, onclick: () => move(i), ondblclick: () => void choose() },
      el('span.px-no', { text: String(i + 1).padStart(2, '0') }),
      charPicture(c, 'md'),
      el('span.px-name', { text: c.name })
    )
  );

  function move(i) {
    cursor = (i + CHARACTERS.length) % CHARACTERS.length;
    const c = CHARACTERS[cursor];
    cells.forEach((b, k) => {
      b.classList.toggle('on', k === cursor);
      b.classList.toggle('mine', mine && CHARACTERS[k].id === mine.id);
      b.setAttribute('aria-pressed', String(k === cursor));
    });
    preview.replaceChildren(
      charPicture(c, 'lg'),
      el('div.px-info', {},
        el('p.px-label', { text: `PLAYER ${String(cursor + 1).padStart(2, '0')}` }),
        el('h2', { text: c.name }),
        el('p.px-role', { text: `특기 · ${c.role}` }),
        el('p.px-line', { text: `“${c.line}”` }),
        el('button.px-start', { type: 'button', text: mine && mine.id === c.id ? '▶ 지금 캐릭터' : '▶ 이 캐릭터로 시작', onclick: () => void choose() })
      )
    );
  }

  async function choose() {
    const c = CHARACTERS[cursor];
    status.textContent = '저장 중…';
    const r = await saveRecords([{ type: 'profile', character: c.id }]);
    await refreshProfiles();
    mine = characterOf(me);
    ctx.setNav('me'); // 위쪽 메뉴의 얼굴도 바로 바꾼다
    status.textContent = r.ok ? `${me}의 캐릭터를 「${c.name}」(으)로 정했습니다!` : '이 브라우저에 먼저 저장했습니다. 연결되면 다른 기기에도 보입니다.';
    move(cursor);
  }

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const k = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 }[e.key];
    if (k) {
      e.preventDefault();
      move(cursor + k);
      cells[cursor].focus();
    } else if (e.key === 'Enter' && document.activeElement?.classList.contains('px-cell')) {
      e.preventDefault();
      void choose();
    }
  };
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => document.removeEventListener('keydown', onKey));

  ctx.show(
    el('div.px-screen', {},
      el('div.px-wrap', {},
        el('p.px-title', { text: '★ PLAYER SELECT ★' }),
        el('p.px-sub', {}, el('b', { text: me }), ' 님, 함께 공부할 캐릭터를 고르세요'),
        el('div.px-stage', {}, preview, el('div.px-grid', {}, cells)),
        status,
        el('p.px-help', { text: '← → ↑ ↓ 로 움직이고 Enter, 또는 두 번 눌러 고르기' }),
        isProtected(me) ? el('p.px-help', {}, el('button.link', { type: 'button', text: '🔒 비밀번호 변경', onclick: async () => {
          if (await changePin()) status.textContent = '비밀번호를 바꿨습니다. 다음부터 새 비밀번호로 들어오세요.';
        } })) : null,
        el('p.px-help', {}, el('a', { href: '#/', text: '◀ 처음 화면으로' }))
      )
    )
  );
  move(cursor);
}
