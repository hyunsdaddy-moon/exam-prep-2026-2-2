/*
 * 시험 준비 웹앱 — 마크다운을 화면에 그린다.
 *
 * 수식($…$, $$…$$)은 마크다운으로 바꾸기 전에 잠시 빼 두었다가 KaTeX 로 그려 되돌린다.
 * 그래야 수식 안의 `_`, `|`, `*` 가 기울임·표로 잘못 읽히지 않는다.
 * 문서는 사용자가 만든 자기 자료라 문서 안의 HTML(<br>, <u>)은 그대로 둔다.
 */

/* global markdownit, katex */

const md = markdownit({ html: true, linkify: false, breaks: false });
// 문제 지문용 — 가져올 때 줄 끝 빈칸(줄바꿈 표시)이 지워지므로 줄바꿈을 그대로 살린다
const mdBreaks = markdownit({ html: true, linkify: false, breaks: true });

const FENCE = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/g;
const INLINE_CODE = /`[^`\n]*`/g;
// $$…$$ 는 여러 줄, $…$ 는 한 줄. 앞뒤가 숫자·공백인 달러(돈 표시)는 수식으로 보지 않는다.
const MATH = /\$\$([\s\S]+?)\$\$|(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g;

// 굵은 글씨는 직접 바꾼다. 마크다운 규칙으로는 `**(가)**이다`·`**"말"**을` 처럼 닫는 별표 앞이 문장 부호이고
// 뒤가 한글이면 굵게 되지 않고 별표가 그대로 보인다 — 한국어 문서에서 아주 흔한 꼴이다.
const BOLD = /\*\*(?=[^\s*])([^*\n]*?[^\s*])\*\*/g;

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** 제목끼리 견줄 때 쓰는 열쇠 — 꾸밈 기호와 빈칸을 뺀 글자만 */
export const headingKey = (text) => text.normalize('NFC').replace(/[\s$*`_\\]/g, '');

/** 수식을 빼 두고 자리표를 남긴다. 코드 안의 달러는 건드리지 않는다. */
export function protectMath(source) {
  const math = [];
  const text = source
    .split(FENCE)
    .map((part, i) => {
      if (i % 2) return part; // 코드 블록은 그대로
      // 한 줄 코드(`…`)는 잠시 빼 둔다 — 그 안의 달러·별표는 건드리지 않되, **`코드`** 처럼 바깥을 감싼 굵게는 살린다
      const codes = [];
      return part
        .replace(INLINE_CODE, (m) => {
          codes.push(m);
          return `\uE002${codes.length - 1}\uE003`;
        })
        .replace(MATH, (_, block, inline) => {
          math.push({ tex: (block ?? inline).trim(), display: block != null });
          return `\uE000${math.length - 1}\uE001`; // 사용자 영역 글자 — 마크다운이 건드리지 않는다
        })
        .replace(BOLD, '<strong>$1</strong>')
        .replace(/\uE002(\d+)\uE003/g, (_, n) => codes[Number(n)]);
    })
    .join('');
  return { text, math };
}

/** KaTeX 에 없는 명령. \overparen{AB} = 호 AB */
const MACROS = { '\\overparen': '\\overset{\\frown}{#1}' };

let mermaidLoading = null;
/** 도표 라이브러리는 크므로(3.5MB) 도표가 있는 문서를 열 때만 불러온다 */
function loadMermaid() {
  mermaidLoading ??= new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = 'vendor/mermaid.min.js';
    tag.onload = () => {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit' });
      resolve(window.mermaid);
    };
    tag.onerror = () => reject(new Error('mermaid'));
    document.head.append(tag);
  });
  return mermaidLoading;
}

let diagramSeq = 0;
/** ```mermaid 코드 → 그림. 그리지 못하면 코드를 그대로 둔다. */
async function drawDiagrams(container) {
  const blocks = [...container.querySelectorAll('pre > code.language-mermaid')];
  if (!blocks.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch {
    return;
  }
  for (const code of blocks) {
    try {
      const { svg } = await mermaid.render(`diagram-${++diagramSeq}`, code.textContent);
      const box = document.createElement('div');
      box.className = 'diagram';
      box.innerHTML = svg;
      code.parentElement.replaceWith(box);
    } catch {
      document.getElementById(`ddiagram-${diagramSeq}`)?.remove(); // 실패하면 라이브러리가 남기는 오류 그림
    }
  }
}

function renderMath({ tex, display }) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: false, macros: MACROS });
  } catch {
    return `<span class="math-error" title="수식을 그리지 못했습니다">${escapeHtml(tex)}</span>`;
  }
}

