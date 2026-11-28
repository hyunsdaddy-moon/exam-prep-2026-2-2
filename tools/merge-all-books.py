#!/usr/bin/env python3
"""전 과목 공부책 한 권 만들기 (양면 인쇄용)
  python3 tools/merge-all-books.py   →  ../인쇄용_책/전과목_공부책.pdf
  - 순서: 과학 · 국어 · 도덕 · 사회 · 수학 · 영어 · 베트남어
  - 과목 첫 쪽(표지)이 늘 홀수 쪽(앞면)이 되도록, 쪽수가 홀수인 과목 뒤에 빈 쪽을 하나 넣는다 (맨 끝도 짝수로 맞춤)
  - 과목마다 책갈피(목차)를 단다. 쪽 번호는 과목 책 안의 번호 그대로.
"""
import os, sys, fitz
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..', '인쇄용_책'))
ORDER = ['과학', '국어', '도덕', '사회', '수학', '영어', '베트남어']
out = fitz.open()
toc = []
for name in ORDER:
    path = os.path.join(SRC, f'{name}_공부책.pdf')
    if not os.path.exists(path):
        sys.exit(f'없음: {path}')
    book = fitz.open(path)
    start = len(out)
    assert start % 2 == 0, '과목 첫 쪽이 홀수 쪽이 아님'
    out.insert_pdf(book)
    toc.append([1, name, start + 1])
    blank = len(book) % 2 == 1
    if blank:
        r = out[-1].rect
        out.new_page(width=r.width, height=r.height)
    print(f'{name}: {start + 1}쪽부터 {len(book)}쪽{" + 빈 쪽" if blank else ""}')
out.set_toc(toc)
dest = os.path.join(SRC, '전과목_공부책.pdf')
out.save(dest, garbage=3, deflate=True)
print(f'합계 {len(out)}쪽 · {os.path.getsize(dest) / 1048576:.1f}MB → {dest}')
