#!/usr/bin/env python3
"""두 PDF 의 「내용」이 같은지 (만든 시각 같은 메타데이터는 무시) — 같으면 종료 코드 0
  python3 tools/pdf-same.py 새것.pdf 옛것.pdf"""
import sys, hashlib, os, fitz
a, b = sys.argv[1], sys.argv[2]
if not os.path.exists(b):
    sys.exit(1)
def digest(path):
    h = hashlib.sha256()
    doc = fitz.open(path)
    h.update(str(len(doc)).encode())
    for page in doc:
        h.update(page.get_text().encode())
        for img in page.get_images(full=True):
            h.update(doc.extract_image(img[0])['image'][:4096])
    return h.hexdigest()
sys.exit(0 if digest(a) == digest(b) else 1)
