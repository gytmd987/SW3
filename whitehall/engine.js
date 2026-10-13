/* Whitehall Mystery — rules engine and the London map (pure; shared by the page and the tests).
 *
 * The map is generated here (same every time): a street grid with the Thames running across
 * it and two bridges. Numbered circles are Jack's places (one per street segment); black
 * squares are the crossings the investigators stand on. Jack walks from a place to a place
 * that meets it at a crossing, and cannot pass a crossing an investigator is standing on.
 * The real board is a drawing of Whitehall; this map is our own, with the same rules.
 */
(function (root) {
"use strict";

/* ───── map ───── */
const COLS = 6, ROWS = 7, SP = 92, M = 50, RIVER_ROW = 3, RIVER_GAP = 46, BRIDGES = [1, 4];
const W = M * 2 + (COLS - 1) * SP, H = M * 2 + (ROWS - 1) * SP + RIVER_GAP;
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const MAP = (() => {
  const R = mulberry(1888);
  const cross = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const edge = r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1;
    const j = edge ? 6 : 14;
    cross.push({ id: r * COLS + c, r, c, x: Math.round(M + c * SP + (R() * 2 - 1) * j), y: Math.round(M + r * SP + (r > RIVER_ROW ? RIVER_GAP : 0) + (R() * 2 - 1) * j) });
  }
  let segs = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 1; c++) segs.push({ a: r * COLS + c, b: r * COLS + c + 1, h: true, r, c });
  for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) {
    if (r === RIVER_ROW && !BRIDGES.includes(c)) continue;          // 강은 다리로만 건넌다
    segs.push({ a: r * COLS + c, b: (r + 1) * COLS + c, h: false, r, c, bridge: r === RIVER_ROW });
  }
  // 거리 몇 개를 막아 블록 모양을 불규칙하게 (모든 교차로는 길이 2개 이상, 전체는 이어져 있게)
  const connected = list => {
    const adj = new Map(); list.forEach(s => { (adj.get(s.a) || adj.set(s.a, []).get(s.a)).push(s.b); (adj.get(s.b) || adj.set(s.b, []).get(s.b)).push(s.a); });
    const seen = new Set([0]), q = [0];
    while (q.length) { const x = q.shift(); for (const y of adj.get(x) || []) if (!seen.has(y)) { seen.add(y); q.push(y); } }
    return seen.size === cross.length;
  };
  const order = segs.map((s, i) => i).sort(() => R() - .5);
  let removed = 0;
  for (const i of order) {
    if (removed >= 9) break;
    const s = segs[i]; if (!s || s.bridge) continue;
    const rest = segs.filter((x, k) => x && k !== i);
    const deg = id => rest.filter(x => x.a === id || x.b === id).length;
    if (deg(s.a) < 2 || deg(s.b) < 2 || !connected(rest)) continue;
    segs[i] = null; removed++;
  }
  segs = segs.filter(Boolean);
  const cx = M + (COLS - 1) * SP / 2;
  const riverY = (M + RIVER_ROW * SP + M + (RIVER_ROW + 1) * SP + RIVER_GAP) / 2;
  const locs = segs.map(s => {
    const A = cross[s.a], B = cross[s.b];
    const x = (A.x + B.x) / 2, y = (A.y + B.y) / 2;
    const quad = s.bridge ? null : (y < riverY ? 0 : 2) + (x < cx ? 0 : 1);
    const cells = [];
    if (s.h) { cells.push([s.r - 1, s.c], [s.r, s.c]); } else { cells.push([s.r, s.c - 1], [s.r, s.c]); }
    return { x: Math.round(x), y: Math.round(y), cross: [s.a, s.b], quad, h: s.h, r: s.r, c: s.c, bridge: !!s.bridge,
      cells: cells.filter(([r, c]) => r >= 0 && r < ROWS - 1 && c >= 0 && c < COLS - 1 && r !== RIVER_ROW).map(([r, c]) => r + "," + c),
      dock: s.h && (s.r === RIVER_ROW || s.r === RIVER_ROW + 1) };
  }).sort((p, q) => p.y - q.y || p.x - q.x);
  locs.forEach((l, i) => { l.id = i + 1; });
  const byId = {}; locs.forEach(l => { byId[l.id] = l; });
  const locsAt = {}; cross.forEach(c => { locsAt[c.id] = []; });
  locs.forEach(l => l.cross.forEach(x => locsAt[x].push(l.id)));
  const crossAdj = {}; cross.forEach(c => { crossAdj[c.id] = []; });
  segs.forEach(s => { crossAdj[s.a].push(s.b); crossAdj[s.b].push(s.a); });
  const starts = [[1, 2], [1, 3], [2, 0], [2, 5], [4, 0], [4, 5], [5, 2], [5, 3]].map(([r, c]) => r * COLS + c);
  return { W, H, cross, segs, locs, byId, locsAt, crossAdj, starts, riverY, cx, quadName: ["북서쪽", "북동쪽", "남서쪽", "남동쪽"] };
})();

