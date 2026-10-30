/* Nonogram — clue maths, a logic solver and the puzzle generator (pure; shared by the page, the worker and the checks).
 *
 * A cell is 1 (filled) or 0 (empty); while solving, -1 means unknown.
 * Every generated puzzle is proven to have exactly one answer by solving it with sound deductions only:
 *   - line logic: in a single row or column, a cell is fixed if every arrangement of that line's blocks agrees on it;
 *   - probing (nightmare only): if assuming a cell leads, by line logic, to a contradiction, the cell is the other value.
 * Since each step is forced, a solver that fills the whole grid has found the one and only answer,
 * and the player can reach it by reasoning too, never by guessing.
 */
(function (root) {
"use strict";
const Rng = typeof module !== "undefined" && module.exports ? require("./rng.js") : root.SoloRng;

const LEVELS = {
  hard:      { size: 15, density: .5, probe: false, minRounds: 8 },
  extreme:   { size: 20, density: .5, probe: false, minRounds: 11 },
  nightmare: { size: 20, density: .5,  probe: true,  minProbes: 3 },
};

function cluesOf(line) {
  const out = []; let run = 0;
  for (const v of line) { if (v === 1) run++; else if (run) { out.push(run); run = 0; } }
  if (run) out.push(run);
  return out;
}
function clues(sol, w, h) {
  const rows = [], cols = [];
  for (let r = 0; r < h; r++) rows.push(cluesOf(sol.slice(r * w, r * w + w)));
  for (let c = 0; c < w; c++) { const l = []; for (let r = 0; r < h; r++) l.push(sol[r * w + c]); cols.push(cluesOf(l)); }
  return { rows, cols };
}

// Every cell one arrangement of the blocks can give. Returns the narrowed line, or null if no arrangement fits.
function solveLine(clue, line) {
  const n = line.length, k = clue.length;
  // f[i*(k+1)+j]: blocks j.. fit in cells i..
  const W = k + 1, f = new Uint8Array((n + 2) * W);
  for (let i = n; i >= 0; i--) {
    for (let j = k; j >= 0; j--) {
      let ok = false;
      if (j === k) { ok = true; for (let x = i; x < n; x++) if (line[x] === 1) { ok = false; break; } }
      else if (i < n) {
        if (line[i] !== 1 && f[(i + 1) * W + j]) ok = true;
        if (!ok && fits(line, i, clue[j], n) && f[Math.min(n, i + clue[j] + 1) * W + j + 1]) ok = true;
      }
      f[i * W + j] = ok ? 1 : 0;
    }
  }
  if (!f[0]) return null;
  const canFill = new Uint8Array(n), canEmpty = new Uint8Array(n), reach = new Uint8Array((n + 2) * W);
  reach[0] = 1;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= k; j++) {
      if (!reach[i * W + j] || !f[i * W + j]) continue;
      if (j === k) { for (let x = i; x < n; x++) canEmpty[x] = 1; continue; }
      if (i >= n) continue;
      if (line[i] !== 1 && f[(i + 1) * W + j]) { canEmpty[i] = 1; reach[(i + 1) * W + j] = 1; }
      const len = clue[j], nx = Math.min(n, i + len + 1);
      if (fits(line, i, len, n) && f[nx * W + j + 1]) {
        for (let x = i; x < i + len; x++) canFill[x] = 1;
        if (i + len < n) canEmpty[i + len] = 1;
        reach[nx * W + j + 1] = 1;
      }
    }
  }
  const out = line.slice();
  for (let x = 0; x < n; x++) {
    if (canFill[x] && !canEmpty[x]) out[x] = 1;
    else if (canEmpty[x] && !canFill[x]) out[x] = 0;
    else if (!canFill[x] && !canEmpty[x]) return null;
  }
  return out;
}
function fits(line, i, len, n) {
  if (i + len > n) return false;
  for (let x = i; x < i + len; x++) if (line[x] === 0) return false;
  return i + len === n || line[i + len] !== 1;
}

