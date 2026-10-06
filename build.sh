#!/bin/sh
# hanabi.html(본문, Claude 아티팩트 원본)을 감싸서 hanabi/index.html을 만든다.
cd "$(dirname "$0")"
mkdir -p hanabi
{
  printf '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>[hidden]{display:none!important}body{margin:0}</style>\n</head>\n<body>\n'
  cat hanabi.html
  printf '\n</body>\n</html>\n'
} > hanabi/index.html
