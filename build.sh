#!/bin/sh
# hanabi.html(본문)을 감싸서 브라우저에서 바로 열 수 있는 index.html을 만든다.
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>[hidden]{display:none!important}body{margin:0}</style>\n</head>\n<body>\n'
  cat hanabi.html
  printf '\n</body>\n</html>\n'
} > index.html
