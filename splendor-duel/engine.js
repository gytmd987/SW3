/* Splendor Duel rules engine — pure functions, shared by the page and the tests.
 * Card list: modelled on the real game's structure (3 levels, bonuses, crowns, abilities,
 * jokers, 4 royals), with costs and points chosen here; it is not the printed card list. */
(function (root) {
"use strict";
const GEMS = ["W", "U", "G", "R", "K"];
const TOK = ["W", "U", "G", "R", "K", "P", "A"];          // A = gold
const NAME = { W: "하양", U: "파랑", G: "초록", R: "빨강", K: "검정", P: "진주", A: "금" };
const cyc = (c, k) => GEMS[(GEMS.indexOf(c) + k) % 5];
const SPIRAL = (() => {                                   // 가운데에서 바깥으로 도는 순서
  const out = [[2, 2]]; let r = 2, c = 2, step = 1;
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]]; let d = 0;
  while (out.length < 25) {
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < step; i++) { r += dirs[d][0]; c += dirs[d][1]; if (r >= 0 && r < 5 && c >= 0 && c < 5) out.push([r, c]); }
      d = (d + 1) % 4;
    }
    step++;
  }
  return out.slice(0, 25).map(([a, b]) => a * 5 + b);
})();

function buildCards() {
  let id = 0;
  const L = { 1: [], 2: [], 3: [] };
  const mk = (lvl, color, cost, pts, crowns, ab) => L[lvl].push({ id: id++, lvl, color, cost, pts, crowns, ab });
  for (const c of GEMS) {
    const o = k => cyc(c, k);
    mk(1, c, { [o(1)]: 1, [o(2)]: 1, [o(3)]: 1 }, 0, 0, null);
    mk(1, c, { [o(2)]: 2, [o(4)]: 1 }, 0, 0, "token");
    mk(1, c, { [o(1)]: 2, P: 1 }, 1, 0, null);
    mk(1, c, { [o(3)]: 3 }, 0, 1, null);
    mk(1, c, { [o(1)]: 1, [o(2)]: 2, [o(4)]: 1 }, 0, 0, "again");
    mk(1, c, { [o(4)]: 2, [o(3)]: 2 }, 1, 0, "scroll");
    mk(2, c, { [o(1)]: 3, [o(2)]: 2, P: 1 }, 1, 0, "steal");
    mk(2, c, { [o(2)]: 4, [o(3)]: 2 }, 2, 0, null);
    mk(2, c, { [o(1)]: 2, [o(3)]: 2, [o(4)]: 2 }, 1, 2, null);
    mk(2, c, { [o(4)]: 5, P: 1 }, 2, 0, "token");
    mk(3, c, { [o(1)]: 6, [o(2)]: 2, P: 1 }, 4, 0, null);
    mk(3, c, { [o(2)]: 4, [o(3)]: 3, [o(4)]: 1, P: 1 }, 3, 2, null);
  }
  for (let i = 0; i < 4; i++) { const c = GEMS[i]; mk(2, "X", { [c]: 4, [cyc(c, 2)]: 2, P: 1 }, 1 + (i % 2), 1 + ((i + 1) % 2), "joker"); }
  for (let i = 0; i < 3; i++) { const c = GEMS[i + 1]; mk(3, "X", { [c]: 5, [cyc(c, 1)]: 3, [cyc(c, 3)]: 1, P: 1 }, 3, 3, "joker"); }
  return L;
}
const ROYALS = [
  { id: "r0", pts: 3, ab: null }, { id: "r1", pts: 2, ab: "steal" },
  { id: "r2", pts: 2, ab: "scroll" }, { id: "r3", pts: 2, ab: "again" },
];

