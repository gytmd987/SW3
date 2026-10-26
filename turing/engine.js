/* Turing Machine — criteria cards, puzzle generator and rules (pure; shared by the page and the tests).
 *
 * A code is three digits 1–5: blue ▲ (B), yellow ■ (Y), purple ● (P).
 * Each verifier card lists several possible criteria; the verifier secretly checks exactly one.
 * Modes, as in the real game: classic (one card per verifier), extreme (two cards per verifier;
 * the criterion is one of either card's), nightmare (the player is not told which card belongs
 * to which verifier). Cards are shown in "slots"; verifier letters map to slots through perm.
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
const count = v => [0, 1, 2, 3].map(k => R(`${v}${[2, 4, 5].includes(v) ? "가" : "이"} ${k}개`, c => cnt(c, v) === k));
const PAIRS = [[0, 1], [0, 2], [1, 2]];
const big = x => Math.max(...x), small = x => Math.min(...x);
const sum2 = k => PAIRS.map(([i, j]) => R(`{${COL[i]}}+{${COL[j]}} = ${k}`, c => c[i] + c[j] === k));


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
  // ── 넓은 카드: 원작처럼 후보 조건이 6~9개 ──
  { name: "어떤 색과 1", rules: [0, 1, 2].flatMap(i => [R(`{${COL[i]}} = 1`, c => c[i] === 1), R(`{${COL[i]}} > 1`, c => c[i] > 1)]) },
  { name: "어떤 색과 3", rules: [0, 1, 2].flatMap(i => vs(i, 3)) },
  { name: "어떤 색과 4", rules: [0, 1, 2].flatMap(i => vs(i, 4)) },
  { name: "어떤 색의 짝홀", rules: [0, 1, 2].flatMap(i => parity(i)) },
  { name: "어떤 두 색의 비교", rules: PAIRS.flatMap(([i, j]) => pair(i, j)) },
  { name: "어떤 수가 몇 개", rules: [1, 3, 4].flatMap(v => [0, 1, 2].map(k => R(`${v}${v === 4 ? "가" : "이"} ${k}개`, c => cnt(c, v) === k))) },
  // ── 그 밖의 조건 ──
  { name: "파랑과 4", rules: vs(0, 4) },
  { name: "2의 개수", rules: count(2) },
  { name: "5의 개수", rules: count(5) },
  { name: "가장 작은 색 (같은 값 포함)", rules: [0, 1, 2].map(i => R(`{${COL[i]}}보다 작은 색이 없다`, c => c[i] === small(c))) },
  { name: "가장 큰 색 (같은 값 포함)", rules: [0, 1, 2].map(i => R(`{${COL[i]}}보다 큰 색이 없다`, c => c[i] === big(c))) },
  { name: "어떤 두 색의 합이 4", rules: sum2(4) },
  { name: "어떤 두 색의 합이 6", rules: sum2(6) },
  { name: "어떤 두 색의 합이 8", rules: sum2(8) },
  { name: "세 수의 합과 8", rules: [R("합 < 8", c => sum(c) < 8), R("합 = 8", c => sum(c) === 8), R("합 > 8", c => sum(c) > 8)] },
  { name: "합의 크기", rules: [R("합이 6 이하", c => sum(c) <= 6), R("합이 7~9", c => sum(c) >= 7 && sum(c) <= 9), R("합이 10 이상", c => sum(c) >= 10)] },
  { name: "파랑과 노랑의 짝홀", rules: [R("{B}와 {Y}의 짝홀이 같다", c => c[0] % 2 === c[1] % 2), R("{B}와 {Y}의 짝홀이 다르다", c => c[0] % 2 !== c[1] % 2)] },
  { name: "혼자 짝수인 색", rules: [0, 1, 2].map(i => R(`{${COL[i]}}만 짝수`, c => c[i] % 2 === 0 && evens(c) === 1)) },
  { name: "혼자 홀수인 색", rules: [0, 1, 2].map(i => R(`{${COL[i]}}만 홀수`, c => c[i] % 2 === 1 && evens(c) === 2)) },
  { name: "가장 큰 수와 가장 작은 수의 차이", rules: [0, 1, 2, 3, 4].map(k => R(`차이가 ${k}`, c => big(c) - small(c) === k)) },
  { name: "가장 큰 수", rules: [R("가장 큰 수가 3 이하", c => big(c) <= 3), R("가장 큰 수가 4", c => big(c) === 4), R("가장 큰 수가 5", c => big(c) === 5)] },
  { name: "가장 작은 수", rules: [R("가장 작은 수가 1", c => small(c) === 1), R("가장 작은 수가 2", c => small(c) === 2), R("가장 작은 수가 3 이상", c => small(c) >= 3)] },
  { name: "노랑의 자리", rules: [R("{Y}가 {B}와 {P} 사이에 있다", c => (c[0] < c[1] && c[1] < c[2]) || (c[0] > c[1] && c[1] > c[2])), R("{Y}가 사이에 있지 않다", c => !((c[0] < c[1] && c[1] < c[2]) || (c[0] > c[1] && c[1] > c[2])))] },
  { name: "이어지는 세 수", rules: [R("세 수를 정렬하면 1씩 이어진다", c => { const x = c.slice().sort((a, b) => a - b); return x[1] === x[0] + 1 && x[2] === x[1] + 1; }), R("이어지지 않는다", c => { const x = c.slice().sort((a, b) => a - b); return !(x[1] === x[0] + 1 && x[2] === x[1] + 1); })] },
  { name: "같은 값인 두 색", rules: PAIRS.map(([i, j]) => R(`{${COL[i]}} = {${COL[j]}}`, c => c[i] === c[j])) },
  { name: "어느 색이 2인가", rules: [0, 1, 2].map(i => R(`{${COL[i]}} = 2`, c => c[i] === 2)) },
  { name: "파랑과 노랑+보라", rules: [R("{B} < {Y}+{P}", c => c[0] < c[1] + c[2]), R("{B} = {Y}+{P}", c => c[0] === c[1] + c[2]), R("{B} > {Y}+{P}", c => c[0] > c[1] + c[2])] },
  { name: "보라와 파랑+노랑", rules: [R("{P} < {B}+{Y}", c => c[2] < c[0] + c[1]), R("{P} = {B}+{Y}", c => c[2] === c[0] + c[1]), R("{P} > {B}+{Y}", c => c[2] > c[0] + c[1])] },
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
// 모든 "카드마다 조건 하나" 조합을 훑는다. 코드가 딱 하나 남고 군더더기 검증기가 없는 조합이
// 전부 같은 답을 가리켜야 논리만으로 풀린다. (중간에 0개·1개가 되면 그 가지는 끝)
function deducible(lists, answer) {
  const n = lists.length, chosen = [];
  function dfs(i, cur) {
    if (i === n) {
      if (size(cur) !== 1) return true;
      for (let k = 0; k < n; k++) { let m = FULL; for (let t = 0; t < n; t++) if (t !== k) m = and(m, chosen[t]); if (size(m) === 1) return true; }
      return first(cur) === answer;
    }
    for (const m of lists[i]) {
      const nx = and(cur, m), z = size(nx);
      if (z === 0 || (z === 1 && i < n - 1)) continue;
      chosen[i] = m;
      if (!dfs(i + 1, nx)) return false;
    }
    return true;
  }
  return dfs(0, FULL);
}
// 슬롯 묶음에서 성립하는 조합을 전부 찾아 답이 하나로 모이면 {answer, rules}, 아니면 null
function solveSlots(lists, rnd) {
  const n = lists.length, chosen = [], idx = [];
  let answer = -1, combos = [];
  function dfs(i, cur) {
    if (i === n) {
      if (size(cur) !== 1) return true;
      for (let k = 0; k < n; k++) { let m = FULL; for (let t = 0; t < n; t++) if (t !== k) m = and(m, chosen[t]); if (size(m) === 1) return true; }
      const a = first(cur);
      if (answer >= 0 && a !== answer) return false;
      answer = a; combos.push(idx.slice());
      return true;
    }
    const l = lists[i];
    for (let j = 0; j < l.length; j++) {
      const nx = and(cur, l[j].m), z = size(nx);
      if (z === 0 || (z === 1 && i < n - 1)) continue;
      chosen[i] = l[j].m; idx[i] = j;
      if (!dfs(i + 1, nx)) return false;
    }
    return true;
  }
  if (!dfs(0, FULL) || answer < 0) return null;
  return { answer, rules: combos[rnd(combos.length)] };
}
const slotRules = slot => slot.flatMap(c => CARDS[c].rules);
function generate(n, rnd, opts) {
  opts = opts || {};
  const per = opts.mode === "extreme" ? 2 : 1, hard = !!opts.hard;
  const deadline = Date.now() + (opts.ms || 4000);
  const weight = c => hard ? Math.max(1, CARDS[c].rules.length - 1) ** 1.5 : 1;   // 어려움: 후보가 많은 카드를 자주
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    const pool = CARDS.map((_, i) => i), picked = [];
    while (picked.length < n * per) {
      const tot = pool.reduce((a, c) => a + weight(c), 0);
      let r = (rnd(1e6) / 1e6) * tot, k = 0;
      while (k < pool.length - 1 && (r -= weight(pool[k])) > 0) k++;
      picked.push(pool.splice(k, 1)[0]);
    }
    const slots = []; for (let v = 0; v < n; v++) slots.push(picked.slice(v * per, v * per + per));
    const pz = solveSlots(slots.map(sl => slotRules(sl)), rnd);
    if (!pz) continue;
    return { slots, rules: pz.rules, answer: CODES[pz.answer].slice(), attempts: attempt + 1 };
  }
  return null;
}
const slotOf = (g, v) => g.perm ? g.perm[v] : v;               // 검증기 v가 쓰는 카드 자리
const ruleOf = (g, slot) => slotRules(g.slots[slot])[g.rules[slot]];
const check = (g, v, code) => ruleOf(g, slotOf(g, v)).f(code);
const sameCode = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const okCode = c => Array.isArray(c) && c.length === 3 && c.every(x => Number.isInteger(x) && x >= 1 && x <= 5);

/* ───── game ───── */
function setup(n, rnd, opts) {
  opts = opts || {};
  let pz = null;
  for (let k = n; !pz && k >= 4; k--) pz = generate(k, rnd, opts);   // 시간 안에 못 만들면 검증기 하나 적게
  if (!pz) pz = generate(4, rnd, { mode: "classic" });
  n = pz.slots.length;
  let perm = null;
  if (opts.mode === "nightmare") { perm = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = rnd(i + 1); [perm[i], perm[j]] = [perm[j], perm[i]]; } }
  return {
    n, mode: opts.mode || "classic", hard: !!opts.hard, slots: pz.slots, rules: pz.rules, perm, answer: pz.answer, round: 1, phase: "play",
    solo: !!opts.solo,
    p: (opts.solo ? [0] : [0, 1]).map(() => ({ tests: [], done: false, guess: null, out: false, miss: 0 })),
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
    const live = g.p.map((_, s) => s).filter(s => !g.p[s].out);
    if (live.every(s => g.p[s].done)) resolve(g, N);
    return g;
  }
  return null;
}
function resolve(g, N) {
  const right = [], wrong = [];
  g.p.forEach((pl, s) => { if (pl.out || !pl.guess) return; (sameCode(pl.guess, g.answer) ? right : wrong).push(s); });
  // 혼자 연습할 땐 틀려도 탈락하지 않고 계속 풀어요
  wrong.forEach(s => { if (g.solo) g.p[s].miss = (g.p[s].miss || 0) + 1; else g.p[s].out = true; g.log.push(`${g.round}라운드: ${N[s]} 님의 정답 도전 ${g.p[s].guess.join("")} — 틀렸어요`); });
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

const api = { CODES, CARDS, COL, generate, deducible, solveSlots, tight, setup, apply, check, roundTests, used, sameCode, slotRules, slotOf, ruleOf };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TME = api;
})(typeof window !== "undefined" ? window : globalThis);
