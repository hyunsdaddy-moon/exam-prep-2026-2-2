/* 시험 준비 웹앱 — 화면 조각을 만드는 작은 도우미 */

/** el('a.card', { href }, 자식…) — 글자는 항상 textContent 로 넣는다 */
export function el(spec, attrs, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** 기록에 쓰는 짧은 고유 이름 (영문·숫자만) */
export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/** 목록에 한 줄로 보여 줄 문제 앞머리 — 꾸밈 기호와 수식 명령을 걷어낸다 (18\\text{ N} → 18 N) */
export function plainStem(text, max = 60) {
  return String(text || '')
    .replace(/\\(?:text|mathrm|mathbf)\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[*`$>#_{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/* 자료 주소에 이번 배포 버전(?v=)을 붙인다. 배포할 때마다 주소가 바뀌므로 브라우저 캐시를 써도 예전 자료가 남지 않는다. */
const VERSION = new URL(import.meta.url).searchParams.get('v') || '';
export function versioned(url) {
  return VERSION ? `${url}${url.includes('?') ? '&' : '?'}v=${VERSION}` : url;
}

/**
 * 안 푼 문제 알림 팝업 — 모든 문제를 풀어야 제출할 수 있다.
 * blanks: [{ label: '3번', go: () => 그 문제로 이동 }]  확인을 누르면 첫 번째 안 푼 문제로 간다.
 */
export function showBlankAlert(blanks) {
  if (!blanks.length || document.querySelector('dialog.blank-dialog')) return;
  const list = blanks.map((b) => b.label).join(', ');
  const ok = el('button.pill.small', { type: 'button', text: `${blanks[0].label} 문제로 가기` });
  const dialog = el('dialog.blank-dialog', { 'aria-label': '안 푼 문제' },
    el('div.blank-box', {},
      el('h2', { text: '아직 안 푼 문제가 있어요' }),
      el('p.blank-list', { text: `${list} 문제를 풀지 않았습니다.` }),
      el('p.blank-desc', { text: `모든 문제를 풀어야 제출할 수 있습니다. (안 푼 문제 ${blanks.length}개)` }),
      el('div.pin-actions', {}, ok)
    )
  );
  ok.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    blanks[0].go?.();
  });
  document.body.append(dialog);
  dialog.showModal();
  ok.focus();
}

/**
 * 시험지를 실제 종이처럼 A4 쪽으로 나눠 2단(왼쪽 단 → 오른쪽 단 → 다음 쪽)으로 채운다.
 *   const pages = a4Pages(머리말, [문제 블록…]);  화면에 pages.node 를 붙인 뒤 pages.layout()
 * - 블록은 그대로 옮겨 담으므로 눌러 둔 이벤트(선지 고르기 등)는 살아 있다.
 * - 지문 제목·지문(.p-group/.p-context)은 다음 문제와 떨어지지 않게 함께 넘긴다.
 * - 그림이 늦게 뜨거나 창 크기가 바뀌면 다시 나눈다. 폰처럼 좁은 화면은 한 장으로 길게 1단.
 * - 한 단보다 긴 문제·지문은 문단 사이에서 잘라 다음 단으로 이어 넣는다 (이어진 조각은 .a4-cont).
 *   자를 곳이 없을 때(한 단보다 긴 문단·그림 하나)만 그 쪽을 A4 보다 길게 늘린다 (.a4-tall).
 */
export function a4Pages(head, blocks, pageClass = 'sheet') {
  const node = el('div.a4-pages');
  const narrow = window.matchMedia('(max-width: 640px)');
  const isLead = (b) => b && ['p-group', 'p-context', 'p-passage-lead'].some((c) => b.classList.contains(c));
  const bottomOf = (c) => {
    const last = c.lastElementChild;
    return last ? last.offsetTop + last.offsetHeight : 0;
  };

  // 문제 높이가 바뀌면(그림·지문이 늦게 뜸, 채점 뒤 해설이 펼쳐짐) 다시 나눈다
  const heights = new WeakMap();
  let queueLayout = () => {};
  const grew = new ResizeObserver((entries) => {
    let changed = false;
    for (const e of entries) {
      const h = Math.round(e.target.offsetHeight);
      if (heights.has(e.target) && heights.get(e.target) !== h && e.target.isConnected) changed = true;
      heights.set(e.target, h);
    }
    if (changed && node.isConnected) queueLayout();
  });

  /* ── 한 단보다 긴 블록 나누기 ──
   * 잘린 뒤쪽은 껍데기만 복제한 상자(.a4-cont)에 옮겨 담는다. 안의 글·버튼은 복제하지 않고 그대로 옮기므로
   * 눌러 둔 이벤트가 살아 있다. 다시 나눌 때는 먼저 전부 제자리로 돌려놓는다(undoSplits). */
  const splits = []; // { levels: [{ from, clone }], part }
  const ATOMIC = new Set(['P', 'IMG', 'TABLE', 'BUTTON', 'TEXTAREA', 'LI', 'SUMMARY', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'FIGURE', 'VIDEO', 'CANVAS', 'SVG', 'INPUT', 'SELECT', 'LABEL', 'SPAN', 'B', 'A']);
  const inFlow = (k) => {
    const cs = getComputedStyle(k);
    return cs.display !== 'none' && cs.position !== 'absolute' && cs.position !== 'fixed';
  };
  /** 안으로 들어가 자를 수 있는 상자인지 — 위에서 아래로 쌓이는 상자만 */
  const canEnter = (k) => {
    if (ATOMIC.has(k.tagName) || !k.children.length) return false;
    // 문제 머리줄(번호 | 글 | 배점)은 가로로 놓이지만, 글 속에 긴 인용문이 들면 그 글 안에서 자른다
    if (k.classList.contains('p-stem')) return true;
    const cs = getComputedStyle(k);
    if (cs.columnCount !== 'auto') return false;
    if (cs.display === 'block' || cs.display === 'flow-root' || cs.display === 'list-item') return true;
    return cs.display === 'flex' && cs.flexDirection === 'column';
  };
  const shell = (from) => {
    const clone = from.cloneNode(false);
    clone.removeAttribute('id');
    clone.classList.add('a4-cont');
    clone.a4Cont = true;
    if (from.tagName === 'DETAILS') {
      const sum = el('summary.a4-cont-sum', { text: '↳ 앞에서 이어짐' });
      sum.a4Cont = true;
      sum.a4Sum = true;
      clone.append(sum);
    }
    return clone;
  };
  /** box 를 maxBottom(화면 y) 아래로 넘치는 곳에서 자른다. 넘치는 뒤쪽을 담은 복제 상자를 돌려준다. 못 자르면 null */
  const cutAt = (box, maxBottom, levels) => {
    const kids = [...box.children].filter((k) => !k.a4Sum && inFlow(k));
    const i = kids.findIndex((k) => k.getBoundingClientRect().bottom > maxBottom);
    if (i < 0) return null;
    const kid = kids[i];
    const inner = canEnter(kid) ? cutAt(kid, maxBottom, levels) : null;
    if (!inner && i === 0) return null; // 첫 덩어리부터 안 들어간다 — 앞에 남길 것이 없다
    const clone = shell(box);
    const moved = [];
    for (let n = inner ? kid.nextSibling : kid; n; n = n.nextSibling) moved.push(n);
    clone.append(...(inner ? [inner] : []), ...moved);
    box.classList.add('a4-cut');
    levels.push({ from: box, clone });
    return clone;
  };
  const undoSplits = () => {
    while (splits.length) {
      const s = splits.pop(); // 나중에 자른 것부터 되돌린다
      for (const { from, clone } of s.levels) {
        from.append(...[...clone.childNodes].filter((n) => !n.a4Cont));
        from.classList.remove('a4-cut');
      }
      grew.unobserve(s.part);
      s.part.remove();
    }
  };

  const layout = () => {
    const y = window.scrollY;
    undoSplits();
    node.replaceChildren();
    // 문제 블록이 나중에 채워지는 화면도 있다(실전·평가) — 나눌 때마다 지켜볼 대상을 맞춘다
    blocks.forEach((b) => grew.observe(b));
    if (narrow.matches) {
      node.append(el(`div.${pageClass}.a4-flat`, {}, head, el('div.cols', {}, blocks)));
      return;
    }
    const pages = [];
    let cols = [];
    let ci = 0;
    // 이 쪽의 한 단 높이. 쪽을 늘리면(a4-tall) 단도 따라 늘어나므로, 늘리기 전에 재 둔 값으로 견준다 —
    // 안 그러면 긴 문제 하나 뒤로는 무엇이든 "들어간다"가 되어 남은 문제가 한 단에 끝없이 이어진다
    let limit = 0;
    const newPage = () => {
      cols = [el('div.a4-col'), el('div.a4-col')];
      ci = 0;
      const page = el(`div.${pageClass}.a4`, {}, pages.length ? null : head, el('div.a4-cols', {}, cols), el('div.a4-no'));
      pages.push(page);
      node.append(page);
      limit = cols[0].clientHeight;
    };
    const next = () => {
      if (ci === 0) ci = 1;
      else newPage();
      return cols[ci];
    };
    newPage();
    const markTall = () => pages[pages.length - 1].classList.add('a4-tall'); // 자를 곳이 없으면 그 쪽만 늘린다
    /** 지금 단에서 넘치는 블록을 잘라 다음 단으로 이어 넣는다. 한 번도 못 잘랐으면 false */
    const fitLong = (b) => {
      let part = b;
      for (let guard = 0; guard < 12; guard++) {
        const col = cols[ci];
        if (bottomOf(col) <= limit + 1) return true;
        const levels = [];
        const rest = cutAt(part, col.getBoundingClientRect().top + limit - 16, levels);
        if (!rest) {
          if (part === b) return false;
          break;
        }
        splits.push({ levels, part: rest });
        rest.a4Root = b; // 어느 문제에서 이어진 조각인지 (음성 질문이 글을 모을 때 쓴다)
        grew.observe(rest);
        next().append(rest);
        part = rest;
      }
      if (bottomOf(cols[ci]) > limit + 1) markTall();
      return true;
    };
    for (const b of blocks) {
      let col = cols[ci];
      col.append(b);
      if (bottomOf(col) <= limit + 1) continue;
      if (col.children.length === 1) {
        if (!fitLong(b)) markTall(); // 단의 첫 문제가 한 단보다 길다
        continue;
      }
      // 어느 단에도 통째로는 안 들어가는 긴 블록 — 이 단에 자리가 넉넉하면 여기서부터 잘라 채운다 (단을 비워 두지 않는다)
      if (b.offsetHeight > limit && limit - b.offsetTop >= limit * 0.35 && fitLong(b)) continue;
      // 안 들어간다 → 다음 단으로. 바로 앞의 지문 제목도 함께 데려간다
      const carry = [b];
      while (isLead(carry[0].previousElementSibling) && col.children.length > carry.length + 1) carry.unshift(carry[0].previousElementSibling);
      col = next();
      col.append(...carry);
      if (!fitLong(b)) markTall();
    }
    pages.forEach((p, i) => { p.lastChild.textContent = `${i + 1} / ${pages.length}`; });
    window.scrollTo({ top: y });
  };

  let queued = 0;
  const queue = () => {
    cancelAnimationFrame(queued);
    queued = requestAnimationFrame(layout);
  };
  queueLayout = queue;
  // 화면에 붙거나 폭이 바뀌면, 또 문제 높이가 바뀌면(그림이 늦게 뜸, 채점 뒤 해설이 펼쳐짐) 다시 나눈다
  let lastW = -1;
  new ResizeObserver(() => {
    const w = node.clientWidth;
    if (w && w !== lastW) { lastW = w; queue(); }
  }).observe(node);
  node.addEventListener('load', queue, true);
  document.fonts?.ready.then(() => node.isConnected && queue());
  return { node, layout };
}
