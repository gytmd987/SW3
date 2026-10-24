/* Turing Machine — criteria cards, puzzle generator and rules (pure; shared by the page and the tests).
 *
 * A code is three digits 1–5: blue ▲ (B), yellow ■ (Y), purple ● (P).
 * Each verifier card lists several possible criteria; the verifier secretly checks exactly one.
 * A generated puzzle has the property the real game promises: among every way of picking one
 * criterion per card, the only combinations that leave exactly one code with no useless
 * verifier all point to the same code. So the answer can be reached by logic alone.
 * The card list is our own, modelled on the kinds of criteria the real game uses.
 */
(function (root) {
"use strict";
const CODES = [];
for (let b = 1; b <= 5; b++) for (let y = 1; y <= 5; y++) for (let p = 1; p <= 5; p++) CODES.push([b, y, p]);
const COL = ["B", "Y", "P"];
const sum = c => c[0] + c[1] + c[2];
const cnt = (c, v) => c.filter(x => x === v).length;
const evens = c => c.filter(x => x % 2 === 0).length;
const cmp = (a, b) => a < b ? 0 : a === b ? 1 : 2;
const ups = c => (c[1] === c[0] + 1 ? 1 : 0) + (c[2] === c[1] + 1 ? 1 : 0);
const uniqMin = c => { const m = Math.min(...c); return cnt(c, m) === 1 ? c.indexOf(m) : -1; };
const uniqMax = c => { const m = Math.max(...c); return cnt(c, m) === 1 ? c.indexOf(m) : -1; };

// {B} {Y} {P} in text are drawn as the coloured shapes
const R = (t, f) => ({ t, f });
const vs = (i, n) => [R(`{${COL[i]}} < ${n}`, c => c[i] < n), R(`{${COL[i]}} = ${n}`, c => c[i] === n), R(`{${COL[i]}} > ${n}`, c => c[i] > n)];
const pair = (i, j) => [R(`{${COL[i]}} < {${COL[j]}}`, c => cmp(c[i], c[j]) === 0), R(`{${COL[i]}} = {${COL[j]}}`, c => cmp(c[i], c[j]) === 1), R(`{${COL[i]}} > {${COL[j]}}`, c => cmp(c[i], c[j]) === 2)];
const parity = i => [R(`{${COL[i]}}는 짝수`, c => c[i] % 2 === 0), R(`{${COL[i]}}는 홀수`, c => c[i] % 2 === 1)];
const count = v => [0, 1, 2, 3].map(k => R(`${v}${v === 4 ? "가" : "이"} ${k}개`, c => cnt(c, v) === k));

const CARDS = [
  { name: "파랑과 1", rules: [R("{B} = 1", c => c[0] === 1), R("{B} > 1", c => c[0] > 1)] },
  { name: "파랑과 3", rules: vs(0, 3) },
  { name: "노랑과 3", rules: vs(1, 3) },
  { name: "보라와 3", rules: vs(2, 3) },
  { name: "노랑과 4", rules: vs(1, 4) },
  { name: "보라와 4", rules: vs(2, 4) },
  { name: "파랑의 짝홀", rules: parity(0) },
  { name: "노랑의 짝홀", rules: parity(1) },
  { name: "보라의 짝홀", rules: parity(2) },
  { name: "1의 개수", rules: count(1) },
  { name: "3의 개수", rules: count(3) },
  { name: "4의 개수", rules: count(4) },
  { name: "파랑과 노랑", rules: pair(0, 1) },
  { name: "파랑과 보라", rules: pair(0, 2) },
  { name: "노랑과 보라", rules: pair(1, 2) },
  { name: "혼자 가장 작은 색", rules: [0, 1, 2].map(i => R(`{${COL[i]}}가 가장 작다`, c => uniqMin(c) === i)) },
  { name: "혼자 가장 큰 색", rules: [0, 1, 2].map(i => R(`{${COL[i]}}가 가장 크다`, c => uniqMax(c) === i)) },
  { name: "짝수와 홀수", rules: [R("짝수가 더 많다", c => evens(c) >= 2), R("홀수가 더 많다", c => evens(c) <= 1)] },
  { name: "짝수의 개수", rules: [0, 1, 2, 3].map(k => R(`짝수가 ${k}개`, c => evens(c) === k)) },
  { name: "합의 짝홀", rules: [R("합이 짝수", c => sum(c) % 2 === 0), R("합이 홀수", c => sum(c) % 2 === 1)] },
  { name: "파랑+노랑과 6", rules: [R("{B}+{Y} < 6", c => c[0] + c[1] < 6), R("{B}+{Y} = 6", c => c[0] + c[1] === 6), R("{B}+{Y} > 6", c => c[0] + c[1] > 6)] },
  { name: "노랑+보라와 6", rules: [R("{Y}+{P} < 6", c => c[1] + c[2] < 6), R("{Y}+{P} = 6", c => c[1] + c[2] === 6), R("{Y}+{P} > 6", c => c[1] + c[2] > 6)] },
  { name: "세 수의 합과 6", rules: [R("합 < 6", c => sum(c) < 6), R("합 = 6", c => sum(c) === 6), R("합 > 6", c => sum(c) > 6)] },
  { name: "세 수의 합과 10", rules: [R("합 < 10", c => sum(c) < 10), R("합 = 10", c => sum(c) === 10), R("합 > 10", c => sum(c) > 10)] },
  { name: "같은 수", rules: [R("세 수가 모두 같다", c => c[0] === c[1] && c[1] === c[2]), R("딱 두 수만 같다", c => new Set(c).size === 2), R("모두 다르다", c => new Set(c).size === 3)] },
  { name: "순서", rules: [R("{B} < {Y} < {P} (오름차순)", c => c[0] < c[1] && c[1] < c[2]), R("{B} > {Y} > {P} (내림차순)", c => c[0] > c[1] && c[1] > c[2]), R("둘 다 아니다", c => !(c[0] < c[1] && c[1] < c[2]) && !(c[0] > c[1] && c[1] > c[2]))] },
  { name: "1씩 커지는 이웃", rules: [R("{B}→{Y}→{P} 모두 1씩 커진다", c => ups(c) === 2), R("한 곳만 1 커진다", c => ups(c) === 1), R("1 커지는 곳이 없다", c => ups(c) === 0)] },
  { name: "어느 색이 1인가", rules: [0, 1, 2].map(i => R(`{${COL[i]}} = 1`, c => c[i] === 1)) },
  { name: "어느 색이 3보다 작은가", rules: [0, 1, 2].map(i => R(`{${COL[i]}} < 3`, c => c[i] < 3)) },
  { name: "어느 색이 4보다 큰가", rules: [0, 1, 2].map(i => R(`{${COL[i]}} = 5`, c => c[i] === 5)) },
  { name: "합의 배수", rules: [3, 4, 5].map(k => R(`합이 ${k}의 배수`, c => sum(c) % k === 0)) },
];

/* bitmasks over the 125 codes (4 × 32 bits) */
const maskOf = f => { const m = new Uint32Array(4); CODES.forEach((c, i) => { if (f(c)) m[i >> 5] |= 1 << (i & 31); }); return m; };
CARDS.forEach(card => card.rules.forEach(r => { r.m = maskOf(r.f); }));
const FULL = maskOf(() => true);
const pop = x => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
const and = (a, b) => { const m = new Uint32Array(4); for (let i = 0; i < 4; i++) m[i] = a[i] & b[i]; return m; };
const size = m => pop(m[0]) + pop(m[1]) + pop(m[2]) + pop(m[3]);
const first = m => { for (let i = 0; i < 4; i++) if (m[i]) for (let k = 0; k < 32; k++) if (m[i] & (1 << k)) return i * 32 + k; return -1; };
function meet(masks, skip) { let m = FULL; masks.forEach((x, i) => { if (i !== skip) m = and(m, x); }); return m; }
// one code, and every verifier needed?
function tight(masks) {
  const all = meet(masks, -1);
  if (size(all) !== 1) return -1;
  for (let i = 0; i < masks.length; i++) if (size(meet(masks, i)) === 1) return -1;
  return first(all);
}
function deducible(cards, answer) {
  const n = cards.length, idx = Array(n).fill(0);
  for (;;) {
    const sol = tight(cards.map((c, i) => CARDS[c].rules[idx[i]].m));
    if (sol >= 0 && sol !== answer) return false;
    let k = 0; while (k < n && ++idx[k] >= CARDS[cards[k]].rules.length) { idx[k] = 0; k++; }
    if (k === n) return true;
  }
}
function generate(n, rnd) {
  for (let attempt = 0; attempt < 300000; attempt++) {
    const deck = CARDS.map((_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) { const j = rnd(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const cards = deck.slice(0, n);
    const rules = cards.map(c => rnd(CARDS[c].rules.length));
    const sol = tight(cards.map((c, i) => CARDS[c].rules[rules[i]].m));
    if (sol < 0 || !deducible(cards, sol)) continue;
    return { cards, rules, answer: CODES[sol].slice(), attempts: attempt + 1 };
  }
  return null;
}
const check = (g, card, code) => CARDS[g.cards[card]].rules[g.rules[card]].f(code);
const sameCode = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const okCode = c => Array.isArray(c) && c.length === 3 && c.every(x => Number.isInteger(x) && x >= 1 && x <= 5);

/* ───── game ───── */
function setup(n, rnd) {
  let pz = null;
  for (let k = n; !pz && k >= 4; k--) pz = generate(k, rnd);   // 아주 드물게 못 만들면 카드 하나 적게
  n = pz.cards.length;
  return {
    n, cards: pz.cards, rules: pz.rules, answer: pz.answer, round: 1, phase: "play",
    p: [0, 1].map(() => ({ tests: [], done: false, guess: null, out: false })),
    winner: null, log: [],
  };
}
const used = pl => pl.tests.length;
const roundTests = (pl, r) => pl.tests.filter(t => t.round === r);
function apply(g, seat, a, N) {
  if (g.phase !== "play") return null;
  const me = g.p[seat];
  if (me.out || me.done) return null;
  if (a.type === "test") {
    if (!okCode(a.code) || !(a.card >= 0 && a.card < g.n)) return null;
    const rt = roundTests(me, g.round);
    if (rt.length >= 3 || rt.some(t => t.card === a.card)) return null;
    if (rt.length && !sameCode(rt[0].code, a.code)) return null;          // 한 라운드엔 한 코드
    me.tests.push({ round: g.round, code: a.code.slice(), card: a.card, ok: check(g, a.card, a.code) });
    return g;
  }
  if (a.type === "end") {
    if (a.guess != null && !okCode(a.guess)) return null;
    me.done = true; me.guess = a.guess ? a.guess.slice() : null;
    const live = [0, 1].filter(s => !g.p[s].out);
    if (live.every(s => g.p[s].done)) resolve(g, N);
    return g;
  }
  return null;
}
function resolve(g, N) {
  const right = [], wrong = [];
  [0, 1].forEach(s => { const pl = g.p[s]; if (pl.out || !pl.guess) return; (sameCode(pl.guess, g.answer) ? right : wrong).push(s); });
  wrong.forEach(s => { g.p[s].out = true; g.log.push(`${g.round}라운드: ${N[s]} 님의 정답 도전 ${g.p[s].guess.join("")} — 틀렸어요`); });
  right.forEach(s => g.log.push(`${g.round}라운드: ${N[s]} 님이 정답을 맞혔어요 (질문 ${used(g.p[s])}번)`));
  if (right.length) {
    g.phase = "over";
    if (right.length === 2) { const [a, b] = right.map(s => used(g.p[s])); g.winner = a === b ? "tie" : a < b ? 0 : 1; }
    else g.winner = right[0];
    return;
  }
  if (g.p.every(pl => pl.out)) { g.phase = "over"; g.winner = "none"; return; }
  g.round += 1;
  g.p.forEach(pl => { pl.done = false; pl.guess = null; });
}

const api = { CODES, CARDS, COL, generate, deducible, tight, setup, apply, check, roundTests, used, sameCode };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TME = api;
})(typeof window !== "undefined" ? window : globalThis);
