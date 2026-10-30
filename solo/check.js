// Checks that generated puzzles have exactly one answer, using solvers written separately from the generators'.
// node solo/check.js [count per level]
"use strict";
const Stars = require("./engines/stars.js"), Code = require("./engines/code.js");
const N = +process.argv[2] || 20, LEVELS = ["hard", "extreme", "nightmare"];
let bad = 0;
const fail = (...a) => { bad++; console.log("FAIL", ...a); };

// Star Battle: row by row over every allowed row pattern.
function starAnswers(p, cap) {
  const { n, k, regions } = p, pats = [];
  for (let m = 0; m < 1 << n; m++) { let c = 0, x = m; while (x) { x &= x - 1; c++; } if (c === k && !(m & (m << 1))) pats.push(m); }
  const col = new Array(n).fill(0), reg = new Array(n).fill(0), rows = [], found = [];
  const lastRow = new Array(n).fill(0);
  for (let i = 0; i < n * n; i++) lastRow[regions[i]] = Math.max(lastRow[regions[i]], Math.floor(i / n));
  (function rec(i, prev) {
    if (found.length >= cap) return;
    if (i === n) { if (col.every(x => x === k) && reg.every(x => x === k)) found.push(rows.slice()); return; }
    for (const m of pats) {
      if (m & (prev | prev << 1 | prev >> 1)) continue;
      for (let c = 0; c < n; c++) if (m >> c & 1) { col[c]++; reg[regions[i * n + c]]++; }
      let ok = col.every(x => x <= k) && reg.every(x => x <= k);
      for (let r = 0; r < n && ok; r++) if (lastRow[r] === i && reg[r] !== k) ok = false;
      if (ok) { rows[i] = m; rec(i + 1, m); }
      for (let c = 0; c < n; c++) if (m >> c & 1) { col[c]--; reg[regions[i * n + c]]--; }
    }
  })(0, 0);
  return found;
}

// Code: every possible code against every clue.
function codeAnswers(p) {
  const out = [];
  const total = 10 ** p.len;
  for (let x = 0; x < total; x++) {
    const code = String(x).padStart(p.len, "0").split("").map(Number);
    if (!p.repeat && new Set(code).size !== p.len) continue;
    const ok = p.clues.every(({ guess, s, b }) => {
      let ss = 0; const left = [], rest = [];
      for (let i = 0; i < p.len; i++) { if (guess[i] === code[i]) ss++; else { left.push(guess[i]); rest.push(code[i]); } }
      let bb = 0; for (const d of left) { const j = rest.indexOf(d); if (j >= 0) { bb++; rest.splice(j, 1); } }
      return ss === s && bb === b;
    });
    if (ok) out.push(code);
  }
  return out;
}

for (const lv of LEVELS) {
  for (let s = 0; s < N; s++) {
    const seed = s % 2 ? "c" + s : "2026" + String(1000 + s).slice(1);
    let t = Date.now();
    const st = Stars.generate(lv, seed), stMs = Date.now() - t;
    const sa = starAnswers(st, 2);
    const cells = sa.length === 1 ? sa[0].flatMap((m, r) => [...Array(st.n).keys()].filter(c => m >> c & 1).map(c => r * st.n + c)) : [];
    if (sa.length !== 1 || cells.join() !== st.solution.slice().sort((a, b) => a - b).join()) fail("stars", lv, seed, sa.length);
    if (!Stars.valid(st, st.solution)) fail("stars valid", lv, seed);
    const regionSizes = new Array(st.n).fill(0); st.regions.forEach(r => regionSizes[r]++);
    if (regionSizes.some(x => !x)) fail("stars empty region", lv, seed);

    t = Date.now();
    const cd = Code.generate(lv, seed), cdMs = Date.now() - t;
    const ca = codeAnswers(cd);
    if (ca.length !== 1 || ca[0].join() !== cd.answer.join()) fail("code", lv, seed, ca.length);

    console.log(lv.padEnd(9), seed.padEnd(8), `stars ${stMs}ms`, `code ${cdMs}ms (${cd.clues.length} clues)`);
  }
}
console.log(bad ? `${bad} FAILED` : "all puzzles have exactly one answer");
process.exit(bad ? 1 : 0);