/* ───── movement helpers ───── */
// 한 칸 걷기: 같은 교차로에서 만나는 장소로. 그 교차로에 수사관이 있으면 못 지나간다.
function walkFrom(loc, police, ignorePolice) {
  const out = new Set();
  for (const x of MAP.byId[loc].cross) {
    if (!ignorePolice && police && police.includes(x)) continue;
    for (const l of MAP.locsAt[x]) if (l !== loc) out.add(l);
  }
  return [...out];
}
const alleyFrom = loc => { const cs = new Set(MAP.byId[loc].cells); return MAP.locs.filter(l => l.id !== loc && l.cells.some(c => cs.has(c))).map(l => l.id); };
const boatFrom = loc => MAP.byId[loc].dock ? MAP.locs.filter(l => l.dock && l.id !== loc).map(l => l.id) : [];
function coachVias(g) { return walkFrom(g.jpos, g.police, true); }
function coachTo(g, via) { return walkFrom(via, g.police, true).filter(l => l !== g.jpos); }
function policeReach(g, p) {
  const from = g.police[p], seen = new Map([[from, 0]]), q = [from];
  while (q.length) { const x = q.shift(); const d = seen.get(x); if (d === 2) continue; for (const y of MAP.crossAdj[x]) if (!seen.has(y)) { seen.set(y, d + 1); q.push(y); } }
  return [...seen.keys()].filter(x => x !== from && !g.police.includes(x));
}
const nearLocs = x => MAP.locsAt[x].slice();
function jackOptions(g) {
  return {
    walk: walkFrom(g.jpos, g.police),
    coach: g.tiles.coach > 0 && g.track.length <= 13 ? coachVias(g).filter(v => coachTo(g, v).length) : [],
    alley: g.tiles.alley > 0 ? alleyFrom(g.jpos) : [],
    boat: g.tiles.boat > 0 ? boatFrom(g.jpos) : [],
  };
}
const canJackMove = g => { const o = jackOptions(g); return o.walk.length || o.coach.length || o.alley.length || o.boat.length; };

/* ───── game ───── */
const LIMIT = 15;
const PN = ["노랑", "파랑", "빨강"];
function setup(jack) {
  return {
    jack, phase: "setup", ready: { jack: false, police: false },
    targets: null, police: null, jpos: null, path: [], track: [], round: 0, found: [], left: [],
    tiles: { coach: 2, alley: 2, boat: 2 },
    moved: [false, false, false], acted: [null, null, null], asked: [[], [], []], clues: [], empty: [],
    winner: null, why: "", log: [], last: null,
  };
}
function beginRound(g, at) {
  g.round += 1; g.jpos = at; g.path = [at]; g.track = []; g.clues = []; g.empty = [];
  g.found.push(at); g.left = g.left.filter(x => x !== at);
  g.log.push(`${g.found.length}번째 희생자가 ${at}번에서 발견됐어요`);
}
function afterJack(g, N) {
  if (g.left.includes(g.jpos)) {
    beginRound(g, g.jpos);
    if (!g.left.length) { g.phase = "over"; g.winner = "jack"; g.why = "잭이 네 곳을 모두 지나갔어요"; return g; }
  } else if (g.track.length >= LIMIT) {
    g.phase = "over"; g.winner = "police"; g.why = `잭이 ${LIMIT}번 안에 다음 장소에 닿지 못했어요`; return g;
  }
  g.phase = "pmove"; g.moved = [false, false, false];
  return g;
}
function startPoliceActions(g) { g.phase = "pact"; g.acted = [null, null, null]; g.asked = [[], [], []]; return g; }
const curPiece = g => g.acted.findIndex(a => a !== "done");
function finishPoliceIfDone(g) {
  if (curPiece(g) < 0) {
    g.phase = "jack";
    if (!canJackMove(g)) { g.phase = "over"; g.winner = "police"; g.why = "잭이 갈 곳이 없어 갇혔어요"; }
  }
  return g;
}

