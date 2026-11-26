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
 * 다른 모듈을 고치지 않는다: 화면에 그려진 문제(article.q-card · article.p-q · li.dr-card)를 찾아
 * 버튼을 붙이고, 보낼 글도 화면에서 읽는다. 그래서 정답·해설은 채점한 뒤에만 함께 간다.
 */

import { el, CIRCLED } from './dom.js?v=20261126-0923';

const KEY = 'examprep.voiceAsk';
const BRIDGE = 'http://127.0.0.1:47611';
const Q_SEL = 'article.q-card, article.p-q, li.dr-card';
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
.va-pill { position: fixed; right: 16px; bottom: 16px; z-index: 60; max-width: min(360px, calc(100vw - 32px)); display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px; border-radius: 999px; background: rgba(29, 29, 31, .92); color: #fff; font-size: 14px; box-shadow: var(--shadow); }
.va-pill[hidden] { display: none; }
.va-pill.va-error { background: #8a1c12; }
.va-pill-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-pill-text small { display: block; opacity: .75; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.va-dot { width: 9px; height: 9px; border-radius: 50%; background: #8e8e93; flex: none; }
.va-pill.va-live .va-dot { background: #30d158; animation: va-pulse 1.4s ease-in-out infinite; }
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
  copy.querySelectorAll('.va-ask, .ex-row, .dq-hist-row, .conf-row, .segment, textarea, input, select, canvas, video, svg, script, style').forEach((n) => n.remove());
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

/** 버튼이 붙은 문제 → MultyAM 에 보낼 내용 */
export function questionPayload(qNode, app) {
  const images = [];
  let text = readableText(qNode, images);
  if (text.length > MAX_QUESTION) text = `${text.slice(0, MAX_QUESTION)}…`;
  const ctx = contextOf(qNode, app);
  if (ctx) {
    const room = MAX_TEXT - text.length - 20;
    let passage = readableText(ctx, images);
    if (passage.length > room) passage = `${passage.slice(0, Math.max(0, room))}…`;
    if (passage) text = `[지문] ${passage}\n[문제] ${text}`;
  }
  const label = (qNode.querySelector('.q-no, .p-no, .dr-no')?.textContent || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return {
    subject: document.title.replace(/\s*—\s*시험 준비\s*$/, '').slice(0, 60),
    label: /^\d+$/.test(label) ? `${label}번` : label.slice(0, 40),
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

function statusLine(s, sending) {
  if (sending) return ['MultyAM 에 연결하는 중…'];
  if (s.phase === 'ending') return ['통화를 끊는 중…'];
  if (s.phase !== 'live') return ['통화를 여는 중… (10초쯤 걸려요)'];
  if (!s.ready) return ['준비 중… 잠시만 기다려요', s.label];
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
  const pill = el('div.va-pill', { hidden: true, role: 'status', 'aria-live': 'polite' }, el('span.va-dot'), text, hang);
  document.body.append(pill);

  const active = () => sending || status.phase !== 'idle';

  const paint = () => {
    if (errorTimer) return; // 오류 안내가 떠 있는 동안은 그대로 둔다
    pill.classList.remove('va-error');
    pill.hidden = !active();
    if (pill.hidden) {
      askedNode?.querySelector('.va-ask')?.classList.remove('va-on');
      return;
    }
    const [line, sub] = statusLine(status, sending);
    pill.classList.toggle('va-live', status.phase === 'live' && !!status.ready);
    hang.hidden = sending || status.phase === 'ending';
    text.replaceChildren(line, sub ? el('small', { text: sub }) : '');
  };

  const showError = (message) => {
    clearTimeout(errorTimer);
    pill.hidden = false;
    pill.classList.add('va-error');
    pill.classList.remove('va-live');
    hang.hidden = true;
    text.replaceChildren(message);
    errorTimer = setTimeout(() => { errorTimer = 0; paint(); }, 7000);
  };

  const schedulePoll = () => {
    clearTimeout(pollTimer);
    pollTimer = active() ? setTimeout(poll, 1200) : 0;
  };

  async function poll() {
    clearTimeout(pollTimer);
    try {
      const s = await call('/voice/status');
      if (s.app !== 'multyam') throw new Error('not multyam');
      connected = true;
      status = s;
    } catch {
      connected = false;
      status = { phase: 'idle' };
    }
    paint();
    decorate();
    schedulePoll();
  }

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