/**
 * 마크다운 → container 안에 그린다.
 * @returns {{ headings: {id, level, node, key}[], ready: Promise<void> }}
 */
export function renderMarkdown(source, container, { imageBase = '', onImage, breaks = false } = {}) {
  const { text, math } = protectMath(source.normalize('NFC'));
  const html = (breaks ? mdBreaks : md).render(text).replace(/\uE000(\d+)\uE001/g, (_, i) => renderMath(math[Number(i)]));
  // 틀(template) 안에서 먼저 손본다 — 바로 화면에 넣으면 고치기 전의 그림 주소를 브라우저가 한 번 요청해 버린다
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;

  // 제목에 닻을 단다
  const headings = [];
  root.querySelectorAll('h1, h2, h3, h4').forEach((h, i) => {
    h.id = `h-${i}`;
    // 수식이 든 제목은 textContent 로 읽으면 글자가 겹친다(π\piπ). 견줄 때는 수식을 원래 TeX 로 되돌려 읽는다.
    const plain = h.cloneNode(true);
    plain.querySelectorAll('.katex').forEach((k) => k.replaceWith(k.querySelector('annotation')?.textContent || ''));
    headings.push({ id: h.id, level: Number(h.tagName[1]), node: h, key: headingKey(plain.textContent) });
  });

  // 그림: 문서 폴더 기준 경로로 바꾸고, 누르면 크게
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    const abs = /^(https?:|data:|\/)/.test(src) ? src : imageBase + src.split('/').map((p) => encodeURIComponent(decodeURIComponent(p).normalize('NFC'))).join('/');
    const alt = img.getAttribute('alt') || '';
    const figure = document.createElement('figure');
    const fresh = document.createElement('img');
    fresh.loading = 'lazy';
    fresh.decoding = 'async';
    fresh.alt = alt;
    fresh.src = abs;
    fresh.tabIndex = 0;
    fresh.setAttribute('role', 'button');
    const open = () => onImage?.(abs, alt);
    fresh.addEventListener('click', open);
    fresh.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    fresh.addEventListener('error', () => {
      const missing = document.createElement('div');
      missing.className = 'img-missing';
      missing.textContent = `그림을 불러오지 못했습니다 — ${alt || src}`;
      fresh.replaceWith(missing);
    });
    figure.append(fresh);
    if (alt) {
      const cap = document.createElement('figcaption');
      cap.textContent = alt;
      figure.append(cap);
    }
    // 문단에 그림만 들어 있으면 문단째 바꾼다
    const p = img.parentElement;
    if (p && p.tagName === 'P' && p.childNodes.length === 1) p.replaceWith(figure);
    else img.replaceWith(figure);
  });

  // 넓은 표는 옆으로 밀어 본다
  root.querySelectorAll('table').forEach((table) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.replaceWith(wrap);
    wrap.append(table);
  });

  // 옵시디안 알림 상자: > [!tip] 제목
  root.querySelectorAll('blockquote').forEach((bq) => {
    const first = bq.querySelector('p');
    const m = first && first.innerHTML.match(/^\s*\[!(\w+)\]\s*([^\n<]*)(?:<br\s*\/?>|\n)?/i);
    if (!m) return;
    bq.classList.add('callout', m[1].toLowerCase());
    first.innerHTML = first.innerHTML.slice(m[0].length);
    const title = document.createElement('p');
    title.className = 'callout-title';
    title.textContent = m[2].trim() || { tip: '도움말', info: '알아 두기', warning: '주의', caution: '주의', important: '중요', note: '참고' }[m[1].toLowerCase()] || m[1];
    bq.prepend(title);
    if (!first.textContent.trim() && !first.children.length) first.remove();
  });

  // 체크 목록: - [ ] …
  root.querySelectorAll('li').forEach((li) => {
    const node = li.firstChild?.nodeType === 1 && li.firstChild.tagName === 'P' ? li.firstChild : li;
    const t = node.firstChild;
    if (!t || t.nodeType !== 3) return;
    const m = t.nodeValue.match(/^\[( |x|X)\]\s+/);
    if (!m) return;
    t.nodeValue = t.nodeValue.slice(m[0].length);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = m[1] !== ' ';
    node.prepend(box);
    li.classList.add('task');
  });

  // 바깥 링크는 새 창으로
  root.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener';
  });

  container.replaceChildren(root);
  // 도표는 뒤늦게 그려진다. 인쇄처럼 다 그려진 뒤에 움직여야 하는 곳은 ready 를 기다린다.
  const ready = drawDiagrams(container).catch(() => undefined);

  return { headings, ready };
}
