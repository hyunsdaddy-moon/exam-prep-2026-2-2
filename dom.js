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
 */
export function a4Pages(head, blocks, pageClass = 'sheet') {
  const node = el('div.a4-pages');
  const narrow = window.matchMedia('(max-width: 640px)');
  const isLead = (b) => b && (b.classList.contains('p-group') || b.classList.contains('p-context'));
  const bottomOf = (c) => {
    const last = c.lastElementChild;
    return last ? last.offsetTop + last.offsetHeight : 0;
  };

  const layout = () => {
    const y = window.scrollY;
    node.replaceChildren();
    if (narrow.matches) {
      node.append(el(`div.${pageClass}.a4-flat`, {}, head, el('div.cols', {}, blocks)));
      return;
    }
    const pages = [];
    let cols = [];
    let ci = 0;
    const newPage = () => {
      cols = [el('div.a4-col'), el('div.a4-col')];
      ci = 0;
      const page = el(`div.${pageClass}.a4`, {}, pages.length ? null : head, el('div.a4-cols', {}, cols), el('div.a4-no'));
      pages.push(page);
      node.append(page);
    };
    const next = () => {
      if (ci === 0) ci = 1;
      else newPage();
      return cols[ci];
    };
    newPage();
    for (const b of blocks) {
      let col = cols[ci];
      col.append(b);
      if (bottomOf(col) <= col.clientHeight + 1 || col.children.length === 1) continue;
      // 안 들어간다 → 다음 단으로. 바로 앞의 지문 제목도 함께 데려간다
      const carry = [b];
      while (isLead(carry[0].previousElementSibling) && col.children.length > carry.length + 1) carry.unshift(carry[0].previousElementSibling);
      col = next();
      col.append(...carry);
      if (bottomOf(col) > col.clientHeight + 1) pages[pages.length - 1].classList.add('a4-tall'); // 한 단보다 긴 문제는 쪽을 늘린다
    }
    pages.forEach((p, i) => { p.lastChild.textContent = `${i + 1} / ${pages.length}`; });
    window.scrollTo({ top: y });
  };

  let queued = 0;
  const queue = () => {
    cancelAnimationFrame(queued);
    queued = requestAnimationFrame(layout);
  };
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (!node.isConnected) return;
    if (window.innerWidth !== lastW) { lastW = window.innerWidth; queue(); }
  });
  node.addEventListener('load', queue, true); // 그림이 늦게 뜨면 높이가 바뀐다
  document.fonts?.ready.then(() => node.isConnected && queue());
  return { node, layout };
}
