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
