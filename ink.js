/*
 * 연필·지우개 — 문제 위에 마우스·손가락·펜으로 밑줄, ○, ／ 를 그린다.
 *
 *   const ink = inkTools(root, '구역 이름');   // root 안에 도구 막대를 붙인다
 *   ink.add(문제 블록, '문제 id');              // 그 블록 위에 투명한 그림판을 덮는다
 *
 * - 그림은 채점과 상관없다. 연필을 끄면 지금처럼 선지를 눌러 답을 고른다.
 * - 문제마다 이 브라우저(localStorage)에 남는다. 제출한 뒤에도 남고, 「모두 지우기」로만 지운다.
 * - 좌표는 블록 너비를 1 로 삼아 저장한다 → 창 크기가 바뀌어도 같은 자리에 다시 그린다.
 */

import { el } from './dom.js?v=20261125-1802';
import { getCurrentLearner } from './store.js?v=20261125-1802';

const COLORS = { r: '#e0281e', b: '#1f63e0', k: null }; // k(검정)는 글자색을 따른다 (어두운 화면에서도 보이게)
const COLOR_NAME = { r: '빨강', b: '파랑', k: '검정' };
const PEN_PX = 2.6;
const ERASE_PX = 14;
const MAX_PIXELS = 16e6; // 아이패드 캔버스 한도 안쪽

const state = { mode: 'off', color: 'r' };
const listeners = new Set();
const setMode = (mode) => {
  state.mode = mode;
  document.body.classList.toggle('ink-on', mode !== 'off');
  document.body.classList.toggle('ink-erase', mode === 'eraser');
  for (const f of listeners) f();
};

