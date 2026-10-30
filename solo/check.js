// Checks that generated puzzles have exactly one answer, using solvers written separately from the generators'.
// node solo/check.js [count per level]
"use strict";
const Nonogram = require("./engines/nonogram.js"), Stars = require("./engines/stars.js"), Code = require("./engines/code.js");
const N = +process.argv[2] || 20, LEVELS = ["hard", "extreme", "nightmare"];
let bad = 0;
const fail = (...a) => { bad++; console.log("FAIL", ...a); };

// Nonogram: try every arrangement of each row, top to bottom, keeping each column's top part consistent with its clue.
function nonogramAnswers(p, cap) {
  const { w, h } = p;
  const rowOpts = p.rows.map(clue => {
    const out = [];
    (function place(j, start, line) {
      if (j === clue.length) { out.push(line.slice()); return; }
      const rest = clue.slice(j + 1).reduce((a, b) => a + b + 1, 0);
      for (let s = start; s + clue[j] + rest <= w; s++) {
        const l = line.slice(); for (let x = s; x < s + clue[j]; x++) l[x] = 1;
        place(j + 1, s + clue[j] + 1, l);
      }
    })(0, 0, new Array(w).fill(0));
    return out;
  });
  const grid = [], found = [];
  const colOk = (c, rows) => {
    const clue = p.cols[c], runs = []; let run = 0;
    for (let r = 0; r < rows; r++) { if (grid[r][c]) run++; else if (run) { runs.push(run); run = 0; } }
    const done = rows === h;
    if (done) { if (run) runs.push(run); return runs.length === clue.length && runs.every((x, i) => x === clue[i]); }
    if (runs.length > clue.length || runs.some((x, i) => x !== clue[i])) return false;
    if (run && (runs.length >= clue.length || run > clue[runs.length])) return false;
    // what is still needed must fit in the rows left
    let need = run ? clue[runs.length] - run : -1;   // -1: no gap needed before the next block
    const from = runs.length + (run ? 1 : 0);
    for (let i = from; i < clue.length; i++) need += clue[i] + 1;
    return need <= h - rows;
  };
  (function rec(r) {
    if (found.length >= cap) return;
    if (r === h) { found.push(grid.flat()); return; }
    for (const opt of rowOpts[r]) {
      grid[r] = opt;
      let ok = true; for (let c = 0; c < w && ok; c++) ok = colOk(c, r + 1);
      if (ok) rec(r + 1);
      if (found.length >= cap) return;
    }
  })(0);
  return found;
}

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
    const ng = Nonogram.generate(lv, seed), ngMs = Date.now() - t;
    const na = nonogramAnswers(ng, 2);
    if (na.length !== 1 || na[0].some((v, i) => v !== ng.solution[i])) fail("nonogram", lv, seed, na.length);
    if (!Nonogram.matches(ng, ng.solution)) fail("nonogram matches", lv, seed);

    t = Date.now();
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

    console.log(lv.padEnd(9), seed.padEnd(8), `nonogram ${ngMs}ms`, `stars ${stMs}ms`, `code ${cdMs}ms (${cd.clues.length} clues)`);
  }
}
console.log(bad ? `${bad} FAILED` : "all puzzles have exactly one answer");
process.exit(bad ? 1 : 0);
