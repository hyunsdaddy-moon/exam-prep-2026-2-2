/*
 * 시험 준비 웹앱 — 「🎙 이 문제 물어보기」 (MultyAM 음성 통화 연결)
 *
 * 이 기기에서 MultyAM(에디터 확장)이 켜져 있으면, 문제마다 🎙 버튼이 붙는다.
 * 누르면 그 문제의 글을 이 컴퓨터의 MultyAM(http://127.0.0.1:47611)으로 보내고,
 * MultyAM 이 Antigravity 실시간 음성 통화를 열어 그 문제를 아는 상태로 말로 답해 준다.
 *
 * 켜는 법: 주소 끝에 ?voice=on 을 붙여 한 번 연다 (이 기기에만 기억). 끄기는 ?voice=off.
 *   켜지 않은 기기에서는 아무것도 하지 않는다 — 내 컴퓨터 주소를 부르면 브라우저가
 *   "로컬 네트워크 접근" 허락을 묻기 때문에, 다른 사람의 기기에서는 부르지 않는다.
 *
 * 통화 중에는 AI 가 이 화면을 보고 움직일 수도 있다 (화면 보기·조작):
 *   1.2초마다 지금 화면(보이는 문제·그림 주소·열린 해설)을 MultyAM 에 알리고, AI 가 시킨 조작을 받아 와 실행한다.
 *   할 수 있는 조작은 runCommand 에 적힌 것뿐이다 — 보기·문제 이동·스크롤·해설·지문·화면 이동.
 *   **답을 고르거나 제출하는 조작은 일부러 만들지 않았다.**
 *
 * 다른 모듈을 고치지 않는다: 화면에 그려진 문제(article.q-card · article.p-q · li.dr-card)를 찾아
 * 버튼을 붙이고, 보낼 글도 화면에서 읽는다. 그래서 정답·해설은 채점한 뒤에만 함께 간다.
 */

import { el, CIRCLED } from './dom.js?v=20261126-1930';

const KEY = 'examprep.voiceAsk';
const BRIDGE = 'http://127.0.0.1:47611';
// 긴 문제를 다음 단으로 이어 넣은 조각(.a4-cont)은 문제로 세지 않는다
const Q_SEL = 'article.q-card:not(.a4-cont), article.p-q:not(.a4-cont), li.dr-card';
const CONTEXT_SEL = '.p-context, .q-context';
const GROUP_SEL = `${CONTEXT_SEL}, .p-group, .exam-group`;
const MAX_TEXT = 2300;
const MAX_QUESTION = 1500;

const CSS = `
.va-host { position: relative; }
.va-ask { font: inherit; font-size: 13px; line-height: 1; width: 26px; height: 26px; padding: 0; border-radius: 50%; border: 1px solid #b9cfee; background: #eef4fc; cursor: pointer; opacity: .7; }
.va-ask:hover, .va-ask:focus-visible { opacity: 1; background: #dde9f9; }
.va-ask:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.va-ask.va-float { position: absolute; top: -4px; right: -2px; z-index: 3; }
.q-head .va-ask { margin-left: auto; align-self: center; flex: none; }
.p-stem .va-ask { flex: none; align-self: flex-start; width: 20px; height: 20px; font-size: 11px; margin-left: 2pt; }
.va-ask.va-on { opacity: 1; background: var(--accent); border-color: var(--accent); }
.va-flash { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 4px; border-radius: 6px; transition: outline-color .4s; }
.va-pill { position: fixed; right: 16px; bottom: 16px; z-index: 60; transform-origin: 100% 100%; max-width: min(360px, calc(100vw - 32px)); display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px; border-radius: 999px; background: rgba(29, 29, 31, .92); color: #fff; font-size: 14px; box-shadow: var(--shadow); }
.va-pill[hidden] { display: none; }
.va-pill.va-error { background: #8a1c12; }
.va-pill-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-pill-text small { display: block; opacity: .75; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.va-dot { width: 9px; height: 9px; border-radius: 50%; background: #8e8e93; flex: none; }
.va-pill.va-live .va-dot { background: #30d158; animation: va-pulse 1.4s ease-in-out infinite; }
.va-mute { font: inherit; font-size: 13px; font-weight: 600; color: #fff; background: rgba(255, 255, 255, .18); border: 0; border-radius: 999px; padding: 6px 10px; cursor: pointer; flex: none; white-space: nowrap; }
.va-mute[aria-pressed="true"] { background: #fff; color: #9a4a00; }
.va-pill.va-muted { background: rgba(154, 74, 0, .95); }
.va-pill.va-muted .va-dot { background: #ffd60a; animation: none; }
.va-hang { font: inherit; font-size: 13px; font-weight: 600; color: #fff; background: #d70015; border: 0; border-radius: 999px; padding: 6px 12px; cursor: pointer; flex: none; }
@keyframes va-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .va-pill.va-live .va-dot { animation: none; } }
@media print { .va-ask, .va-pill { display: none !important; } }
`;