export function inkTools(root, scope) {
  const learner = getCurrentLearner();
  const hosts = []; // { node, id, strokes, draw, save }
  const undo = []; // 마지막에 그은 선부터 되돌린다 { host, stroke }
  setMode('off');

  const keyOf = (id) => `examprep.ink.${learner}.${scope}.${id}`;
  const read = (id) => {
    try {
      const v = JSON.parse(localStorage.getItem(keyOf(id)) || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };

  function add(node, id) {
    const canvas = el('canvas.ink-layer', { 'aria-hidden': 'true' });
    node.classList.add('ink-host');
    node.append(canvas);
    const ctx2d = canvas.getContext('2d');
    const h = { node, id: String(id), strokes: read(id) };
    let W = 1;
    let scale = 1;

    h.save = () => {
      try {
        if (h.strokes.length) localStorage.setItem(keyOf(h.id), JSON.stringify(h.strokes));
        else localStorage.removeItem(keyOf(h.id));
      } catch {
        // 저장 공간이 없으면 이 화면에서만 보인다
      }
    };
    const colorOf = (c) => COLORS[c] || getComputedStyle(node).color || '#1d1d1f';
    const strokePath = (s) => {
      const p = s.p;
      ctx2d.strokeStyle = colorOf(s.c);
      ctx2d.lineWidth = s.w * W;
      ctx2d.beginPath();
      ctx2d.moveTo(p[0] * W, p[1] * W);
      if (p.length === 2) ctx2d.lineTo(p[0] * W + 0.01, p[1] * W); // 점 하나
      for (let i = 2; i < p.length; i += 2) ctx2d.lineTo(p[i] * W, p[i + 1] * W);
      ctx2d.stroke();
    };
    h.draw = () => {
      ctx2d.setTransform(scale, 0, 0, scale, 0, 0);
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      for (const s of h.strokes) strokePath(s);
    };
    const fit = () => {
      W = node.clientWidth || 1;
      const H = node.clientHeight || 1;
      const dpr = window.devicePixelRatio || 1;
      scale = Math.min(dpr, Math.sqrt(MAX_PIXELS / (W * H)));
      const cw = Math.round(W * scale);
      const ch = Math.round(H * scale);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      h.draw();
    };
    new ResizeObserver(fit).observe(node);

    // ── 그리기 ──
    let cur = null; // 긋고 있는 선
    let pid = null;
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      return [+((e.clientX - r.left) / W).toFixed(4), +((e.clientY - r.top) / W).toFixed(4)];
    };
    const eraseAt = (x, y) => {
      const r = ERASE_PX / W;
      const before = h.strokes.length;
      h.strokes = h.strokes.filter((s) => {
        for (let i = 0; i < s.p.length; i += 2) if (Math.hypot(s.p[i] - x, s.p[i + 1] - y) < r + s.w / 2) return false;
        // 점과 점 사이가 멀 때(빠르게 그은 선) 선분까지의 거리도 본다
        for (let i = 2; i < s.p.length; i += 2) if (segDist(x, y, s.p[i - 2], s.p[i - 1], s.p[i], s.p[i + 1]) < r + s.w / 2) return false;
        return true;
      });
      if (h.strokes.length !== before) {
        h.draw();
        h.save();
      }
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (state.mode === 'off' || pid !== null) return;
      if (e.button > 0) return;
      e.preventDefault();
      pid = e.pointerId;
      canvas.setPointerCapture(pid);
      const [x, y] = at(e);
      if (state.mode === 'eraser') return eraseAt(x, y);
      cur = { c: state.color, w: +(PEN_PX / W).toFixed(5), p: [x, y] };
      h.strokes.push(cur);
      h.draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [x, y] = at(ev);
        if (state.mode === 'eraser') eraseAt(x, y);
        else if (cur) {
          const n = cur.p.length;
          if (Math.hypot(cur.p[n - 2] - x, cur.p[n - 1] - y) * W < 0.8) continue; // 너무 가까운 점은 버린다
          ctx2d.setTransform(scale, 0, 0, scale, 0, 0);
          ctx2d.lineCap = 'round';
          ctx2d.lineJoin = 'round';
          ctx2d.strokeStyle = colorOf(cur.c);
          ctx2d.lineWidth = cur.w * W;
          ctx2d.beginPath();
          ctx2d.moveTo(cur.p[n - 2] * W, cur.p[n - 1] * W);
          ctx2d.lineTo(x * W, y * W);
          ctx2d.stroke();
          cur.p.push(x, y);
        }
      }
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (cur) {
        undo.push({ host: h, stroke: cur });
        cur = null;
        h.save();
        paint();
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    hosts.push(h);
    paint();
    return h;
  }

  // ── 도구 막대 ──
  const btn = (cls, label, title, onclick) => el(`button.ink-btn${cls}`, { type: 'button', title, 'aria-label': title, onclick }, label);
  const pen = btn('.ink-pen', '✏️', '연필 (한 번 더 누르면 끄기)', () => setMode(state.mode === 'pen' ? 'off' : 'pen'));
  const swatches = Object.keys(COLORS).map((c) =>
    btn(`.ink-color.ink-${c}`, el('i'), `${COLOR_NAME[c]} 연필`, () => {
      state.color = c;
      setMode('pen');
    })
  );
  const eraser = btn('.ink-eraser', '🧽', '지우개 (선을 문지르면 그 선이 지워집니다)', () => setMode(state.mode === 'eraser' ? 'off' : 'eraser'));
  const back = btn('.ink-undo', '↶', '방금 그은 선 지우기', () => {
    while (undo.length) {
      const { host, stroke } = undo.pop();
      const i = host.strokes.indexOf(stroke);
      if (i < 0) continue; // 지우개로 이미 지운 선
      host.strokes.splice(i, 1);
      host.draw();
      host.save();
      break;
    }
    paint();
  });
  let armed = null;
  const clear = btn('.ink-clear', '🗑', '이 화면의 그림 모두 지우기', () => {
    if (!hosts.some((x) => x.strokes.length)) return;
    if (!armed) {
      clear.classList.add('armed');
      clear.title = '한 번 더 누르면 모두 지웁니다';
      armed = setTimeout(() => {
        armed = null;
        clear.classList.remove('armed');
        clear.title = '이 화면의 그림 모두 지우기';
      }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    clear.classList.remove('armed');
    for (const x of hosts) {
      x.strokes = [];
      x.draw();
      x.save();
    }
    undo.length = 0;
    paint();
  });
  const off = btn('.ink-off', '✋', '그리기 끄기 (답 고르기·화면 움직이기)', () => setMode('off'));
  const bar = el('div.ink-bar', { role: 'toolbar', 'aria-label': '연필과 지우개' }, pen, ...swatches, eraser, back, clear, off);

  function paint() {
    pen.setAttribute('aria-pressed', String(state.mode === 'pen'));
    eraser.setAttribute('aria-pressed', String(state.mode === 'eraser'));
    off.hidden = state.mode === 'off';
    for (const [i, c] of Object.keys(COLORS).entries()) swatches[i].setAttribute('aria-pressed', String(state.mode === 'pen' && state.color === c));
    back.disabled = !undo.length;
    clear.disabled = !hosts.some((x) => x.strokes.length);
  }
  listeners.add(paint);

  // 문제지가 화면에 보일 때만 도구 막대를 띄운다 (읽기 문서 위쪽에서는 숨김)
  const seen = new IntersectionObserver((entries) => {
    const on = entries.some((x) => x.isIntersecting);
    bar.classList.toggle('show', on);
    if (!on && state.mode !== 'off') setMode('off');
  });
  seen.observe(root);
  root.append(bar);

  // 다른 화면으로 가면 정리한다
  const watch = new MutationObserver(() => {
    if (root.isConnected) return;
    watch.disconnect();
    seen.disconnect();
    listeners.delete(paint);
    setMode('off');
  });
  watch.observe(document.body, { childList: true, subtree: true });

  paint();
  return { add };
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
