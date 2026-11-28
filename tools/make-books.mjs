#!/usr/bin/env node
/*
 * 과목 책(문제책·해설책) A4 PDF 만들기
 *   node tools/make-books.mjs [과목 코드...]     (없으면 7과목)   예) node tools/make-books.mjs kor
 *   결과: ../인쇄용_책/<과목>_문제책.pdf · <과목>_해설책.pdf
 *
 * 헤드리스 크롬을 CDP 로 조종한다: #/s/<과목>/book/<q|a> 를 열고 html[data-print-ready="1"] 이 붙을 때까지
 * 기다렸다가 Page.printToPDF (A4, 배경 포함, 쪽 번호는 CSS @page 바닥글).
 * (웹앱이 클라우드 연결을 열어 두므로 --print-to-pdf 는 끝나지 않는다)
 */
import { spawn } from 'node:child_process';
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
});
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setEmulatedMedia', { media: 'print' });

for (const code of codes) {
  for (const [w, kind] of [['q', '문제책'], ['a', '해설책']]) {
    const started = Date.now();
    await send('Page.navigate', { url: `http://localhost:${HTTP}/?book=${Date.now()}#/s/${code}/book/${w}` });
    let ready = false;
    while (Date.now() - started < 180000) {
      await sleep(1000);
      if (await evaluate(`document.documentElement.dataset.printReady === '1' && location.hash === '#/s/${code}/book/${w}'`).catch(() => false)) { ready = true; break; }
    }
    if (!ready) { console.log(`${NAME[code]} ${kind}: 준비가 끝나지 않아 건너뜀`); continue; }
    await sleep(1500);
    const { stream } = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false, transferMode: 'ReturnAsStream' });
    const chunks = [];
    for (;;) {
      const r = await send('IO.read', { handle: stream, size: 1 << 20 });
      chunks.push(Buffer.from(r.data, r.base64Encoded ? 'base64' : 'utf8'));
      if (r.eof) break;
    }
    await send('IO.close', { handle: stream });
    const buf = Buffer.concat(chunks);
    const file = join(OUT, `${NAME[code]}_${kind}.pdf`);
    writeFileSync(file, buf);
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log(`${NAME[code]} ${kind}: ${pages}쪽 · ${(buf.length / 1048576).toFixed(1)}MB · ${Math.round((Date.now() - started) / 1000)}초`);
  }
}
ws.close();
process.exit(0);
