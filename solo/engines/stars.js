/* Star Battle — solution counter and puzzle generator (pure; shared by the page, the worker and the checks).
 *
 * An n×n grid is split into n regions. Place k stars in every row, every column and every region,
 * with no two stars touching, not even diagonally.
 * The generator first lays out a valid set of stars, cuts regions around them (k stars each),
 * then keeps reshaping region borders — never moving a star, so the intended answer stays valid —
 * until an exhaustive search finds that answer and no other.
 */
(function (root) {
"use strict";
const Rng = typeof module !== "undefined" && module.exports ? require("./rng.js") : root.SoloRng;

const LEVELS = {
  // minNodes: how much trial and error the exhaustive search needs (higher = fewer easy forced moves)
  hard:      { n: 9,  k: 2, minNodes: 100 },
  extreme:   { n: 10, k: 2, minNodes: 200 },
  nightmare: { n: 10, k: 2, minNodes: 900 },
};

const popcount = m => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
function rowPatterns(n, k) {
  const out = [];
  for (let m = 0; m < 1 << n; m++) if (popcount(m) === k && !(m & (m << 1))) out.push(m);
  return out;
}
const neighbours = (m, n) => (m | (m << 1) | (m >> 1)) & ((1 << n) - 1);

// Count answers (stopping at `cap`) by propagation and branching.
// Returns { count, nodes, sols } — sols holds up to `keep` answers, each a sorted list of star cells.
function count(regions, n, k, cap, keep) {
  keep = keep || 0;
  const units = [];
  for (let r = 0; r < n; r++) units.push(Array.from({ length: n }, (_, c) => r * n + c));
  for (let c = 0; c < n; c++) units.push(Array.from({ length: n }, (_, r) => r * n + c));
  const byReg = Array.from({ length: n }, () => []);
  for (let i = 0; i < n * n; i++) byReg[regions[i]].push(i);
  units.push(...byReg);
  const near = [];
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n, out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
    }
    near.push(out);
  }
  const isLine = u => u < 2 * n;
  const unitsOf = [];
  for (let i = 0; i < n * n; i++) unitsOf.push([Math.floor(i / n), n + i % n, 2 * n + regions[i]]);
  let found = 0, nodes = 0;
  const sols = [];
  // only units that hold a cell that just changed need another look
  const dirty = new Uint8Array(units.length), queue = [];
  const touch = i => { for (const u of unitsOf[i]) if (!dirty[u]) { dirty[u] = 1; queue.push(u); } };
  const empty = (g, i) => { if (g[i] === -1) { g[i] = 0; touch(i); } };

  function star(g, i) {
    if (g[i] === 0) return false;
    if (g[i] === 1) return true;
    g[i] = 1; touch(i);
    for (const j of near[i]) { if (g[j] === 1) return false; empty(g, j); }
    return true;
  }
  function propagate(g, all) {
    if (all) for (let u = 0; u < units.length; u++) if (!dirty[u]) { dirty[u] = 1; queue.push(u); }
    let ok = true;
    while (queue.length) {
      const u = queue.pop(); dirty[u] = 0;
      if (!ok) continue;
      let s = 0, open = 0;
      for (const i of units[u]) { if (g[i] === 1) s++; else if (g[i] === -1) open++; }
      if (s > k || s + open < k) { ok = false; continue; }
      if (!open) continue;
      if (s === k) { for (const i of units[u]) empty(g, i); continue; }
      if (s + open === k) { for (const i of units[u]) if (g[i] === -1 && !star(g, i)) { ok = false; break; } continue; }
      if (isLine(u)) {   // in a row or column, open cells side by side can't both hold a star
        let most = 0, last = -9;
        units[u].forEach((i, x) => { if (g[i] === -1 && x - last >= 2) { most++; last = x; } });
        if (s + most < k) ok = false;
      }
    }
    return ok;
  }
  function rec(g, all) {
    nodes++;
    if (!propagate(g, all)) return;
    let best = -1, bestSlack = 1e9;
    for (let u = 0; u < units.length; u++) {
      let s = 0, open = 0;
      for (const i of units[u]) { if (g[i] === 1) s++; else if (g[i] === -1) open++; }
      if (open && open - (k - s) < bestSlack) { bestSlack = open - (k - s); best = u; }
    }
    if (best < 0) {
      found++;
      if (sols.length < keep) { const out = []; for (let i = 0; i < n * n; i++) if (g[i] === 1) out.push(i); sols.push(out); }
      return;
    }
    const cell = units[best].find(i => g[i] === -1);
    const a = g.slice();
    if (star(a, cell)) rec(a); else while (queue.length) dirty[queue.pop()] = 0;
    if (found >= cap) return;
    const b = g.slice(); empty(b, cell); rec(b);
  }
  rec(new Int8Array(n * n).fill(-1), true);
  return { count: found, nodes, sols };
}

function randomStars(n, k, rng, patterns) {
  const col = new Int32Array(n), rows = new Int32Array(n);
  function rec(i, prev) {
    if (i === n) return true;
    const left = n - 1 - i;
    for (const m of rng.shuffle(patterns.slice())) {
      if (m & neighbours(prev, n)) continue;
      let ok = true;
      for (let c = 0; c < n; c++) { if (m >> c & 1) col[c]++; if (col[c] > k || col[c] + ((left + 1) >> 1) < k) ok = false; }
      if (ok) { rows[i] = m; if (rec(i + 1, m)) return true; }
      for (let c = 0; c < n; c++) if (m >> c & 1) col[c]--;
    }
    return false;
  }
  return rec(0, 0) ? rows : null;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function adj(i, n) {
  const r = Math.floor(i / n), c = i % n, out = [];
  for (const [dr, dc] of DIRS) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc); }
  return out;
}