const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TR', 'TABLE', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'ARTICLE', 'SECTION', 'BUTTON', 'SUMMARY', 'DETAILS', 'BLOCKQUOTE', 'PRE', 'HR']);

/** 화면 조각을 읽기 좋은 글로 — 수식은 TeX 원문, 그림은 [그림] 으로 바꾸고 주소를 모은다 */
export function readableText(node, images = []) {
  const copy = node.cloneNode(true);
  // 학생이 고른 답·채점 뒤 정답 표시는 글로 남긴다
  copy.querySelectorAll('.p-choices').forEach((list) => [...list.children].forEach((li, i) => {
    const mark = li.querySelector('.p-mark');
    if (mark) mark.textContent = CIRCLED[i] || `${i + 1})`; // 칠한 보기는 숫자로 바뀌어 있다
  }));
  copy.querySelectorAll('.choice.on, .p-choices li.on > .p-pick').forEach((c) => c.append(' ←학생이 고른 답'));
  copy.querySelectorAll('.choice.right').forEach((c) => c.append(' ←정답'));
  copy.querySelectorAll('.va-ask, .a4-cont-sum, .ex-row, .dq-hist-row, .conf-row, .segment, textarea, input, select, canvas, video, svg, script, style').forEach((n) => n.remove());
  copy.querySelectorAll('button:not(.choice):not(.p-pick)').forEach((n) => n.remove());
  copy.querySelectorAll('.katex').forEach((k) => k.replaceWith(` ${k.querySelector('annotation')?.textContent || ''} `));
  copy.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) {
      try { images.push(new URL(src, location.href).href); } catch { /* 주소가 이상하면 뺀다 */ }
    }
    img.replaceWith(`[그림${img.getAttribute('alt') ? `: ${img.getAttribute('alt')}` : ''}]`);
  });
  // 보기는 번호와 글을 한 줄로
  copy.querySelectorAll('.choice, .p-pick').forEach((b) => { b.textContent = b.textContent.replace(/\s+/g, ' ').trim(); });
  let out = '';
  const walk = (n) => {
    if (n.nodeType === 3) { out += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const block = BLOCK.has(n.tagName);
    if (block) out += '\n';
    for (const c of n.childNodes) walk(c);
    if (n.tagName === 'TD' || n.tagName === 'TH') out += ' | ';
    if (block) out += '\n';
  };
  walk(copy);
  return out.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

/** 이 문제에 딸린 지문 — 문제 안에 없으면, 바로 앞 묶음이 지문일 때만 */
function contextOf(qNode, app) {
  if (qNode.querySelector(CONTEXT_SEL)) return null; // 문제 안에 이미 들어 있다
  let last = null;
  for (const n of app.querySelectorAll(GROUP_SEL)) {
    if (n.compareDocumentPosition(qNode) & Node.DOCUMENT_POSITION_FOLLOWING) last = n;
    else break;
  }
  return last && last.matches(CONTEXT_SEL) ? last : null;
}

/** 문제 번호표 — '3번', '서술형 1번' */
function labelOf(qNode) {
  const label = (qNode.querySelector('.q-no, .p-no, .dr-no')?.textContent || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return /^(서술형 )?\d+$/.test(label) ? `${label}번` : label.slice(0, 40);
}

/** 버튼이 붙은 문제 → MultyAM 에 보낼 내용 */
export function questionPayload(qNode, app) {
  const images = [];
  // 긴 문제는 다음 단에 이어진 조각까지 모아 읽는다
  const parts = [qNode, ...[...app.querySelectorAll('.a4-cont')].filter((c) => c.a4Root === qNode)];
  let text = parts.map((part) => readableText(part, images)).filter(Boolean).join('\n');
  if (text.length > MAX_QUESTION) text = `${text.slice(0, MAX_QUESTION)}…`;
  const ctx = contextOf(qNode, app);
  if (ctx) {
    const room = MAX_TEXT - text.length - 20;
    let passage = readableText(ctx, images);
    if (passage.length > room) passage = `${passage.slice(0, Math.max(0, room))}…`;
    if (passage) text = `[지문] ${passage}\n[문제] ${text}`;
  }
  return {
    subject: document.title.replace(/\s*—\s*시험 준비\s*$/, '').slice(0, 60),
    label: labelOf(qNode),
    text,
    images: [...new Set(images)].slice(0, 4),
    url: location.href.slice(0, 480),
  };
}

async function call(path, body) {
  const r = await fetch(`${BRIDGE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(body ? 30000 : 1500),
  });
  const j = await r.json().catch(() => null);
  if (!j) throw new Error('bad response');
  return j;
}

function statusLine(s, sending, muted) {
  if (sending) return ['MultyAM 에 연결하는 중…'];
  if (s.phase === 'ending') return ['통화를 끊는 중…'];
  if (s.phase !== 'live') return ['통화를 여는 중… (10초쯤 걸려요)'];
  if (!s.ready) return ['준비 중… 잠시만 기다려요', s.label];
  if (muted) return ['🔇 내 말 안 들음', `AI 는 하던 일 계속해요${s.label ? ` · ${s.label}` : ''}`];
  return [`${s.activity || '듣는 중'}${s.elapsed ? ` · ${s.elapsed}` : ''} — 말로 물어보세요`, s.heard ? `“${s.heard}”` : s.label];
}

export function initVoiceAsk() {
  const param = new URLSearchParams(location.search).get('voice');
  if (param === 'on' || param === 'off') {
    try {
      if (param === 'on') localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch { /* 저장을 못 하면 이번에만 */ }
    const u = new URL(location.href);
    u.searchParams.delete('voice');
    history.replaceState(null, '', u);
  }
  let enabled = param === 'on';
  try { enabled = enabled || localStorage.getItem(KEY) === '1'; } catch { /* 그대로 */ }
  if (param === 'off' || !enabled) return;

  const app = document.getElementById('app');
  if (!app) return;
  document.head.append(el('style', { text: CSS }));

  let connected = false;
  let status = { phase: 'idle' };
  let sending = false;
  let pollTimer = 0;
  let errorTimer = 0;
  let askedNode = null;
  let framed = false;

  const text = el('div.va-pill-text');
  const hang = el('button.va-hang', { type: 'button', text: '끊기', onclick: () => {
    hang.disabled = true;
    call('/voice/hangup', {}).catch(() => {}).finally(() => { hang.disabled = false; poll(); });
  } });
  // 🔇 — 일을 시켜 놓고 혼잣말·옆 사람과 이야기해도 AI 에게 가지 않게 (MultyAM 이 통화의 마이크를 끈다).
  // AI 는 하던 일을 계속하고 목소리도 들린다. 통화 화면에 바뀐 상태가 뜨기까지 잠깐 걸려, 누른 뒤 3초는 누른 쪽을 믿는다
  let muteWant = null;
  const isMuted = () => (muteWant && Date.now() < muteWant.until ? muteWant.on : !!status.muted);
  const mute = el('button.va-mute', { type: 'button', onclick: () => {
    const on = !isMuted();
    muteWant = { on, until: Date.now() + 3000 };
    paint();
    call('/voice/mute', { on }).then((r) => {
      if (r && r.ok) return;
      muteWant = null;
      showError(r && r.error === 'not found' ? 'MultyAM 을 새로 고쳐야 음소거를 쓸 수 있어요' : '음소거를 바꾸지 못했어요');
    }).catch(() => { muteWant = null; showError('MultyAM 에 닿지 않아요'); }).finally(() => schedulePoll(300));
  } });
  const pill = el('div.va-pill', { hidden: true, role: 'status', 'aria-live': 'polite' }, el('span.va-dot'), text, mute, hang);
  document.body.append(pill);

  // 화면 확대(⌘+ 쪽 확대, 트랙패드 두 손가락 확대)를 해도 통화 표시줄은 늘 같은 크기로
  // 보이는 화면의 오른쪽 아래에 둔다 — 확대한 만큼 거꾸로 줄이고, 보이는 영역 모서리에 붙인다
  const pageZoom = () => {
    const ratio = window.outerWidth && window.innerWidth ? window.outerWidth / window.innerWidth : 1;
    const dpr = window.devicePixelRatio || 1;
    let best = ratio > 0.2 && ratio < 6 ? ratio : 1;
    let gap = Infinity;
    for (const base of [1, 1.25, 1.5, 2, 3]) { // 화면 본래 배율 후보 — 창 비율과 가장 가까운 것
      const z = dpr / base;
      if (Math.abs(z - ratio) < gap) { gap = Math.abs(z - ratio); best = z; }
    }
    return gap < 0.15 ? best : (ratio > 0.2 && ratio < 6 ? ratio : 1);
  };
  const fitPill = () => {
    if (pill.hidden) return;
    const vv = window.visualViewport;
    const pinch = vv ? vv.scale || 1 : 1;
    const k = 1 / (pageZoom() * pinch);
    const de = document.documentElement;
    const visW = vv ? vv.width : de.clientWidth;
    const right = vv ? de.clientWidth - (vv.offsetLeft + vv.width) : 0;
    const bottom = vv ? de.clientHeight - (vv.offsetTop + vv.height) : 0;
    pill.style.right = `${right + 16 * k}px`;
    pill.style.bottom = `${bottom + 16 * k}px`;
    pill.style.maxWidth = `${Math.max(160, Math.min(360, visW / k - 32))}px`;
    pill.style.transform = Math.abs(k - 1) < 0.01 ? '' : `scale(${k})`;
  };
  window.addEventListener('resize', fitPill);
  window.visualViewport?.addEventListener('resize', fitPill);
  window.visualViewport?.addEventListener('scroll', fitPill);

  const active = () => sending || status.phase !== 'idle';

  const paint = () => {
    if (errorTimer) return; // 오류 안내가 떠 있는 동안은 그대로 둔다
    pill.classList.remove('va-error');
    pill.hidden = !active();
    if (pill.hidden) {
      askedNode?.querySelector('.va-ask')?.classList.remove('va-on');
      return;
    }
    const live = status.phase === 'live' && !!status.ready && !sending;
    const muted = live && isMuted();
    const [line, sub] = statusLine(status, sending, muted);
    pill.classList.toggle('va-live', live);
    pill.classList.toggle('va-muted', muted);
    mute.hidden = !live;
    mute.textContent = muted ? '🎙 다시 듣기' : '🔇 음소거';
    mute.setAttribute('aria-pressed', String(muted));
    mute.title = muted ? '다시 내 말을 AI 에게 보내기' : '내 말을 AI 에게 보내지 않기 (AI 는 하던 일 계속)';
    hang.hidden = sending || status.phase === 'ending';
    text.replaceChildren(line, sub ? el('small', { text: sub }) : '');
    fitPill();
  };

  const showError = (message) => {
    clearTimeout(errorTimer);
    pill.hidden = false;
    pill.classList.add('va-error');
    pill.classList.remove('va-live', 'va-muted');
    mute.hidden = true;
    hang.hidden = true;
    text.replaceChildren(message);
    fitPill();
    errorTimer = setTimeout(() => { errorTimer = 0; paint(); }, 7000);
  };

  const schedulePoll = (delay = 1200) => {
    clearTimeout(pollTimer);
    pollTimer = active() ? setTimeout(poll, delay) : 0;
  };

  /* ── 통화 중 화면 보기·조작 ── */
  let results = []; // 방금 한 조작의 결과 — 다음 알림 때 함께 보낸다
  const questions = () => [...app.querySelectorAll(Q_SEL)];
  const inView = (n) => { const r = n.getBoundingClientRect(); return r.bottom > 60 && r.top < window.innerHeight - 20; };
  /** 지금 문제 — 🎙 를 누른 문제가 화면에 남아 있으면 그것, 아니면 화면 가운데에 가장 가까운 문제 */
  const currentNode = () => {
    if (askedNode?.isConnected && inView(askedNode)) return askedNode;
    const mid = window.innerHeight / 2;
    let best = null;
    let gap = Infinity;
    for (const n of questions()) {
      const r = n.getBoundingClientRect();
      if (!r.height) continue;
      const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
      if (d < gap) { gap = d; best = n; }
    }
    return best;
  };
  /** 학생이 마우스로 끌어 고른 글 — 이 사이트 안의 글만, 300자까지 */
  const selectionInfo = () => {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return undefined;
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const host = node.nodeType === 1 ? node : node.parentElement;
    if (!host || !(app.contains(host) || host.closest('dialog')) || host.closest('input, textarea, .va-pill')) return undefined;
    const text = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) return undefined;
    const q = host.closest(Q_SEL) || (sel.anchorNode?.parentElement?.closest(Q_SEL) ?? null);
    return { text, label: q ? labelOf(q) : '' };
  };
  const buildScreen = () => {
    const all = questions();
    const cur = currentNode();
    const payload = cur ? questionPayload(cur, app) : null;
    const dialog = document.querySelector('dialog.ex-dialog[open]');
    return {
      url: location.href.slice(0, 480),
      title: document.title.slice(0, 110),
      view: all.length === 0 ? '문제가 없는 화면' : all.length === 1 ? '한 문제씩 푸는 화면' : `시험지 화면 (${all.length}문항)`,
      current: payload ? { label: payload.label, text: payload.text, images: payload.images } : undefined,
      visible: all.filter((n) => n !== cur && inView(n)).slice(0, 5).map((n) => ({ label: labelOf(n), text: readableText(n).slice(0, 400) })),
      labels: all.slice(0, 90).map(labelOf),
      dialog: dialog ? readableText(dialog).slice(0, 1500) : '',
      selection: selectionInfo(),
      results,
    };
  };
  // AI 가 시킨 이동은 미끄러지지 않고 바로 옮긴다 — 옮기자마자 알리는 화면이 정확하다
  const focusOn = (node) => {
    askedNode?.querySelector('.va-ask')?.classList.remove('va-on');
    askedNode = node;
    node.querySelector('.va-ask')?.classList.add('va-on');
    node.scrollIntoView({ block: 'center', behavior: 'auto' });
    node.classList.add('va-flash');
    setTimeout(() => node.classList.remove('va-flash'), 1600);
  };
  /** AI 가 시킨 조작 하나. 여기 적힌 것만 한다 — 답 고르기·제출은 없다 */
  const runCommand = (c) => {
    const all = questions();
    const cur = currentNode();
    const i = cur ? all.indexOf(cur) : -1;
    switch (c.action) {
      case 'look':
        return [true, ''];
      case 'goto': {
        const want = String(c.arg || '').replace(/\s+/g, '');
        const node = all.find((n) => labelOf(n).replace(/\s+/g, '') === `${want}번`);
        if (!node) return [false, `${c.arg}번 문제가 이 화면에 없다`];
        focusOn(node);
        return [true, ''];
      }
      case 'next':
      case 'prev': {
        const step = c.action === 'next' ? 1 : -1;
        if (all.length > 1) {
          const node = all[i + step];
          if (!node) return [false, step > 0 ? '마지막 문제다' : '첫 문제다'];
          focusOn(node);
          return [true, ''];
        }
        if (step < 0) return [false, '한 문제씩 푸는 화면에서는 앞 문제로 돌아갈 수 없다'];
        // 한 문제씩: 「다음 문제」·「건너뛰기」만 누른다 (결과 보기·채점은 누르지 않는다)
        const btn = [...app.querySelectorAll('button')].find((b) => ['다음 문제', '건너뛰기'].includes(b.textContent.trim()) && !b.disabled);
        if (!btn) return [false, '다음 문제로 가는 단추가 없다 (마지막 문제이거나 채점 전이다)'];
        btn.click();
        return [true, ''];
      }
      case 'scroll':
        window.scrollBy({ top: (c.arg === 'up' ? -0.7 : 0.7) * window.innerHeight, behavior: 'auto' });
        return [true, ''];
      case 'explain': {
        const btn = cur?.querySelector('.ex-btn') || [...app.querySelectorAll('.a4-cont')].find((p) => p.a4Root === cur)?.querySelector('.ex-btn');
        if (!btn) return [false, '이 문제에는 지금 누를 풀이 해설 단추가 없다 (채점한 뒤에 생기는 화면이 있다)'];
        btn.click();
        return [true, '해설 창을 열었다'];
      }
      case 'close': {
        const d = document.querySelector('dialog.ex-dialog[open]');
        if (!d) return [false, '열려 있는 해설 창이 없다'];
        d.close();
        return [true, ''];
      }
      case 'passage': {
        const box = cur?.querySelector('details.q-context') || (cur && [...app.querySelectorAll('details.q-context')].filter((d) => d.compareDocumentPosition(cur) & Node.DOCUMENT_POSITION_FOLLOWING).pop());
        if (!box) return [false, '이 문제에는 접어 둔 지문이 없다'];
        box.open = !box.open;
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return [true, box.open ? '지문을 펼쳤다' : '지문을 접었다'];
      }
      case 'go':
        if (!/^#\/[^\s]*$/.test(c.arg || '')) return [false, '갈 수 없는 주소다'];
        location.hash = c.arg;
        return [true, ''];
      default:
        return [false, '할 수 없는 조작이다'];
    }
  };
  const CMD_NAME = { look: '보기', next: '다음', prev: '이전', goto: '문제', scroll: '스크롤', explain: '해설', close: '닫기', passage: '지문', go: '이동' };

  /** 받아 온 조작을 하고 결과를 모은다. 한 것이 있으면 true */
  const runCommands = (s) => {
    const list = Array.isArray(s?.commands) ? s.commands.slice(0, 5) : [];
    for (const c of list) {
      let out;
      try { out = runCommand(c); } catch { out = [false, '조작하다 오류가 났다']; }
      results.push({ cmd: `${CMD_NAME[c.action] || c.action}${c.arg ? ` ${c.arg}` : ''}`, ok: out[0], note: out[1] });
    }
    return list.length > 0;
  };

  let polling = false;
  async function poll() {
    if (polling) return; // 붙잡힌 알림이 돌아오면 이어서 본다 — 두 줄로 겹쳐 돌지 않게
    polling = true;
    clearTimeout(pollTimer);
    let ran = false;
    const sent = [...results];
    try {
      // 통화 중에는 화면을 알리고 조작을 받아 온다. 통화가 없을 때는 상태만 묻는다
      const live = status.phase !== 'idle' && !sending;
      let s = live ? await call('/voice/sync', { screen: buildScreen() }) : await call('/voice/status');
      if (live && !s.phase) s = await call('/voice/status'); // 화면 알림을 모르는 예전 MultyAM — 상태만 묻는다
      if (s.app !== 'multyam' && !s.phase) throw new Error('not multyam');
      connected = true;
      if (live) results = results.filter((r) => !sent.includes(r)); // 알린 결과만 지운다
      ran = runCommands(s);
      status = s;
    } catch {
      connected = false;
      status = { phase: 'idle' };
    }
    polling = false;
    paint();
    decorate();
    // 새 MultyAM 은 조작이 올 때까지 알림을 붙잡았다 돌려준다(hold) — 받자마자 다시 알린다.
    // 조작을 했으면 화면이 바뀔 틈만 주고 결과를 알린다. 예전 MultyAM 은 1.2초마다
    schedulePoll(status.hold && status.phase !== 'idle' ? (ran ? 250 : 60) : 1200);
  }

  // 통화 중에 학생이 화면을 옮기거나 글을 고르면, 붙잡힌 알림을 기다리지 않고 바로 한 번 더 알린다
  let nudgeTimer = 0;
  const nudge = () => {
    if (!status.hold || status.phase === 'idle' || sending) return;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(async () => {
      try {
        const s = await call('/voice/sync', { screen: buildScreen(), nowait: true });
        if (runCommands(s)) schedulePoll(250);
      } catch { /* 다음 알림이 다시 본다 */ }
    }, 200);
  };
  window.addEventListener('scroll', nudge, { passive: true });
  document.addEventListener('selectionchange', nudge);

  async function ask(node) {
    if (sending) return;
    const payload = questionPayload(node, app);
    if (!payload.text) return;
    askedNode?.querySelector('.va-ask')?.classList.remove('va-on');
    askedNode = node;
    node.querySelector('.va-ask')?.classList.add('va-on');
    sending = true;
    paint();
    try {
      const r = await call('/voice/ask', { question: payload });
      sending = false;
      if (!r.ok) {
        status = { phase: r.phase || 'idle', ...r };
        showError(r.error || '음성 통화를 열지 못했습니다.');
      } else {
        status = r;
        paint();
      }
    } catch {
      sending = false;
      connected = false;
      status = { phase: 'idle' };
      showError('MultyAM 에 연결하지 못했습니다. 에디터에서 MultyAM 이 켜져 있는지 확인해 주세요.');
      decorate();
    }
    schedulePoll();
  }

  /** 화면에 있는 문제마다 🎙 버튼을 붙인다 (연결돼 있을 때만) */
  function decorate() {
    framed = false;
    if (!connected) {
      app.querySelectorAll('.va-ask').forEach((b) => b.remove());
      return;
    }
    const nodes = app.querySelectorAll(Q_SEL);
    for (const node of nodes) {
      if (node.querySelector(':scope .va-ask')) continue;
      const btn = el('button.va-ask', { type: 'button', title: '이 문제를 음성으로 물어보기 (MultyAM)', 'aria-label': '이 문제를 음성으로 물어보기', text: '🎙', onclick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        void ask(node);
      } });
      // 번호·배점 줄 끝에 한 칸으로 넣는다 — 글자 위에 겹쳐 띄우지 않는다
      const head = node.matches('.q-card') ? node.querySelector(':scope > .q-head') : node.querySelector(':scope > .p-stem');
      if (head) head.append(btn);
      else {
        node.classList.add('va-host');
        btn.classList.add('va-float');
        node.append(btn);
      }
    }
    // 한 문제씩 푸는 화면: 통화 중에 다음 문제로 넘어가면 새 문제를 알아서 알려 준다
    if (nodes.length === 1 && askedNode && nodes[0] !== askedNode && !askedNode.isConnected && status.phase === 'live' && !sending) {
      void ask(nodes[0]);
    }
  }

  new MutationObserver(() => {
    if (framed) return;
    framed = true;
    requestAnimationFrame(decorate);
  }).observe(app, { childList: true, subtree: true });

  // MultyAM 을 나중에 켰을 수도 있다 — 화면을 옮기거나 탭으로 돌아올 때 다시 본다
  window.addEventListener('hashchange', () => { if (!active()) void poll(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void poll(); });
  void poll();
}