function shuffleWith(rnd, a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const emptyTok = () => ({ W: 0, U: 0, G: 0, R: 0, K: 0, P: 0, A: 0 });

function fill(g, rnd) {
  shuffleWith(rnd, g.bag);
  for (const i of SPIRAL) if (!g.board[i] && g.bag.length) g.board[i] = g.bag.pop();
}
function setup(rnd, first) {
  const L = buildCards();
  const bag = []; GEMS.forEach(c => { for (let i = 0; i < 4; i++) bag.push(c); }); bag.push("P", "P", "A", "A", "A");
  const g = {
    board: Array(25).fill(null), bag,
    decks: { 1: shuffleWith(rnd, L[1]), 2: shuffleWith(rnd, L[2]), 3: shuffleWith(rnd, L[3]) },
    show: {}, royals: ROYALS.map(r => Object.assign({}, r)),
    p: [0, 1].map(() => ({ tok: emptyTok(), cards: [], res: [], royals: [], priv: 0 })),
    privSupply: 3, turn: first, phase: "main", refilled: false, pending: [], again: false, winner: null, winWhy: null, log: [], last: null,
  };
  g.show[1] = g.decks[1].splice(0, 5); g.show[2] = g.decks[2].splice(0, 4); g.show[3] = g.decks[3].splice(0, 3);
  fill(g, rnd);
  gainPriv(g, 1 - first);
  return g;
}

/* ───── derived values ───── */
const tokCount = p => TOK.reduce((a, c) => a + p.tok[c], 0);
const cardColor = card => card.as || card.color;
const bonus = (p, c) => p.cards.filter(k => cardColor(k) === c).length;
const points = p => p.cards.reduce((a, k) => a + k.pts, 0) + p.royals.reduce((a, r) => a + r.pts, 0);
const crowns = p => p.cards.reduce((a, k) => a + k.crowns, 0);
const colorPts = (p, c) => p.cards.filter(k => cardColor(k) === c).reduce((a, k) => a + k.pts, 0);
function winWhy(p) {
  if (points(p) >= 20) return "명성 20점";
  if (crowns(p) >= 10) return "왕관 10개";
  for (const c of GEMS) if (colorPts(p, c) >= 10) return `${NAME[c]} 카드 점수 10점`;
  return null;
}
function payment(p, card) {
  // 색별로 내야 할 토큰 (보너스 빼고), 모자라는 만큼은 금으로
  const pay = emptyTok(); let gold = 0;
  for (const c of [...GEMS, "P"]) {
    const need = Math.max(0, (card.cost[c] || 0) - (c === "P" ? 0 : bonus(p, c)));
    const use = Math.min(need, p.tok[c]);
    pay[c] = use; gold += need - use;
  }
  pay.A = gold;
  return gold <= p.tok.A ? pay : null;
}
const canJoker = p => GEMS.some(c => bonus(p, c) > 0);
function lineOK(cells) {
  if (!Array.isArray(cells) || cells.length < 1 || cells.length > 3) return false;
  if (new Set(cells).size !== cells.length || cells.some(i => !(i >= 0 && i < 25))) return false;
  if (cells.length === 1) return true;
  const pts = cells.map(i => [Math.floor(i / 5), i % 5]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const dr = pts[1][0] - pts[0][0], dc = pts[1][1] - pts[0][1];
  if (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) return false;
  for (let k = 2; k < pts.length; k++) if (pts[k][0] - pts[k - 1][0] !== dr || pts[k][1] - pts[k - 1][1] !== dc) return false;
  return true;
}
function gainPriv(g, s) {
  if (g.privSupply > 0) { g.privSupply--; g.p[s].priv++; return true; }
  if (g.p[1 - s].priv > 0) { g.p[1 - s].priv--; g.p[s].priv++; return true; }
  return false;
}

/* ───── turn flow ───── */
function afterMain(g, s, card, before) {
  const p = g.p[s], opp = g.p[1 - s];
  if (card) {
    const ab = card.ab;
    if (ab === "token" && g.board.some(t => t === cardColor(card))) g.pending.push({ type: "takeColor", color: cardColor(card) });
    if (ab === "steal" && GEMS.concat("P").some(c => opp.tok[c] > 0)) g.pending.push({ type: "steal" });
    if (ab === "scroll") gainPriv(g, s);
    if (ab === "again") g.again = true;
    const now = crowns(p);
    for (const th of [3, 6]) if (before < th && now >= th && g.royals.length) g.pending.push({ type: "royal" });
  }
  return cont(g, s);
}
function cont(g, s) {
  if (g.pending.length) { g.phase = "choose"; return g; }
  if (tokCount(g.p[s]) > 10) { g.phase = "discard"; return g; }
  return endTurn(g, s);
}
function endTurn(g, s) {
  const why = winWhy(g.p[s]);
  if (why) { g.winner = s; g.winWhy = why; g.phase = "over"; return g; }
  if (g.again) { g.again = false; g.log.push("한 번 더!"); }
  else g.turn = 1 - s;
  g.phase = "main"; g.refilled = false;
  return g;
}
function takeCard(g, src) {
  // src: {lvl, idx} 진열 / {deck: lvl} 덱 맨 위 / {res: i} 예약 카드
  if (src.res != null) return null;
  if (src.deck) return g.decks[src.deck].length ? { card: g.decks[src.deck][g.decks[src.deck].length - 1], take() { return g.decks[src.deck].pop(); } } : null;
  const row = g.show[src.lvl];
  if (!row || !row[src.idx]) return null;
  return { card: row[src.idx], take() { const c = row[src.idx]; const nx = g.decks[src.lvl].pop(); if (nx) row[src.idx] = nx; else row.splice(src.idx, 1); return c; } };
}

function apply(g, s, a, N, rnd) {
  if (g.phase === "over" || s !== g.turn) return null;
  const p = g.p[s], opp = g.p[1 - s];
  const nm = N[s];
  switch (a.type) {
    case "priv": {
      if (g.phase !== "main" || p.priv < 1) return null;
      const t = g.board[a.cell]; if (!t || t === "A") return null;
      g.board[a.cell] = null; p.tok[t]++; p.priv--; g.privSupply++;
      g.log.push(`${nm} 님이 특권을 써서 ${NAME[t]} 토큰을 가져왔어요`);
      return g;
    }
    case "refill": {
      if (g.phase !== "main" || g.refilled || !g.bag.length) return null;
      fill(g, rnd); g.refilled = true;
      const got = gainPriv(g, 1 - s);
      g.log.push(`${nm} 님이 판을 다시 채웠어요${got ? ` — ${N[1 - s]} 님 특권 +1` : ""}`);
      return g;
    }
    case "take": {
      if (g.phase !== "main" || !lineOK(a.cells)) return null;
      const ts = a.cells.map(i => g.board[i]);
      if (ts.some(t => !t || t === "A")) return null;
      a.cells.forEach(i => { g.board[i] = null; }); ts.forEach(t => p.tok[t]++);
      const same = ts.length === 3 && ts.every(t => t === ts[0]);
      const pearls = ts.filter(t => t === "P").length >= 2;
      let extra = "";
      if (same || pearls) { if (gainPriv(g, 1 - s)) extra = ` — ${N[1 - s]} 님 특권 +1`; }
      g.log.push(`${nm} 님이 토큰 ${ts.map(t => NAME[t]).join("·")}을 가져왔어요${extra}`);
      g.last = { type: "take", s, cells: a.cells };
      return afterMain(g, s, null, crowns(p));
    }
    case "reserve": {
      if (g.phase !== "main" || p.res.length >= 3) return null;
      const gi = a.gold != null ? a.gold : g.board.indexOf("A");
      if (gi < 0 || g.board[gi] !== "A") return null;
      const tk = takeCard(g, a.src); if (!tk) return null;
      const card = tk.take();
      g.board[gi] = null; p.tok.A++;
      p.res.push(card);
      g.log.push(`${nm} 님이 ${a.src.deck ? `${a.src.deck}단계 덱에서 카드를` : "카드를"} 예약하고 금 토큰을 가져왔어요`);
      g.last = { type: "reserve", s, id: card.id };
      return afterMain(g, s, null, crowns(p));
    }
    case "buy": {
      if (g.phase !== "main") return null;
      let card, take;
      if (a.src.res != null) { card = p.res[a.src.res]; if (!card) return null; take = () => p.res.splice(a.src.res, 1)[0]; }
      else { if (a.src.deck) return null; const tk = takeCard(g, a.src); if (!tk) return null; card = tk.card; take = tk.take; }
      if (card.color === "X") { if (!GEMS.includes(a.as) || bonus(p, a.as) < 1) return null; }
      const pay = payment(p, card); if (!pay) return null;
      const before = crowns(p);
      for (const c of TOK) { p.tok[c] -= pay[c]; for (let i = 0; i < pay[c]; i++) g.bag.push(c); }
      const got = take();
      if (got.color === "X") got.as = a.as;
      p.cards.push(got);
      g.log.push(`${nm} 님이 ${got.lvl}단계 ${got.color === "X" ? `조커(${NAME[got.as]})` : NAME[got.color]} 카드를 샀어요${got.pts ? ` (+${got.pts}점)` : ""}${got.crowns ? ` 왕관 ${got.crowns}` : ""}`);
      g.last = { type: "buy", s, id: got.id };
      return afterMain(g, s, got, before);
    }
    case "royal": {
      if (g.phase !== "choose" || !g.pending.length || g.pending[0].type !== "royal") return null;
      const r = g.royals[a.idx]; if (!r) return null;
      g.royals.splice(a.idx, 1); p.royals.push(r); g.pending.shift();
      if (r.ab === "steal" && GEMS.concat("P").some(c => opp.tok[c] > 0)) g.pending.unshift({ type: "steal" });
      if (r.ab === "scroll") gainPriv(g, s);
      if (r.ab === "again") g.again = true;
      g.log.push(`${nm} 님이 왕실 카드를 받았어요 (+${r.pts}점)`);
      return cont(g, s);
    }
    case "steal": {
      if (g.phase !== "choose" || !g.pending.length || g.pending[0].type !== "steal") return null;
      if (a.color === "A" || !(opp.tok[a.color] > 0)) return null;
      opp.tok[a.color]--; p.tok[a.color]++; g.pending.shift();
      g.log.push(`${nm} 님이 ${N[1 - s]} 님의 ${NAME[a.color]} 토큰을 가져갔어요`);
      return cont(g, s);
    }
    case "takeColor": {
      if (g.phase !== "choose" || !g.pending.length || g.pending[0].type !== "takeColor") return null;
      const want = g.pending[0].color;
      if (g.board[a.cell] !== want) return null;
      g.board[a.cell] = null; p.tok[want]++; g.pending.shift();
      g.log.push(`${nm} 님이 카드 능력으로 ${NAME[want]} 토큰을 가져왔어요`);
      return cont(g, s);
    }
    case "pass": {
      if (g.phase !== "main" || canDoMain(g, s)) return null;
      g.log.push(`${nm} 님은 할 수 있는 게 없어서 차례를 넘겼어요`);
      return endTurn(g, s);
    }
    case "discard": {
      if (g.phase !== "discard" || !(p.tok[a.color] > 0)) return null;
      p.tok[a.color]--; g.bag.push(a.color);
      if (tokCount(p) <= 10) { g.log.push(`${nm} 님이 토큰을 10개로 맞췄어요`); return endTurn(g, s); }
      return g;
    }
  }
  return null;
}

function canDoMain(g, s) {
  const p = g.p[s];
  if (g.board.some(t => t && t !== "A")) return true;
  if (!g.refilled && g.bag.length) return true;
  if (p.res.length < 3 && g.board.includes("A") && ([1, 2, 3].some(l => g.show[l].length || g.decks[l].length))) return true;
  const cards = [1, 2, 3].flatMap(l => g.show[l]).concat(p.res);
  return cards.some(c => payment(p, c) && (c.color !== "X" || canJoker(p)));
}
const api = { GEMS, TOK, NAME, SPIRAL, buildCards, setup, apply, payment, bonus, points, crowns, colorPts, tokCount, lineOK, canJoker, cardColor, winWhy, canDoMain };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SDE = api;
})(typeof window !== "undefined" ? window : globalThis);