// Grow a patch around every star, then glue patches together k at a time into regions.
function cutRegions(starCells, n, k, rng) {
  const owner = new Int32Array(n * n).fill(-1);
  starCells.forEach((cell, p) => { owner[cell] = p; });
  // patches grow at different speeds, so regions come out in mixed sizes (small ones pin stars down)
  const speed = starCells.map(() => .08 + rng.next() * rng.next());
  let left = n * n - starCells.length;
  while (left > 0) {
    const pairs = [];
    for (let i = 0; i < n * n; i++) if (owner[i] === -1) for (const j of adj(i, n)) if (owner[j] !== -1) pairs.push([i, owner[j]]);
    let x = rng.next() * pairs.reduce((a, [, o]) => a + speed[o], 0), pick = pairs[pairs.length - 1];
    for (const pr of pairs) { x -= speed[pr[1]]; if (x <= 0) { pick = pr; break; } }
    owner[pick[0]] = pick[1]; left--;
  }
  const P = starCells.length, touch = Array.from({ length: P }, () => new Set());
  for (let i = 0; i < n * n; i++) for (const j of adj(i, n)) if (owner[i] !== owner[j]) touch[owner[i]].add(owner[j]);
  for (let tries = 0; tries < 60; tries++) {
    const group = new Int32Array(P).fill(-1); let g = 0, fail = false;
    const free = p => group[p] === -1;
    const freeDeg = p => [...touch[p]].filter(free).length;
    while (!fail) {
      const open = []; for (let p = 0; p < P; p++) if (free(p)) open.push(p);
      if (!open.length) break;
      const low = Math.min(...open.map(freeDeg)), start = rng.pick(open.filter(p => freeDeg(p) === low));
      const members = [start]; group[start] = g;
      while (members.length < k) {
        const cand = new Set(); for (const m of members) for (const q of touch[m]) if (free(q)) cand.add(q);
        if (!cand.size) { fail = true; break; }
        const cs = [...cand], lo = Math.min(...cs.map(freeDeg)), q = rng.pick(cs.filter(c => freeDeg(c) === lo));
        group[q] = g; members.push(q);
      }
      g++;
    }
    if (!fail) return Array.from(owner, o => group[o]);
  }
  return null;
}

function connectedWithout(regions, n, r, skip) {
  let start = -1, size = 0;
  for (let i = 0; i < n * n; i++) if (regions[i] === r && i !== skip) { size++; if (start < 0) start = i; }
  const seen = new Uint8Array(n * n), stack = [start]; seen[start] = 1; let got = 1;
  while (stack.length) { const i = stack.pop(); for (const j of adj(i, n)) if (!seen[j] && j !== skip && regions[j] === r) { seen[j] = 1; got++; stack.push(j); } }
  return got === size;
}

function generate(level, seed) {
  const L = LEVELS[level], { n, k } = L, rng = Rng.make("stars:" + level + ":" + seed), patterns = rowPatterns(n, k);
  const CAP = 300;
  for (let attempt = 1; ; attempt++) {
    const rows = randomStars(n, k, rng, patterns);
    const stars = [];
    for (let i = 0; i < n; i++) for (let c = 0; c < n; c++) if (rows[i] >> c & 1) stars.push(i * n + c);
    const regions = cutRegions(stars, n, k, rng);
    if (!regions) continue;
    const isStar = new Uint8Array(n * n); stars.forEach(s => { isStar[s] = 1; });
    let res = count(regions, n, k, CAP, 4), stale = 0;
    if (res.count >= CAP) continue;   // too loose to tighten in reasonable time: start over
    for (let step = 0; step < 800 && res.count > 1 && stale < 150; step++) {
      // mostly reshape around a star of some other answer, so that answer breaks
      const alt = res.sols.filter(sol => sol.some(i => !isStar[i]));
      const i = alt.length && rng.next() < .8 ? rng.pick(rng.pick(alt).filter(j => !isStar[j])) : rng.int(n * n);
      if (isStar[i]) continue;
      const others = adj(i, n).map(j => regions[j]).filter(r => r !== regions[i]);
      if (!others.length) continue;
      const from = regions[i];
      if (!connectedWithout(regions, n, from, i)) continue;
      regions[i] = rng.pick(others);
      const next = count(regions, n, k, res.count + 1, 4);   // stop as soon as it is worse
      if (next.count <= res.count) { stale = next.count < res.count ? 0 : stale + 1; res = next; } else { regions[i] = from; stale++; }
    }
    if (res.count !== 1) continue;
    res = count(regions, n, k, 2);
    if (res.count !== 1 || res.nodes < L.minNodes) continue;
    return { level, seed, n, k, regions, solution: stars, attempts: attempt, nodes: res.nodes };
  }
}

// Is a set of star cells a full, valid answer?
function valid(p, cells) {
  const { n, k } = p, row = new Int32Array(n), col = new Int32Array(n), reg = new Int32Array(n), on = new Set(cells);
  for (const i of cells) {
    const r = Math.floor(i / n), c = i % n;
    row[r]++; col[c]++; reg[p.regions[i]]++;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n && on.has(rr * n + cc)) return false;
    }
  }
  for (let x = 0; x < n; x++) if (row[x] !== k || col[x] !== k || reg[x] !== k) return false;
  return true;
}

const api = { LEVELS, rowPatterns, count, generate, valid };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Stars = api;
})(typeof self !== "undefined" ? self : this);