// Line logic until nothing changes. Mutates g. Returns { ok, rounds } (ok=false: contradiction).
// With `cell`, only that cell just changed, so only its row and column start out needing a look.
function lineSolve(g, w, h, cl, cell) {
  const dirtyR = new Uint8Array(h), dirtyC = new Uint8Array(w);
  if (cell === undefined) { dirtyR.fill(1); dirtyC.fill(1); } else { dirtyR[Math.floor(cell / w)] = 1; dirtyC[cell % w] = 1; }
  let rounds = 0, any = true;
  while (any) {
    any = false; rounds++;
    for (let r = 0; r < h; r++) {
      if (!dirtyR[r]) continue; dirtyR[r] = 0;
      const line = Array.from(g.subarray(r * w, r * w + w)), res = solveLine(cl.rows[r], line);
      if (!res) return { ok: false, rounds };
      for (let c = 0; c < w; c++) if (res[c] !== line[c]) { g[r * w + c] = res[c]; dirtyC[c] = 1; any = true; }
    }
    for (let c = 0; c < w; c++) {
      if (!dirtyC[c]) continue; dirtyC[c] = 0;
      const line = []; for (let r = 0; r < h; r++) line.push(g[r * w + c]);
      const res = solveLine(cl.cols[c], line);
      if (!res) return { ok: false, rounds };
      for (let r = 0; r < h; r++) if (res[r] !== line[r]) { g[r * w + c] = res[r]; dirtyR[r] = 1; any = true; }
    }
  }
  return { ok: true, rounds };
}

// Solve with line logic, then (if allowed) probing. Returns { grid, solved, rounds, probes }.
function solve(cl, w, h, probe) {
  const g = new Int8Array(w * h).fill(-1);
  const first = lineSolve(g, w, h, cl);
  if (!first.ok) return { grid: g, solved: false, contradiction: true };
  let probes = 0;
  const done = () => g.every(v => v !== -1);
  if (probe) {
    // keep sweeping until a whole sweep finds nothing
    for (let i = 0, quiet = 0; quiet < w * h && !done(); i = (i + 1) % (w * h), quiet++) {
      if (g[i] !== -1) continue;
      for (const v of [1, 0]) {
        const t = g.slice(); t[i] = v;
        if (!lineSolve(t, w, h, cl, i).ok) {
          g[i] = 1 - v; probes++; quiet = 0;
          if (!lineSolve(g, w, h, cl, i).ok) return { grid: g, solved: false, contradiction: true };
          break;
        }
      }
    }
  }
  return { grid: g, solved: done(), rounds: first.rounds, probes };
}

function generate(level, seed) {
  const L = LEVELS[level], rng = Rng.make("nonogram:" + level + ":" + seed), n = L.size;
  for (let attempt = 1; ; attempt++) {
    const sol = new Array(n * n);
    for (let i = 0; i < n * n; i++) sol[i] = rng.next() < L.density ? 1 : 0;
    const cl = clues(sol, n, n);
    if (cl.rows.some(c => !c.length) || cl.cols.some(c => !c.length)) continue;
    const line = solve(cl, n, n, false);
    if (!L.probe) {
      if (line.solved && line.rounds >= L.minRounds) return { level, seed, w: n, h: n, rows: cl.rows, cols: cl.cols, solution: sol, attempts: attempt, rounds: line.rounds };
      continue;
    }
    if (line.solved) continue;   // nightmare must need more than line logic
    const deep = solve(cl, n, n, true);
    if (deep.solved && deep.probes >= L.minProbes) return { level, seed, w: n, h: n, rows: cl.rows, cols: cl.cols, solution: sol, attempts: attempt, probes: deep.probes };
  }
}

// Does a player's grid (1 = filled, anything else = not) match every clue?
function matches(p, grid) {
  const g = Array.from(grid, v => v === 1 ? 1 : 0), cl = clues(g, p.w, p.h);
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  return cl.rows.every((c, i) => eq(c, p.rows[i])) && cl.cols.every((c, i) => eq(c, p.cols[i]));
}

const api = { LEVELS, clues, cluesOf, solveLine, solve, generate, matches };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Nonogram = api;
})(typeof self !== "undefined" ? self : this);
