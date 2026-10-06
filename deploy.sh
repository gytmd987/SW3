#!/bin/sh
# 사이트 파일을 gh-pages 브랜치로 올린다 (GitHub Pages가 그 브랜치를 서비스함).
set -e
cd "$(dirname "$0")"
./build.sh
TMP=$(mktemp -d)
git fetch -q origin gh-pages
git worktree add -q "$TMP" origin/gh-pages --detach
find "$TMP" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
for f in index.html .nojekyll shared vendor hanabi lostcities 6nimmt quoridor ubongo splendor-duel; do
  [ -e "$f" ] && cp -R "$f" "$TMP/"
done
touch "$TMP/.nojekyll"
cd "$TMP"
git add -A
if git diff --cached --quiet; then echo "변경 없음"; else
  git commit -q -m "Deploy site from $(git -C "$OLDPWD" rev-parse --short HEAD)"
  git push -q origin HEAD:gh-pages
  echo "배포 완료"
fi
cd - >/dev/null
git worktree remove --force "$TMP"