function apply(g, seat, a, N) {
  if (g.phase === "over") return null;
  const isJack = seat === g.jack, jn = N[g.jack], pnm = N[1 - g.jack];
  if (g.phase === "setup") {
    if (a.type === "targets" && isJack && !g.ready.jack) {
      const t = a.locs;
      if (!Array.isArray(t) || t.length !== 4 || new Set(t).size !== 4) return null;
      const quads = t.map(id => MAP.byId[id] && MAP.byId[id].quad);
      if (quads.some(q => q == null) || new Set(quads).size !== 4 || !t.includes(a.start)) return null;
      g.targets = t.slice(); g.start = a.start; g.left = t.slice(); g.ready.jack = true;
    } else if (a.type === "place" && !isJack && !g.ready.police) {
      const at = a.at;
      if (!Array.isArray(at) || at.length !== 3 || new Set(at).size !== 3 || at.some(x => !MAP.starts.includes(x))) return null;
      g.police = at.slice(); g.ready.police = true;
    } else return null;
    if (g.ready.jack && g.ready.police) {
      g.log.push(`밤이 시작됐어요. ${pnm} 님의 수사관들이 자리를 잡았어요`);
      beginRound(g, g.start);
      g.phase = "jack";
    }
    return g;
  }
  if (g.phase === "jack") {
    if (!isJack) return null;
    if (a.type === "stuck") { if (canJackMove(g)) return null; g.phase = "over"; g.winner = "police"; g.why = "잭이 갈 곳이 없어 갇혔어요"; return g; }
    const o = jackOptions(g);
    if (a.type === "walk") { if (!o.walk.includes(a.to)) return null; g.jpos = a.to; g.path.push(a.to); g.track.push("walk"); }
    else if (a.type === "coach") {
      if (!o.coach.includes(a.via) || !coachTo(g, a.via).includes(a.to)) return null;
      g.tiles.coach--; g.jpos = a.to; g.path.push(a.via, a.to); g.track.push("coach", "coach");
      g.log.push(`${jn} 님(잭)이 마차를 탔어요 (두 칸)`);
    } else if (a.type === "alley") {
      if (!o.alley.includes(a.to)) return null;
      g.tiles.alley--; g.jpos = a.to; g.path.push(a.to); g.track.push("alley");
      g.log.push(`${jn} 님(잭)이 골목길로 빠져나갔어요`);
    } else if (a.type === "boat") {
      if (!o.boat.includes(a.to)) return null;
      g.tiles.boat--; g.jpos = a.to; g.path.push(a.to); g.track.push("boat");
      g.log.push(`${jn} 님(잭)이 배를 탔어요`);
    } else return null;
    g.last = { type: "jack", n: g.track.length };
    return afterJack(g, N);
  }
  if (isJack) return null;
  if (g.phase === "pmove") {
    if (a.type === "pmove") {
      if (!(a.p >= 0 && a.p < 3) || g.moved[a.p] || !policeReach(g, a.p).includes(a.to)) return null;
      g.police[a.p] = a.to; g.moved[a.p] = true;
      if (g.moved.every(Boolean)) startPoliceActions(g);
      return g;
    }
    if (a.type === "pdone") return startPoliceActions(g);
    return null;
  }
  if (g.phase === "pact") {
    const p = curPiece(g);
    if (a.p !== p) return null;
    const near = nearLocs(g.police[p]);
    if (a.type === "search") {
      if (g.acted[p] === "arrest" || !near.includes(a.loc) || g.asked[p].includes(a.loc)) return null;
      g.asked[p].push(a.loc); g.acted[p] = "search";
      if (g.path.includes(a.loc)) {
        if (!g.clues.includes(a.loc)) g.clues.push(a.loc);
        g.acted[p] = "done";
        g.log.push(`${PN[p]} 수사관이 ${a.loc}번에서 단서를 찾았어요!`);
        g.last = { type: "clue", loc: a.loc, p };
      } else {
        if (!g.empty.includes(a.loc)) g.empty.push(a.loc);
        g.last = { type: "empty", loc: a.loc, p };
        if (near.every(l => g.asked[p].includes(l))) g.acted[p] = "done";
      }
      return finishPoliceIfDone(g);
    }
    if (a.type === "arrest") {
      if (g.acted[p] != null || !near.includes(a.loc)) return null;
      if (a.loc === g.jpos) { g.phase = "over"; g.winner = "police"; g.why = `${PN[p]} 수사관이 ${a.loc}번에서 잭을 체포했어요`; g.log.push(g.why); return g; }
      g.acted[p] = "done"; g.last = { type: "miss", loc: a.loc, p };
      g.log.push(`${PN[p]} 수사관이 ${a.loc}번을 덮쳤지만 아무도 없었어요`);
      return finishPoliceIfDone(g);
    }
    if (a.type === "pass") { g.acted[p] = "done"; return finishPoliceIfDone(g); }
  }
  return null;
}

const api = { MAP, LIMIT, PN, setup, apply, jackOptions, coachTo, policeReach, nearLocs, curPiece, canJackMove, walkFrom };
if (typeof module !== "undefined" && module.exports) module.exports = api; else root.WHE = api;
})(typeof window !== "undefined" ? window : globalThis);
