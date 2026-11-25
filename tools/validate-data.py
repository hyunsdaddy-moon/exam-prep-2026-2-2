#!/usr/bin/env python3
"""시험 준비 사이트 데이터 검사 — 배포 전에 돌린다.

    cd .gh-pages && python3 tools/validate-data.py

검사하는 것
  1. data/ 아래 모든 JSON 이 열리는지
  2. exam.json 의 문서(docs[].file)가 exam/ 에 실제로 있는지, 과목마다 questions/assess/docquiz 파일이 있는지(빈 과목은 빈 파일)
  3. concepts.json 의 heading 이 그 문서의 제목과 맞는지 (공백·기호 무시)
  4. 문항 id 가 파일 사이에서도 겹치지 않는지 (questions·assess·units·docquiz·drill)
  5. 객관식 answer 가 보기 범위 안인지
  6. docquiz·drill·units 가 가리키는 문서가 있는지
  7. drill 세트의 자리(anchor 또는 part)가 문서의 큰 제목(#·##)에서 찾아지는지, [[ ]] 짝, ox 답, LaTeX($) 금지
  8. 문서 속 그림(.png)마다 같은 이름의 .webp 가 있는지 (없으면 경고만)
끝에 OK 또는 FAIL 을 찍는다. FAIL 이면 배포하지 않는다.
"""
import json
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA, EXAM = ROOT / 'data', ROOT / 'exam'
errors, warns = [], []


def nfc(t):
    return unicodedata.normalize('NFC', str(t))


def key(t):  # markdown.js headingKey 와 같은 규칙
    return re.sub(r'[\s$*`_\\]', '', nfc(t))


def norm(t):  # drill.js norm 과 같은 규칙
    t = re.sub(r'^[^0-9A-Za-z가-힣]+', '', nfc(t))
    return re.sub(r'\s+', ' ', t).lower()


def load(p):
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception as e:  # noqa: BLE001
        errors.append(f'JSON 오류 {p.relative_to(ROOT)}: {e}')
        return None


def doc_text(rel):
    p = EXAM / nfc(rel)
    if not p.exists():
        # 파일 이름이 NFD 로 저장된 경우까지 찾는다
        for q in EXAM.rglob('*.md'):
            if nfc(q.relative_to(EXAM)) == nfc(rel):
                return q.read_text(encoding='utf-8')
        return None
    return p.read_text(encoding='utf-8')


def headings(md):
    return [(len(m.group(1)), m.group(2).strip()) for m in re.finditer(r'^(#{1,6})\s+(.+)$', md, re.M)]


# 1. 모든 JSON
for p in sorted(DATA.rglob('*.json')):
    load(p)

exam = load(DATA / 'exam.json') or {'subjects': []}
codes = [s['code'] for s in exam.get('subjects', [])]

# 2. 문서·과목 파일
for s in exam['subjects']:
    for d in s.get('docs', []):
        if doc_text(d['file']) is None:
            errors.append(f"exam.json 문서 없음: {d['file']}")
    for sub in ('questions', 'assess', 'docquiz'):
        if not (DATA / sub / f"{s['code']}.json").exists():
            errors.append(f"data/{sub}/{s['code']}.json 없음 (빈 과목이면 빈 파일이라도 둔다)")

# 3. 개념 heading
concepts = (load(DATA / 'concepts.json') or {}).get('concepts', [])
for c in concepts:
    md = doc_text(c['doc'])
    if md is None:
        errors.append(f"개념 {c['id']} 문서 없음: {c['doc']}")
        continue
    keys = [key(h) for _, h in headings(md)]
    k = key(c['heading'])
    if k not in keys and not any(k in x for x in keys):
        errors.append(f"개념 {c['id']} 제목을 문서에서 못 찾음: {c['heading']}")

# 4·5·6. 문항
ids = {}


