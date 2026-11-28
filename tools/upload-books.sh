#!/bin/zsh
# 종이 공부책 PDF(../인쇄용_책/<과목>_공부책.pdf)를 GitHub Release books-v1 에 올린다 (같은 이름은 덮어씀).
#   쓰는 법: tools/upload-books.sh      ← node tools/make-books.mjs 로 다시 뽑은 뒤
#   첫 화면 「종이 공부책」 단추가 releases/download/books-v1/book-<코드>.pdf 를 내려받는다.
set -e
cd "${0:A:h}/.."
SRC="${0:A:h}/../../인쇄용_책"
TAG=books-v1
typeset -A NAME; NAME=(kor 국어 mat 수학 sci 과학 soc 사회 mor 도덕 eng 영어 vie 베트남어)
TMP=$(mktemp -d); trap "rm -rf $TMP" EXIT
files=()
for c in kor mat sci soc mor eng vie; do
  f="$SRC/${NAME[$c]}_공부책.pdf"
  [[ -f $f ]] || { echo "없음: $f"; continue; }
  cp "$f" "$TMP/book-$c.pdf"; files+="$TMP/book-$c.pdf"
done
gh release view $TAG >/dev/null 2>&1 || gh release create $TAG --title "종이 공부책 (A4 PDF)" --notes "과목별 공부책: 단원 정리 + 서브노트. 웹앱 첫 화면에서 내려받기." --latest=false
gh release upload $TAG $files --clobber
gh release view $TAG --json assets -q '.assets[] | "\(.name) \(.size)"'
