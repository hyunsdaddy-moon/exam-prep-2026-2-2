#!/bin/zsh
# 종이 공부책 한 번에 새로 내기 — 자료(exam/*.md 등)를 고친 뒤 이것 하나만 실행
#   tools/publish-books.sh
#   1) 최신 받기(git pull)  2) 7과목 공부책 PDF 다시 뽑기  3) 전 과목 합본(양면용)
#   4) GitHub Release books-v1 에 덮어쓰기(내려받기 단추)
#   5) 합본 내용이 바뀌었을 때만 사이트 안 books/all.pdf 를 바꿔 배포(웹에서 보기·인쇄) — 그대로면 커밋하지 않음(저장소가 46MB씩 커지지 않게)
set -e
cd "${0:A:h}/.."
SRC="${0:A:h}/../../인쇄용_책"
git pull -q --rebase
node tools/make-books.mjs
cp books/all.pdf /tmp/_books_all_old.pdf 2>/dev/null || true
tools/upload-books.sh            # 합본 만들기 + Release 올리기 + books/all.pdf 복사
if python3 tools/pdf-same.py "$SRC/전과목_공부책.pdf" /tmp/_books_all_old.pdf; then
  git checkout -q -- books/all.pdf 2>/dev/null || true
  echo "웹에서 보기(books/all.pdf): 내용이 같아 그대로 둠"
else
  python3 tools/validate-data.py | tail -1
  node bump-version.mjs
  git add books/all.pdf index.html version.json $(git diff --name-only -- '*.js' '*.mjs')
  git commit -q -m "종이 공부책 다시 냄: 전 과목 합본(books/all.pdf) 갱신

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  git push -q origin main
  echo "웹에서 보기(books/all.pdf): 새 내용으로 배포함 — 몇 분 뒤 반영"
fi
rm -f /tmp/_books_all_old.pdf
