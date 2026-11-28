#!/usr/bin/env node
/*
 * 과목 책(문제책·해설책) A4 PDF 만들기
 *   node tools/make-books.mjs [과목 코드...]     (없으면 7과목)   예) node tools/make-books.mjs kor
 *   결과: ../인쇄용_책/<과목>_공부책.pdf  (BOOKS=all 이면 문제책·해설책도)
 *
 * 헤드리스 크롬을 CDP 로 조종한다: #/s/<과목>/book/<q|a> 를 열고 html[data-print-ready="1"] 이 붙을 때까지
 * 기다렸다가 Page.printToPDF (A4, 배경 포함, 쪽 번호는 CSS @page 바닥글).
 * (웹앱이 클라우드 연결을 열어 두므로 --print-to-pdf 는 끝나지 않는다)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '..', '인쇄용_책');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP = 8766;
const CDP = 9333;
const NAME = { kor: '국어', mat: '수학', sci: '과학', soc: '사회', mor: '도덕', eng: '영어', vie: '베트남어' };
const codes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(NAME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', String(HTTP)], { cwd: ROOT, stdio: 'ignore' });
const profile = mkdtempSync(join(tmpdir(), 'books-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { chrome.kill(); server.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('크롬에 연결하지 못했습니다');
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    const { ok, no } = waiting.get(m.id);
    waiting.delete(m.id);
    m.error ? no(new Error(m.error.message)) : ok(m.result);
  }
});
const send = (method, params = {}) => new Promise((ok, no) => {
  const id = ++seq;
  waiting.set(id, { ok, no });
  ws.send(JSON.stringify({ id, method, params }));
  if (method === 'Page.printToPDF') setTimeout(() => { if (waiting.delete(id)) no(new Error('시간 초과')); }, 60000);
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;


/* 책을 조각으로 나누는 도우미 — 화면에 원본을 보관해 두고 __bkSeg(i) 로 i 번째 조각만 남긴다 */
const SEG_SETUP = `(() => {
  const book = document.querySelector('.bk-book');
  const orig = window.__bkOrig || (window.__bkOrig = book.cloneNode(true));
  const segs = [];
  [...orig.children].forEach((node, k) => {
    const chapters = node.classList.contains('bk-part-wrap') ? [...node.children].filter((c) => c.classList.contains('bk-chapter')) : [];
    if (!chapters.length) segs.push({ k, j: null });
    else chapters.forEach((c, j) => segs.push({ k, j }));
  });
  window.__bkSeg = (i) => {
    const { k, j } = segs[i];
    const src = orig.children[k];
    const now = orig.cloneNode(false);
    if (j == null) now.append(src.cloneNode(true));
    else {
      const wrap = src.cloneNode(false);
      if (j === 0) [...src.children].filter((c) => !c.classList.contains('bk-chapter')).forEach((c) => wrap.append(c.cloneNode(true)));
      wrap.append([...src.children].filter((c) => c.classList.contains('bk-chapter'))[j].cloneNode(true));
      now.append(wrap);
    }
    document.querySelector('.bk-book').replaceWith(now);
    return Promise.all([...now.querySelectorAll('img')].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })))).then(() => i);
  };
  // 쪽 번호는 합친 뒤에 찍는다 (조각마다 1쪽부터 세지 않게)
  const st = document.createElement('style');
  st.textContent = '@media print { .bk-book { page: bkseg !important; } } @page bkseg { size: A4; margin: 13mm 13mm 15mm; }';
  document.head.append(st);
  return segs.length;
})()`;

/* 조각 PDF 합치기 + 쪽 번호(표지 빼고) — PyMuPDF */
const MERGE_PY = `
import sys, fitz
out, files = sys.argv[1], sys.argv[2:]
doc = fitz.open()
for f in files:
    doc.insert_pdf(fitz.open(f))
for i, page in enumerate(doc):
    if i == 0: continue
    r = page.rect
    page.insert_textbox(fitz.Rect(0, r.height - 34, r.width, r.height - 16), str(i + 1), fontsize=9, color=(0.4, 0.4, 0.4), align=1)
doc.save(out, garbage=3, deflate=True)
import os
print(len(doc), os.path.getsize(out))
`;

async function printPdf() {
  const { stream } = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, transferMode: 'ReturnAsStream' });
  const chunks = [];
  for (;;) {
    const r = await send('IO.read', { handle: stream, size: 1 << 20 });
    chunks.push(Buffer.from(r.data, r.base64Encoded ? 'base64' : 'utf8'));
    if (r.eof) break;
  }
  await send('IO.close', { handle: stream });
  return Buffer.concat(chunks);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setEmulatedMedia', { media: 'print' });

for (const code of codes) {
  const kinds = process.env.BOOKS === 'all' ? [['r', '공부책'], ['q', '문제책'], ['a', '해설책']] : [['r', '공부책']];
  for (const [w, kind] of kinds) {
    const started = Date.now();
    await send('Page.navigate', { url: `http://localhost:${HTTP}/?book=${Date.now()}#/s/${code}/book/${w}` });
    let ready = false;
    while (Date.now() - started < 180000) {
      await sleep(1000);
      if (await evaluate(`document.documentElement.dataset.printReady === '1' && location.hash === '#/s/${code}/book/${w}'`).catch(() => false)) { ready = true; break; }
    }
    if (!ready) { console.log(`${NAME[code]} ${kind}: 준비가 끝나지 않아 건너뜀`); continue; }
    await sleep(1500);
    // 한 번에 뽑으면 크롬이 멈추는 책이 있다(도덕) → 표지 · 단원 하나하나 · 서브노트로 나눠 뽑아 합친다
    const segCount = await evaluate(SEG_SETUP);
    const parts = [];
    for (let i = 0; i < segCount; i++) {
      let pdf = null;
      for (let attempt = 0; attempt < 3 && !pdf; attempt++) {
        await evaluate(`window.__bkSeg(${i})`);
        pdf = await printPdf().catch(() => null);
      }
      if (!pdf) throw new Error(`${NAME[code]} ${kind}: ${i + 1}번째 조각을 뽑지 못했습니다`);
      parts.push(pdf);
    }
    const file = join(OUT, `${NAME[code]}_${kind}.pdf`);
    const tmp = mkdtempSync(join(tmpdir(), 'bkseg-'));
    const names = parts.map((b, i) => { const f = join(tmp, `${String(i).padStart(3, '0')}.pdf`); writeFileSync(f, b); return f; });
    const merged = spawnSync('python3', ['-c', MERGE_PY, file, ...names], { encoding: 'utf8' });
    rmSync(tmp, { recursive: true, force: true });
    if (merged.status !== 0) throw new Error(merged.stderr);
    const [pages, bytes] = merged.stdout.trim().split(' ').map(Number);
    const buf = { length: bytes };
    console.log(`${NAME[code]} ${kind}: ${pages}쪽 · ${(buf.length / 1048576).toFixed(1)}MB · ${Math.round((Date.now() - started) / 1000)}초`);
  }
}
ws.close();
process.exit(0);
