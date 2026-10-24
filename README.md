# 둘이서 게임방

둘이 하기 좋은 보드게임을 웹에서 할 수 있게 모아 둔 사이트. https://gytmd987.github.io/SW3/

| 게임 | 폴더 |
|---|---|
| 하나비 | `hanabi/` |
| 로스트 시티 | `lostcities/` |
| 젝스님트 | `6nimmt/` |
| 쿼리도 | `quoridor/` |
| 우봉고 | `ubongo/` |
| 바퀴벌레 포커 | `cockroach/` |
| 튜링 머신 | `turing/` (조건 카드·퍼즐 생성은 `engine.js`) |
| 화이트홀 미스터리 | `whitehall/` (규칙 엔진과 지도는 `engine.js`) |
| 스플렌더 대결 | `splendor-duel/` (규칙 엔진은 `engine.js`) |

- `shared/duo.js`, `shared/duo.css` — 게임들이 같이 쓰는 뼈대: 자동 연결(PeerJS), 메시지 재전송·재동기화, 로비, 규칙 창
- `vendor/peerjs.min.js` — PeerJS 1.5.5

## 플레이 방식
- 게임마다 판이 하나다. 둘이 같은 게임 페이지를 열면 자동으로 연결된다(PeerJS/WebRTC). 먼저 연 쪽이 판을 잡고(방장), 방장이 나가면 남은 쪽이 이어받는다. 새로고침해도 이어서 할 수 있다.

## 배포
`./deploy.sh` — 사이트 파일을 `gh-pages` 브랜치로 올린다.

스플렌더 대결의 카드 구성(비용·점수·능력)은 원작 구조를 따라 새로 짠 것으로, 실제 카드 목록과 다르다.