def check_q(q, where):
    qid = q.get('id')
    if not qid:
        errors.append(f'id 없는 문항 ({where})')
        return
    if qid in ids:
        errors.append(f'id 중복 {qid}: {ids[qid]} / {where}')
    ids[qid] = where
    if q.get('type') == 'choice':
        ans = q.get('answer')
        n = len(q.get('choices') or [])
        for a in (ans if isinstance(ans, list) else [ans]):
            if not isinstance(a, int) or not 1 <= a <= n:
                errors.append(f'{qid} 정답 번호 {a} 가 보기 {n}개 범위 밖 ({where})')


for code in codes:
    qs = load(DATA / 'questions' / f'{code}.json') if (DATA / 'questions' / f'{code}.json').exists() else None
    for q in (qs or {}).get('questions', []):
        check_q(q, f'questions/{code}')
    asx = load(DATA / 'assess' / f'{code}.json') if (DATA / 'assess' / f'{code}.json').exists() else None
    for rid, r in ((asx or {}).get('rounds') or {}).items():
        for q in r.get('questions', []):
            check_q(q, f'assess/{code}/{rid}')
    un = DATA / 'units' / f'{code}.json'
    for u in ((load(un) or {}).get('units', []) if un.exists() else []):
        if u.get('doc') and doc_text(u['doc']) is None:
            errors.append(f"units/{code} {u['id']} 문서 없음: {u['doc']}")
        for q in u.get('questions', []):
            check_q(q, f"units/{code}/{u['id']}")
    dq = DATA / 'docquiz' / f'{code}.json'
    for f, d in ((load(dq) or {}).get('docs', {}) if dq.exists() else {}).items():
        if doc_text(f) is None:
            errors.append(f'docquiz/{code} 문서 없음: {f}')
        for q in d.get('questions', []):
            check_q(q, f'docquiz/{code}')

# 7. drill
for p in sorted((DATA / 'drill').glob('*.json')) if (DATA / 'drill').exists() else []:
    d = load(p) or {}
    for f, sets in d.get('docs', {}).items():
        md = doc_text(f)
        if md is None:
            errors.append(f'drill/{p.name} 문서 없음: {f}')
            continue
        big = [h for lv, h in headings(md) if lv <= 2]
        for s in sets:
            if 'anchor' in s:
                hit = [h for h in big if norm(h).startswith(norm(s['anchor']))]
            else:
                hit = [h for h in big if (m := re.search(r'PART\s*(\d+)', h, re.I)) and int(m.group(1)) == s.get('part')]
            if not hit:
                errors.append(f"drill/{p.name} 자리 못 찾음: {f} → {s.get('anchor', s.get('part'))}")
            for it in s.get('items', []):
                check_q({'id': it.get('id')}, f'drill/{p.name}')
                q = it.get('q', '')
                if it.get('k') == 'blank' and ('[[' not in q or q.count('[[') != q.count(']]')):
                    errors.append(f"drill {it.get('id')} [[ ]] 짝 오류")
                if it.get('k') == 'ox' and it.get('a') not in ('O', 'X'):
                    errors.append(f"drill {it.get('id')} ox 답은 O 또는 X")
                if it.get('k') == 'qa' and not it.get('a'):
                    errors.append(f"drill {it.get('id')} qa 답 없음")
                if '$' in json.dumps(it, ensure_ascii=False):
                    errors.append(f"drill {it.get('id')} 에 LaTeX($) — 평문으로")

# 8. 그림 WebP
for md in EXAM.rglob('*.md'):
    for m in re.finditer(r'!\[[^\]]*\]\(([^)\s]+\.png)\)', md.read_text(encoding='utf-8')):
        png = (md.parent / m.group(1))
        if not png.with_suffix('.webp').exists():
            warns.append(f'WebP 없음(느려짐): {png.relative_to(ROOT)}')

print(f'문항 id {len(ids)}개 · 개념 {len(concepts)}개 · 과목 {len(codes)}개')
for w in warns[:20]:
    print('  경고:', w)
if len(warns) > 20:
    print(f'  경고 {len(warns) - 20}개 더')
for e in errors:
    print('  !!', e)
print('OK' if not errors else f'FAIL ({len(errors)}개)')
sys.exit(1 if errors else 0)
