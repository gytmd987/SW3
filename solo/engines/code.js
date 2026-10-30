/* Code deduction — a hidden number and a list of past guesses with their scores (pure; shared by the page, the worker and the checks).
 *
 * Score of a guess: S = right digit in the right place; B = right digit in the wrong place.
 * With repeated digits (nightmare), each digit of the answer can be matched at most once:
 *   B = Σ over digits d of min(times d is in the guess, times d is in the answer) − S.
 * The generator adds random guesses until only one possible answer is left, never using a guess
 * that scores 0S 0B (it rules out digits too cheaply) or one that cuts the possibilities by more than
 * three quarters at once, then drops every guess it can while the answer stays the only one.
 * Uniqueness is checked against every possible code.
 */
(function (root) {
"use strict";
const Rng = typeof module !== "undefined" && module.exports ? require("./rng.js") : root.SoloRng;

const LEVELS = {
  hard:      { len: 4, repeat: false, minClues: 5 },
  extreme:   { len: 5, repeat: false, minClues: 6 },
  nightmare: { len: 5, repeat: true,  minClues: 7 },
};

const spaces = {};
function space(len, repeat) {
  const key = len + (repeat ? "r" : "d");
  if (spaces[key]) return spaces[key];
  const out = [], cur = [];
  (function rec() {
    if (cur.length === len) { out.push(cur.slice()); return; }
    for (let d = 0; d <= 9; d++) { if (!repeat && cur.includes(d)) continue; cur.push(d); rec(); cur.pop(); }
  })();
  return (spaces[key] = out);
}

function score(guess, code) {
  let s = 0; const cg = new Int8Array(10), cc = new Int8Array(10);
  for (let i = 0; i < guess.length; i++) { if (guess[i] === code[i]) s++; cg[guess[i]]++; cc[code[i]]++; }
  let common = 0; for (let d = 0; d < 10; d++) common += Math.min(cg[d], cc[d]);
  return { s, b: common - s };
}
const fits = (code, clue) => { const r = score(clue.guess, code); return r.s === clue.s && r.b === clue.b; };
const left = (all, clues) => all.filter(c => clues.every(cl => fits(c, cl)));

function generate(level, seed) {
  const L = LEVELS[level], rng = Rng.make("code:" + level + ":" + seed), all = space(L.len, L.repeat);
  for (let attempt = 1; ; attempt++) {
    const answer = rng.pick(all);
    let clues = [], cand = all;
    for (let tries = 0; cand.length > 1 && tries < 5000; tries++) {
      const guess = rng.pick(all), r = score(guess, answer);
      if (r.s === L.len || (r.s === 0 && r.b === 0)) continue;
      const clue = { guess, s: r.s, b: r.b }, next = cand.filter(c => fits(c, clue));
      // prefer weak clues, so the answer only shows up when many are put together
      if (next.length < cand.length && (cand.length < 30 || next.length * 4 >= cand.length)) { clues.push(clue); cand = next; }
    }
    if (cand.length !== 1) continue;
    // drop clues while the answer stays the only one
    for (const clue of rng.shuffle(clues.slice())) {
      const without = clues.filter(c => c !== clue);
      if (left(all, without).length === 1) clues = without;
    }
    if (clues.length < L.minClues) continue;
    return { level, seed, len: L.len, repeat: L.repeat, clues: rng.shuffle(clues), answer, attempts: attempt };
  }
}

const api = { LEVELS, space, score, left, generate };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Code = api;
})(typeof self !== "undefined" ? self : this);
