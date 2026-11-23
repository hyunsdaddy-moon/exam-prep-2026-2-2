#!/usr/bin/env node
/*
 * 배포 전에 한 번 돌린다: node bump-version.mjs
 * index.html 의 ?v= 와 모든 JS 파일 안의 import './x.js?v=…' 를 같은 새 버전으로 바꾼다.
 * 그래야 다른 기기의 브라우저가 예전 JS 를 캐시에서 꺼내 쓰지 않는다.
 * (모든 import 가 똑같은 주소여야 store.js 같은 모듈이 두 번 실려 엉키지 않는다.)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const ver = process.argv[2] || `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
const files = readdirSync('.').filter((f) => /\.(js|mjs)$/.test(f) && f !== 'bump-version.mjs');
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  const t = s.replace(/(from\s+'\.\/[\w-]+\.m?js)(\?v=[\w-]*)?'/g, `$1?v=${ver}'`);
  if (t !== s) writeFileSync(f, t);
}
const h = readFileSync('index.html', 'utf8').replace(/\?v=[\w-]+/g, `?v=${ver}`);
writeFileSync('index.html', h);
writeFileSync('version.json', JSON.stringify({ v: ver }) + '\n');
console.log('버전', ver, '· JS', files.length, '개 + index.html');
