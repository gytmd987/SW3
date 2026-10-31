/* Duo — shared shell for the two-player games on this site.
 *
 * A game page calls Duo(game) with:
 *   id, title, mark (hero HTML), tagline, rules (HTML)
 *   options       [{id, label, choices:[{v, label}], def}]  lobby settings
 *   setup(players, opts, env) -> g            env = {prev}
 *   apply(g, seat, action, env) -> g | null   pure move reducer; null = illegal
 *   render(ctx) -> HTML                       the table
 *   onClick(el, ctx)                          for elements with data-a="…"
 *   mounted(root, ctx) (optional)             after each render (drag & drop etc.)
 *   holdRender() -> bool (optional)           true while a drag is in progress; redraws wait
 *                                             until the game calls ctx.flush()
 *   changed(prev, g, ctx) (optional)          after a new state arrives (animations)
 *   result(g, ctx) -> {title, html} | null    game over summary
 *   solo (optional)                           true = the lobby offers "혼자 연습"; setup gets env.solo,
 *                                             the game runs on this phone only with one player
 *
 * Online play: there is one table per game. Whoever opens the game first holds the table
 * (the "host"); the other page joins it automatically. The guest sends its moves as
 * actions; the host applies them and sends back the whole state. Both keep the state in
 * localStorage, so if the host leaves, the other page takes the table over and the game
 * goes on.
 */
(function () {
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const rnd = n => { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; } catch (e) { return Math.floor(Math.random() * n); } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
// 받침 여부로 조사 고르기: josa("지우","이","가") → "지우가"
const josa = (w, a, b) => { w = String(w); const ch = w.charCodeAt(w.length - 1); if (ch < 0xac00 || ch > 0xd7a3) return w + a; return w + (((ch - 0xac00) % 28) ? a : b); };
let toastTimer;
function toast(msg) {
  let t = $(".duo-toast");
  if (!t) { t = document.createElement("div"); t.className = "duo-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2600);
}
window.DuoUtil = { $, esc, clone, rnd, shuffle, store, josa, toast };

const params = new URLSearchParams(location.search);

window.Duo = function (game) {
  const K = k => "duo-" + game.id + "-" + k;
  const defaults = {};
  (game.options || []).forEach(o => { defaults[o.id] = o.def; });

  const ui = {
    name: store.get("duo-name", "") || store.get("hanabi-name", ""),
    myId: (() => { let id = store.get("hanabi-id", null); if (!id) { id = "p" + Date.now().toString(36) + rnd(1e9).toString(36); store.set("hanabi-id", id); } return id; })(),
    net: window.RTCPeerConnection ? "peer" : null,
    room: null, isHost: false, peer: null, conn: null, peerStatus: "idle", guestId: null,
    pending: [], aid: 0, lastAid: 0, lastRx: 0, peerAway: false, tries: 0,
    inSolo: false, solo: game.solo ? store.get(K("solo"), null) : null,
    online: null,
    sheet: null, armed: null, error: "",
    opts: Object.assign({}, defaults, store.get(K("opts"), {})),
    g: {},                          // per-game transient UI state (selection etc.)
  };

  /* ───── state helpers ───── */
  const current = () => (ui.inSolo ? ui.solo : ui.online);
  const names = s => (s && s.players ? s.players.map(p => p.name) : ["", ""]);
  function mySeat(s) {
    if (!s || !s.players) return -1;
    return s.players.findIndex(p => p.id === ui.myId);
  }
  function env(s) { return { players: s ? s.players : [], names: names(s) }; }

  const saveState = () => { if (ui.room) store.set(K("room-main"), ui.online); };
  function setState(next) {
    const prev = current();
    ui.online = next; saveState();
    sendSync();
    afterChange(prev, next);
  }
  function afterChange(prev, next) {
    if (ui.sheet && ui.sheet.kind === "game" && prev && next && prev.seq !== next.seq && !ui.sheet.keep) ui.sheet = null;
    render();
    if (next !== current()) return;                    // 혼자 연습 중에 온 온라인 상태 → 애니메이션은 생략
    if (game.changed && prev && next && prev.game && next.game && prev.seq !== next.seq && next.status === "playing") {
      try { game.changed(prev.game, next.game, ctxFor(next)); } catch (e) { console.error(e); }
    }
  }

  /* moves
   손님의 행동은 번호(aid)를 붙여 방장에게 보내고, 방장이 "aid까지 받았다(ack)"고 알려 줄 때까지
   2초마다 다시 보낸다. 방장은 이미 처리한 번호는 다시 처리하지 않는다. 메시지가 중간에
   사라져도 결국 한 번만 반영된다. */
  function act(action) {
    const s = current();
    if (!s || s.status !== "playing") return false;
    const seat = mySeat(s);
    if (seat < 0) return false;
    let g2 = null;
    try { g2 = game.apply(clone(s.game), seat, action, env(s)); } catch (e) { console.error(e); }
    if (!g2) return false;
    if (ui.inSolo) { const next = Object.assign({}, s, { game: g2, seq: s.seq + 1 }); ui.solo = next; store.set(K("solo"), next); afterChange(s, next); return true; }
    if (!ui.isHost) {
      if (!ui.conn) { toast("방장과 연결이 끊겨 있어요. 다시 연결되면 해 주세요."); return false; }
      queue({ kind: "act", action });
      // 화면에는 바로 반영하고, 방장이 보낸 상태가 오면 그걸로 맞춘다
      const next = Object.assign({}, s, { game: g2, seq: s.seq + 1 });
      ui.online = next; saveState(); afterChange(s, next);
    } else setState(Object.assign({}, s, { game: g2, seq: s.seq + 1 }));
    return true;
  }
  function hostApply(seat, action) {
    const s = ui.online;
    let g2 = null;
    if (s && s.status === "playing" && seat >= 0) { try { g2 = game.apply(clone(s.game), seat, action, env(s)); } catch (e) { console.error(e); } }
    if (g2) setState(Object.assign({}, s, { game: g2, seq: s.seq + 1 }));
    else sendSync();                                   // 받아들일 수 없는 행동이면 지금 상태로 되돌려 준다
  }

  /* lobby commands: start / again / lobby / opts */
  function command(cmd, arg) {
    if (ui.inSolo) { soloCommand(cmd); return; }
    if (!ui.isHost) { if (!ui.conn) { toast("방장과 연결이 끊겨 있어요"); return; } queue({ kind: "cmd", cmd, arg }); return; }
    runCommand(cmd, arg);
  }
  function runCommand(cmd, arg) {
    const s = current();
    if (!s) return;
    const n = clone(s);
    n.seq = s.seq + 1;
    if (cmd === "start" || cmd === "again") {
      if (!n.players || n.players.length < 2) { sendSync(); return; }
      n.status = "playing";
      n.game = game.setup(n.players, n.opts || ui.opts, { prev: cmd === "again" ? s.game : null });
      ui.g = {};
    } else if (cmd === "lobby") { n.status = "lobby"; n.game = null; }
    else if (cmd === "opts") { if (n.status !== "lobby") return; n.opts = Object.assign({}, n.opts, arg); }
    else { sendSync(); return; }
    ui.sheet = null;
    setState(n);
  }

  /* ───── one table per game over PeerJS ─────
     자리 이름은 하나가 아니라 SLOTS개(…-0, …-1, …)예요. 페이지는 비어 있는 가장 낮은 자리를 잡고,
     자기보다 낮은 자리 중 이미 차 있던 곳에 전부 연결을 걸어 봐요. 받는 쪽(낮은 자리)이 방장,
     건 쪽이 손님이 돼요.
     예전처럼 이름이 하나뿐이면, 폰이 화면 꺼짐·앱 전환으로 깔끔하게 나가지 못했을 때 서버에
     그 이름이 1분 넘게 "유령"으로 남아서 두 폰 모두 유령에게 연결을 걸며 기다리기만 했어요.
     이제 유령은 자리 하나만 차지할 뿐이고, 진짜 상대는 다른 자리에서 바로 찾아요. */
  const BASE = "gytmd987-sw3-" + game.id + (params.get("table") ? "-" + params.get("table").replace(/[^a-z0-9]/gi, "") : "");
  const SLOTS = 5;
  const slotId = k => BASE + "-" + k;
  const ROOM = "main";
  const RK = k => K("room-" + ROOM + (k ? "-" + k : ""));
  function peerOptions() {
    const o = { debug: 0, config: { iceServers: [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
      { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
    ] } };
    const ps = params.get("peerserver");
    if (ps) { const [host, port] = ps.split(":"); Object.assign(o, { host, port: +port || 443, path: "/", secure: !/^localhost$|^127\./.test(host) }); }
    return o;
  }
  function loadPeerLib() {
    if (window.Peer) return Promise.resolve();
    const tryLoad = src => new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
    return tryLoad("../vendor/peerjs.min.js").catch(() => tryLoad("https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js"));
  }
  let retryTimer = null;
  const retry = ms => { clearTimeout(retryTimer); retryTimer = setTimeout(() => { retryTimer = null; if (ui.room) claim(); }, ms + rnd(500)); };
  function lobbyState() { return { v: 1, status: "lobby", players: [{ id: ui.myId, name: ui.name }], opts: Object.assign({}, ui.opts), seq: 1, game: null }; }

  async function join() {
    ui.room = ROOM; ui.error = "";
    ui.online = store.get(RK(), null);
    ui.peerStatus = "opening"; render();
    try { await loadPeerLib(); } catch (e) { ui.peerStatus = "error"; ui.error = "연결 모듈을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요."; render(); return; }
    claim();
  }
  function becomeHost() {
    ui.isHost = true; ui.roled = true;
    ui.pending = []; store.set(RK("pend"), []);                 // 내 행동은 이미 내 상태에 들어 있다
    ui.lastAid = store.get(RK("last"), 0);
    ui.lastEp = store.get(RK("lastep"), null);
    let st = store.get(RK(), null) || ui.online;
    if (!st) st = lobbyState();
    if (st.status !== "playing") {                           // 대기 화면이면 자리를 나부터 다시 채운다
      st = clone(st); st.players = [{ id: ui.myId, name: ui.name }]; st.seq += 1;
    }
    ui.online = st; saveState();
    if (!ui.conn) ui.peerStatus = "waiting";
    render();
  }
  function becomeGuest() {
    ui.isHost = false; ui.roled = true;
    ui.pending = store.get(RK("pend"), []);
    ui.aid = store.get(RK("aid"), 0);
    ui.ep = store.get(RK("myep"), null);
    if (!ui.ep) { ui.ep = "e" + Date.now().toString(36) + rnd(1e6).toString(36); store.set(RK("myep"), ui.ep); store.set(RK("aid"), 0); ui.aid = 0; }
  }
  // 버린 연결은 표시를 해 두고 닫는다. 표시가 없으면 닫는 도중 "disconnected"가 와서 다시 붙어 버리고,
  // 그게 자리 이름을 계속 쥐고 있게 된다.
  function killPeer(p) { if (!p) return; p._dead = true; try { p.destroy(); } catch (e) {} }
  const dbg = params.get("debug") ? (...a) => console.log("[duo]", ...a) : () => {};
  window.__duoIds = () => ({ slot: ui.slot, below: ui.below, host: ui.isHost, status: ui.peerStatus, disc: ui.peer && ui.peer.disconnected, open: ui.peer && ui.peer.open, dials: (ui.dials || []).length });

  // 모든 자리를 한꺼번에 잡아 보고, 잡힌 것 중 가장 낮은 자리 하나만 남긴다
  function claim() {
    if (!ui.room) return;
    clearTimeout(retryTimer); retryTimer = null;
    const gen = ui.gen = (ui.gen || 0) + 1;
    killPeer(ui.peer); ui.peer = null;
    (ui.dials || []).forEach(c => { try { c.close(); } catch (e) {} }); ui.dials = [];
    if (ui.conn) dropConn();
    ui.peerAway = false; ui.slot = -1; ui.below = [];
    if (ui.peerStatus !== "error") { ui.peerStatus = "opening"; render(); }
    dbg("claim");
    const res = [], peers = [];
    let chosen = false;
    const settle = () => {
      if (chosen || gen !== ui.gen) return;
      for (let k = 0; k < SLOTS; k++) {
        if (res[k] === undefined) return;                  // 아래 자리 결과를 아직 몰라요
        if (res[k] === "open") {
          chosen = true;
          peers.forEach((p, j) => { if (j !== k) killPeer(p); });
          usePeer(peers[k], k, res.map((r, j) => (j < k && r === "taken" ? j : -1)).filter(j => j >= 0));
          return;
        }
      }
      if (res.some(r => r === "taken")) { chosen = true; peers.forEach(killPeer); ui.peerStatus = "lost"; render(); retry(2500); return; }   // 자리가 다 찼어요
      chosen = true; peers.forEach(killPeer); ui.peerStatus = "lost"; render(); retry(3000);   // 서버에 못 붙었어요
    };
    // 서버가 끝내 대답이 없으면 처음부터 다시
    setTimeout(() => { if (!chosen && gen === ui.gen) { chosen = true; peers.forEach(killPeer); ui.peerStatus = "lost"; render(); retry(1000); } }, 12000);
    for (let k = 0; k < SLOTS; k++) {
      let p;
      try { p = new Peer(slotId(k), peerOptions()); } catch (e) { ui.peerStatus = "error"; ui.error = "이 브라우저는 온라인 연결을 지원하지 않아요. 크롬이나 사파리로 열어 주세요."; render(); return; }
      peers[k] = p;
      p.on("open", () => {
        if (p._used) { ui.discSince = 0; dbg("server again"); if (!ui.conn) dial(); return; }   // 쓰던 자리가 서버에 다시 붙었어요
        if (gen !== ui.gen || chosen) { killPeer(p); return; }
        res[k] = "open"; settle();
      });
      p.on("error", err => {
        if (p._used) return;                                 // 고른 뒤의 오류는 usePeer가 처리
        if (gen !== ui.gen) { killPeer(p); return; }
        const t = err && err.type;
        if (t === "browser-incompatible") { ui.peerStatus = "error"; ui.error = "이 브라우저는 온라인 연결을 지원하지 않아요. 크롬이나 사파리로 열어 주세요."; render(); return; }
        if (res[k] === undefined) { res[k] = t === "unavailable-id" ? "taken" : "fail"; killPeer(p); settle(); }
      });
    }
  }
  function usePeer(peer, k, below) {
    peer._used = true;
    ui.peer = peer; ui.slot = k; ui.below = below; ui.peerT = Date.now(); ui.tries = 0; ui.discSince = 0;
    dbg("slot", k, "below", below);
    peer.on("connection", conn => { if (ui.peer === peer) attach(conn, true); });
    // 중개 서버와 끊김(폰 화면이 꺼졌다 켜질 때 흔함) → 같은 이름으로 다시 붙는다
    peer.on("disconnected", () => {
      if (ui.peer !== peer || peer._dead || peer.destroyed) return;
      const now = Date.now(); ui.discSince = ui.discSince || now;
      if (now - (ui.reT || 0) > 2000) { ui.reT = now; try { peer.reconnect(); } catch (e) {} }   // 너무 잦으면 1.5초 점검에 맡겨요
    });
    peer.on("error", err => {
      if (ui.peer !== peer) return;
      const t = err && err.type;
      dbg("error", t, err && err.message);
      if (t === "peer-unavailable") {                          // 건 자리에 아무도 없어요 → 다음 점검 때 다시 걸어요
        const m = /(\d+)\s*$/.exec(String(err.message || "")); const j = m ? +m[1] : -1;
        ui.dials = (ui.dials || []).filter(c => { if (c._slot === j && !c._opened) { try { c.close(); } catch (e) {} return false; } return true; });
      } else if (t === "unavailable-id") retry(300);           // 다시 붙는 사이에 내 자리를 남이 가져갔어요 → 자리를 새로 잡아요
      else if (!ui.conn && (peer.destroyed || t === "server-error" || t === "socket-error" || t === "socket-closed")) { ui.peerStatus = "lost"; render(); retry(2500); }
    });
    if (below.length) { if (!ui.roled) becomeGuest(); ui.peerStatus = ui.isHost ? "waiting" : "connecting"; render(); dial(); }
    else if (!ui.roled || !ui.isHost) becomeHost();
    else { if (!ui.conn) ui.peerStatus = "waiting"; render(); }
  }
  // 나보다 낮은 자리(먼저 와 있던 쪽)에 연결을 건다. 이미 걸어 둔 곳은 건너뛴다.
  function dial() {
    const peer = ui.peer;
    if (!peer || peer.destroyed || peer.disconnected || ui.conn) return;
    ui.dials = (ui.dials || []).filter(c => !c._dropped);
    let any = false;
    ui.below.forEach(j => {
      if (ui.dials.some(c => c._slot === j)) return;
      let conn; try { conn = peer.connect(slotId(j), { reliable: true, serialization: "json" }); } catch (e) { return; }
      if (!conn) return;
      conn._slot = j; ui.dials.push(conn); any = true;
      attach(conn, false);
      setTimeout(() => { if (!conn._opened) { conn._dropped = true; try { conn.close(); } catch (e) {} } }, 8000);   // 유령 자리는 대답이 없어요
    });
    if (any) { ui.tries += 1; ui.lastDial = Date.now(); if (!ui.isHost) { ui.peerStatus = "connecting"; paintConn(); } }
  }
  function attach(conn, incoming) {
    conn.on("open", () => {
      if (ui.peer && conn.provider && conn.provider !== ui.peer) { try { conn.close(); } catch (e) {} return; }
      conn._opened = true;
      if (ui.conn && ui.conn !== conn) { const old = ui.conn; ui.conn = null; try { old.close(); } catch (e) {} }   // 새 연결이 이겨요 (상대가 새로고침한 경우)
      (ui.dials || []).forEach(c => { if (c !== conn) { c._dropped = true; try { c.close(); } catch (e) {} } }); ui.dials = [];
      if (incoming && !ui.isHost) becomeHost();
      else if (!incoming && (ui.isHost || !ui.roled)) becomeGuest();
      ui.conn = conn; ui.peerStatus = "connected"; ui.error = ""; ui.lastRx = Date.now(); ui.peerAway = false; ui.tries = 0;
      dbg("connected", incoming ? "in (host)" : "out (guest)");
      send({ t: "hello", id: ui.myId, name: ui.name, state: ui.online, seq: seqOf() });
      if (!ui.isHost) flushPending();
      render();
    });
    conn.on("data", m => {
      if (window.__duoStall || ui.conn !== conn) return;
      ui.lastRx = Date.now();
      if (m && m.t === "bye") {                                       // 상대가 페이지를 닫았다 → 기다리지 않고 바로 정리
        try { conn.close(); } catch (e) {} gone();
        if (!ui.isHost) becomeHost();                                 // 방장이 나갔으니 내가 판을 맡아요
        return;
      }
      const away = !!(m && (m.t === "away" || m.away));
      if (away !== ui.peerAway) { ui.peerAway = away; paintConn(); }
      if (!away) onMsg(m);
    });
    const gone = () => {
      if (ui.conn !== conn) return;
      ui.conn = null; ui.peerAway = false; ui.peerStatus = ui.isHost ? "waiting" : "lost"; render();
      setTimeout(dial, 300 + rnd(400));                         // 낮은 자리 쪽이면 바로 다시 걸어 봐요
    };
    conn.on("close", gone); conn.on("error", gone);
    conn._gone = gone;
  }
  const DROP = +(params.get("droptest") || 0);          // 시험용: 메시지를 일부러 이 비율만큼 버린다
  function send(m) {
    if ((DROP && Math.random() < DROP) || window.__duoStall) return false;
    if (document.hidden) m = Object.assign({ away: 1 }, m);      // 다른 앱에 가 있는 동안 보내는 건 "자리 비움" 표시를 달아요
    try { if (ui.conn && ui.conn.open) { ui.conn.send(m); return true; } } catch (e) {}
    return false;
  }
  const seqOf = () => (ui.online ? ui.online.seq : 0);

  /* 손님 쪽: 아직 방장이 확인하지 않은 행동 */
  const pendKey = () => RK("pend");
  function queue(item) {
    ui.aid = (ui.aid || store.get(RK("aid"), 0)) + 1;
    store.set(RK("aid"), ui.aid);
    item.aid = ui.aid;
    ui.pending.push(item); store.set(pendKey(), ui.pending);
    sendItem(item);
  }
  // ep: 이 손님 브라우저의 번호 묶음. 손님이 기록을 잃고 번호를 1부터 다시 세면 방장도 처음부터 센다.
  function sendItem(it) { send(it.kind === "act" ? { t: "act", ep: ui.ep, aid: it.aid, action: it.action } : { t: "cmd", ep: ui.ep, aid: it.aid, cmd: it.cmd, arg: it.arg }); }
  function flushPending() { ui.pending.forEach(sendItem); }
  function prune(ack) {
    if (typeof ack !== "number") return;
    const before = ui.pending.length;
    ui.pending = ui.pending.filter(it => it.aid > ack);
    if (ui.pending.length !== before) store.set(pendKey(), ui.pending);
  }

  /* 방장 쪽: 손님 행동을 어디까지 처리했는지 */
  const lastKey = () => RK("last");
  function sendSync() { send({ t: "sync", state: ui.online, ack: ui.lastAid || 0 }); }

  function adopt(st) {
    // 손님만 쓴다: 방장 상태가 기준이다. 아직 확인 안 된 내 행동이 있으면 그게 반영된 상태를 기다린다.
    if (!st || typeof st !== "object" || typeof st.seq !== "number") return false;
    if (ui.pending.length) return false;
    const cur = ui.online;
    if (cur && JSON.stringify(st) === JSON.stringify(cur)) return false;
    ui.online = clone(st); saveState();
    afterChange(cur, ui.online);
    return true;
  }
  function onMsg(m) {
    if (!m || typeof m !== "object") return;
    if (ui.isHost) {
      if (m.t === "hello") {
        // 상대가 그동안 자리를 잡고 게임을 이어 갔다면 그쪽 상태가 더 새것이다
        if (m.state && typeof m.state.seq === "number" && m.state.status === "playing" && (!ui.online || m.state.seq > ui.online.seq)) {
          ui.online = clone(m.state); saveState();
        }
        let s = ui.online ? clone(ui.online) : lobbyState();
        const name = String(m.name || "상대").slice(0, 12);
        ui.guestId = String(m.id);
        const i = s.players.findIndex(p => p.id === m.id);
        if (s.status !== "playing") {
          const want = [s.players.find(p => p.id === ui.myId) || { id: ui.myId, name: ui.name }, { id: String(m.id), name }];
          if (JSON.stringify(want) !== JSON.stringify(s.players)) { s.players = want; s.seq += 1; }
        } else if (i < 0) { send({ t: "full", seq: s.seq }); sendSync(); return; }
        const prev = ui.online; ui.online = s; saveState();
        sendSync(); afterChange(prev, s);
      } else if (m.t === "act" || m.t === "cmd") {
        if (m.ep && m.ep !== ui.lastEp) { ui.lastEp = m.ep; ui.lastAid = 0; store.set(RK("lastep"), m.ep); }
        if (typeof m.aid !== "number" || m.aid <= (ui.lastAid || 0)) { sendSync(); return; }   // 이미 처리한 것
        ui.lastAid = m.aid; store.set(lastKey(), ui.lastAid);
        if (m.t === "act") hostApply(ui.online ? ui.online.players.findIndex(p => p.id === ui.guestId) : -1, m.action);
        else if (m.cmd === "reset") { const n = clone(ui.online || lobbyState()); n.status = "lobby"; n.game = null; n.players = [{ id: ui.myId, name: ui.name }, { id: ui.guestId, name: String(m.arg || "상대").slice(0, 12) }]; n.seq += 1; setState(n); }
        else runCommand(m.cmd, m.arg);
      } else if (m.t === "ping") {
        if (m.seq !== seqOf()) sendSync();
      }
    } else {
      if (m.t === "sync") { prune(m.ack); adopt(m.state); }
      else if (m.t === "ping") { prune(m.ack); if (!ui.pending.length && m.seq !== seqOf()) send({ t: "need" }); }
      else if (m.t === "full") { ui.peerStatus = "full"; render(); }
    }
    if (ui.isHost && m.t === "need") sendSync();
  }

  /* 1.5초마다: 서로 상태 번호 확인, 못 받은 행동 다시 보내기, 응답이 끊긴 연결 정리, 중개 서버 연결 점검 */
  const DEAD = 7000;
  function dropConn() { const c = ui.conn; if (!c) return; try { c.close(); } catch (e) {} if (c._gone) c._gone(); }
  setInterval(() => {
    if (!ui.room) return;
    const peer = ui.peer, now = Date.now();
    if (peer && !retryTimer && !peer._dead) {
      if (peer.destroyed) { if (!ui.conn) claim(); }
      else if (peer.disconnected) {
        ui.discSince = ui.discSince || now;
        if (now - ui.discSince > 10000 && !ui.conn) { dbg("server gone too long → claim again"); claim(); }   // 오래 못 붙으면 자리부터 새로
        else if (now - (ui.reT || 0) > 3000) { ui.reT = now; try { peer.reconnect(); } catch (e) {} }
      } else ui.discSince = 0;
    }
    if (!peer && !retryTimer && ui.peerStatus !== "opening" && ui.peerStatus !== "error") claim();
    if (!ui.conn) {
      if (peer && ui.below && ui.below.length) {
        dial();
        // 아래 자리들이 오래 대답이 없으면(유령뿐이면) 일단 내가 판을 맡고, 걸기는 계속해요
        if (!ui.isHost && now - (ui.peerT || 0) > 9000) becomeHost();
      }
      paintConn(); return;
    }
    if (now - (ui.lastRx || 0) > DEAD) { dropConn(); return; }
    if (ui.isHost) send({ t: "ping", seq: seqOf(), ack: ui.lastAid || 0 });
    else {
      if (!ui.online || mySeat(ui.online) < 0) send({ t: "hello", id: ui.myId, name: ui.name, state: ui.online, seq: seqOf() });   // 아직 자리에 안 들어갔으면 인사 다시
      flushPending(); send({ t: "ping", seq: seqOf() });
    }
    paintConn();
  }, 1500);
  // 다른 앱(카톡 등)에 갔다가 돌아오거나, 사파리가 뒤로 가기로 페이지를 되살리면 바로 다시 맞춘다
  const resume = () => {
    if (!ui.room) return;
    if (document.hidden) { send({ t: "away" }); return; }      // 잠깐 자리 비움을 상대에게 알려요
    const peer = ui.peer;
    if (!peer || peer.destroyed) { if (!retryTimer) claim(); return; }
    if (peer.disconnected) { ui.reT = Date.now(); try { peer.reconnect(); } catch (e) {} }
    if (ui.conn && Date.now() - (ui.lastRx || 0) > 5000) dropConn();
    if (!ui.conn) { dial(); return; }
    if (ui.isHost) sendSync(); else { flushPending(); send({ t: "ping", seq: seqOf() }); }
  };
  document.addEventListener("visibilitychange", resume);
  // 페이지를 떠날 때: 상대에게 알리고 자리를 바로 돌려줘요 (안 그러면 서버에 유령으로 남아요)
  window.addEventListener("pagehide", () => { if (!ui.room) return; send({ t: "bye" }); killPeer(ui.peer); ui.peer = null; ui.conn = null; });
  window.addEventListener("pageshow", e => { if (e.persisted && ui.room) { ui.lastRx = 0; claim(); } });
  // 연결 버튼의 "다시 연결하기": 처음부터 자리 잡기를 다시 해요
  function reconnectNow() {
    if (!ui.room) return;
    ui.tries = 0;
    claim();
  }

  /* ───── rendering ───── */
  function connInfo() {
    const st = ui.peerStatus, ago = ui.conn ? Date.now() - (ui.lastRx || 0) : 0;
    if (st === "connected" && ui.conn) {
      if (ui.peerAway) return { cls: "away", txt: "상대 자리 비움", why: "상대가 다른 앱이나 홈 화면에 가 있어요. 돌아오면 바로 이어져요." };
      if (ago > 3500) return { cls: "slow", txt: "응답 느림", why: `상대 폰에서 ${Math.round(ago / 1000)}초째 소식이 없어요. 7초가 넘으면 다시 연결해요.` };
      return { cls: "ok", txt: "연결됨", why: "상대와 잘 연결돼 있어요." };
    }
    if (st === "waiting") return { cls: "", txt: "상대 기다리는 중", why: "이 폰이 판을 열어 두고 상대를 기다려요. 상대 폰에서 이 게임을 열면 자동으로 붙어요." };
    if (st === "connecting") return { cls: "", txt: ui.tries > 1 ? `연결 중 (${ui.tries})` : "연결 중", why: "상대 폰이 연 판에 붙는 중이에요." };
    if (st === "lost") return { cls: "bad", txt: "다시 연결 중", why: "연결이 끊겨서 다시 붙는 중이에요." };
    if (st === "full") return { cls: "bad", txt: "방이 가득 찼어요", why: "상대 폰에서 다른 사람과 하던 판이 진행 중이에요." };
    if (st === "error") return { cls: "bad", txt: "연결 안 됨", why: ui.error || "연결할 수 없어요." };
    return { cls: "", txt: "준비 중", why: "연결 서버에 접속하는 중이에요." };
  }
  const connPill = () => {
    if (!ui.room) return "";
    const c = connInfo();
    return `<button class="duo-conn ${c.cls}" data-duo="conn" role="status" aria-label="연결 상태: ${c.txt}">${c.txt}</button>`;
  };
  // 1.5초 점검 때 연결 표시만 살짝 고쳐요 (화면 전체를 다시 그리지 않음)
  function paintConn() {
    if (ui.inSolo) return;
    const el = $(".duo-conn[data-duo=conn]"); if (!el) return;
    const c = connInfo();
    if (el.textContent !== c.txt) { el.textContent = c.txt; el.className = "duo-conn " + c.cls; el.setAttribute("aria-label", "연결 상태: " + c.txt); }
    if (ui.sheet && ui.sheet.kind === "conn") { const w = $("#duo-conn-why"); if (w && w.textContent !== c.why) w.textContent = c.why; }
  }
  const hero = () => `<a class="duo-pill" href="../" style="align-self:flex-start">← 다른 게임</a>
    <div class="duo-hero"><div class="mark">${game.mark}</div><h1>${esc(game.title)}</h1><p>${game.tagline}</p></div>`;
  const rulesBtn = `<button class="duo-btn" data-duo="rules"><b>규칙 보기</b><span>처음이라면 먼저 읽어 보세요</span></button>`;

  function optsHTML(opts, editable) {
    if (!game.options || !game.options.length) return "";
    return `<div class="duo-opts">${game.options.map(o => `<label class="duo-fld" for="opt-${o.id}">${esc(o.label)}
      <select id="opt-${o.id}" data-duo-opt="${o.id}" ${editable ? "" : "disabled"}>${o.choices.map(c => `<option value="${esc(c.v)}" ${String(opts[o.id]) === String(c.v) ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>`).join("")}</div>`;
  }
  function nameHTML() {
    return `<div class="duo-lobby">${hero()}
      <div class="duo-panel">
        <h2>이름을 알려 주세요</h2>
        <label class="duo-fld" for="name-in">내 이름<input type="text" id="name-in" maxlength="12" placeholder="예: 지우" value="${esc(ui.name)}"></label>
        <div class="duo-row"><button class="duo-btn primary" data-duo="name-save"><b>들어가기</b><span>상대도 이 게임을 열면 자동으로 같은 판에 앉아요</span></button></div>
        <p class="duo-note">이름은 이 폰에 기억돼요. 다른 게임에서도 다시 묻지 않아요.</p>
      </div>
      <div class="duo-row">${rulesBtn}</div></div>`;
  }
  function noNetHTML() {
    return `<div class="duo-lobby">${hero()}<div class="duo-panel"><h2>이 브라우저에서는 연결할 수 없어요</h2>
      <p class="duo-note">이 브라우저는 폰끼리 연결하는 기능(WebRTC)을 지원하지 않아요. 크롬이나 사파리 최신 버전으로 열어 주세요.</p></div></div>`;
  }
  function lobbyHTML(s) {
    const players = (s && s.players) || [];
    const me = players.find(p => p.id === ui.myId), other = players.find(p => p.id !== ui.myId);
    const linked = ui.peerStatus === "connected";
    const seats = `<div class="duo-seat filled"><div class="tag">나</div><div class="who">${esc(ui.name)}</div></div>
      <div class="duo-seat ${other && linked ? "filled" : ""}"><div class="tag">상대</div><div class="who">${other && linked ? esc(other.name) : "기다리는 중…"}</div></div>`;
    let action;
    if (ui.peerStatus === "full") action = `<p class="duo-note">상대 폰에서 다른 사람과 하던 판이 진행 중이에요.</p>
      <div class="duo-row"><button class="duo-btn warn" data-duo="reset" data-key="reset"><b>${ui.armed === "reset" ? "정말 그 판을 끝낼까요? 한 번 더 누르기" : "그 판 끝내고 둘이 새로 하기"}</b><span>진행 중이던 판은 사라져요</span></button></div>`;
    else if (me && other && linked) action = `<div class="duo-row"><button class="duo-btn primary" data-duo="start"><b>게임 시작</b><span>둘 다 준비됐어요</span></button></div>`;
    else action = `<p class="duo-note">${linked ? "상대 정보를 받는 중…" : "상대도 이 게임을 열면 자동으로 연결돼요."}</p>`;
    return `<div class="duo-lobby">${hero()}
      <div class="duo-panel">
        <div class="duo-head"><h2>같이 할 사람</h2>${connPill()}</div>
        <div class="duo-seats">${seats}</div>
        ${optsHTML((s && s.opts) || ui.opts, true)}
        ${action}
        ${ui.error ? `<p class="duo-err">${esc(ui.error)}</p>` : ""}
      </div>
      ${game.solo ? `<div class="duo-row">${ui.solo && ui.solo.game && ui.solo.game.phase !== "over" ? `<button class="duo-btn" data-duo="solo-resume"><b>혼자 연습 이어서</b><span>하던 연습 판으로</span></button>` : ""}
        <button class="duo-btn" data-duo="solo"><b>혼자 연습</b><span>위 설정으로 새 연습 판 · 상대가 오면 같이 할 수 있어요</span></button></div>` : ""}
      <div class="duo-row">${rulesBtn}
        <button class="duo-btn" data-duo="rename"><b>이름 바꾸기</b><span>지금: ${esc(ui.name)}</span></button></div></div>`;
  }
  /* 혼자 연습: 이 폰에서만 도는 1인 판. 온라인 연결은 뒤에서 그대로 유지돼요. */
  function soloCommand(cmd) {
    ui.sheet = null;
    if (cmd === "start" || cmd === "again") {
      const opts = Object.assign({}, (ui.online && ui.online.opts) || ui.opts);
      const prev = ui.solo;
      ui.solo = { v: 1, status: "playing", solo: true, players: [{ id: ui.myId, name: ui.name }], opts, seq: ((prev && prev.seq) || 0) + 1, game: null };
      try { ui.solo.game = game.setup(ui.solo.players, opts, { prev: null, solo: true }); } catch (e) { console.error(e); ui.solo = null; toast("연습 판을 만들지 못했어요"); render(); return; }
      store.set(K("solo"), ui.solo); ui.g = {}; ui.inSolo = true;
      afterChange(prev, ui.solo);
    } else if (cmd === "resume") { if (ui.solo && ui.solo.game) { ui.inSolo = true; ui.g = {}; render(); } }
    else if (cmd === "lobby") { ui.inSolo = false; ui.g = {}; render(); }
  }
  function ctxFor(s) {
    const me = mySeat(s);
    return {
      s, g: s.game, me, names: names(s), opts: s.opts || ui.opts,
      ui: ui.g, act, esc, toast, josa,
      rerender: render,
      flush() { if (renderPending) render(); },
      connected: ui.peerStatus === "connected", isHost: ui.isHost, solo: ui.inSolo,
      sheet(html, opts) { ui.sheet = Object.assign({ kind: "game", html }, opts || {}); render(); },
      closeSheet() { ui.sheet = null; render(); },
    };
  }
  function tableHTML(s, ctx) {
    const log = s.game && Array.isArray(s.game.log);
    return `<div class="duo-bar"><a class="duo-pill" href="../" aria-label="게임 목록">←</a><span class="duo-title">${esc(game.title)}</span><span class="sp"></span>
        ${ui.inSolo ? `<span class="duo-conn solo">혼자 연습</span>` : connPill()}${log ? `<button class="duo-pill" data-duo="log">기록</button>` : ""}<button class="duo-pill" data-duo="rules">규칙</button><button class="duo-pill" data-duo="menu" aria-label="메뉴">⋯</button></div>
      ${ui.inSolo && ui.online && ui.online.status === "playing" && mySeat(ui.online) >= 0 ? `<button class="duo-banner" data-duo="solo-exit">상대와 하는 판이 열려 있어요 — 그쪽으로 가기</button>` : ""}
      <main id="duo-game">${game.render(ctx)}</main>
      ${ctx.me < 0 ? `<p class="duo-wait">상대 폰에서 다른 사람과 하던 판이라 구경만 하고 있어요.</p>
        <div class="duo-row"><button class="duo-btn warn" data-duo="reset" data-key="reset"><b>${ui.armed === "reset" ? "정말 그 판을 끝낼까요? 한 번 더 누르기" : "그 판 끝내고 둘이 새로 하기"}</b><span>진행 중이던 판은 사라져요</span></button></div>` : ""}`;
  }

  let renderPending = false;
  function render() {
    if (game.holdRender && game.holdRender()) { renderPending = true; return; }
    renderPending = false;
    const app = $("#app");
    const s = current();
    let html, ctx = null;
    if (!ui.net) html = noNetHTML();
    else if (!ui.name || !ui.room || ui.renaming) html = nameHTML();
    else if (!s || s.status !== "playing" || !s.game) html = lobbyHTML(s);
    else { ctx = ctxFor(s); html = tableHTML(s, ctx); }
    app.innerHTML = html;
    $("#layer").innerHTML = layerHTML(s, ctx);
    if (ctx && game.mounted) { try { game.mounted($("#duo-game"), ctx); } catch (e) { console.error(e); } }
  }
  function layerHTML(s, ctx) {
    const sh = ui.sheet;
    let h = "";
    const res = ctx && game.result ? game.result(s.game, ctx) : null;
    if (res && (!sh || sh.kind === "menu")) {
      const canAct = ctx.me >= 0;
      if (ui.inSolo) {
        h += `<div class="duo-scrim center"><div class="duo-sheet duo-result" role="dialog" aria-modal="true" aria-label="연습 결과">
        <div class="big">${res.title}</div>${res.html || ""}
        <div class="duo-row"><button class="duo-btn primary" data-duo="again"><b>새 연습 판</b><span>같은 설정으로 다시</span></button>
        <button class="duo-btn" data-duo="lobby"><b>처음 화면</b><span>설정을 바꾸거나 상대와 하기</span></button></div>
        <button class="duo-pill duo-close" data-duo="peek" style="align-self:center">판 다시 보기</button></div></div>`;
        return h + (sh ? sheetHTML(sh, s) : "");
      }
      h += `<div class="duo-scrim center"><div class="duo-sheet duo-result" role="dialog" aria-modal="true" aria-label="게임 결과">
        <div class="big">${res.title}</div>${res.html || ""}
        ${canAct ? `<div class="duo-row"><button class="duo-btn primary" data-duo="again"><b>한 판 더</b><span>같은 둘이서 바로 다시</span></button>
        <button class="duo-btn" data-duo="lobby"><b>처음 화면</b><span>설정을 바꾸거나 이름을 바꿔요</span></button></div>` : ""}
        <button class="duo-pill duo-close" data-duo="peek" style="align-self:center">판 다시 보기</button></div></div>`;
    }
    if (sh) h += sheetHTML(sh, s);
    return h;
  }
  function wrapSheet(inner, label, center) {
    return `<div class="duo-scrim ${center ? "center" : ""}" data-duo="close" data-scrim="1"><div class="duo-sheet" role="dialog" aria-modal="true" aria-label="${label}" data-stop="1">
      <button class="duo-pill duo-close" data-duo="close">닫기</button>${inner}</div></div>`;
  }
  function sheetHTML(sh, s) {
    if (sh.kind === "rules") return wrapSheet(`<h2>${esc(game.title)} 규칙</h2>${game.rules}`, "규칙");
    if (sh.kind === "log") return wrapSheet(`<h2>지금까지의 기록</h2><div class="duo-log">${((s && s.game && s.game.log) || []).slice().reverse().map(t => `<div>${esc(t)}</div>`).join("") || "<div>아직 기록이 없어요.</div>"}</div>`, "기록");
    if (sh.kind === "peek") return "";
    if (sh.kind === "conn") {
      const c = connInfo();
      return wrapSheet(`<h2>연결 상태 — ${esc(c.txt)}</h2><p id="duo-conn-why">${esc(c.why)}</p>
        <p class="duo-note">이 폰: ${ui.isHost ? "판을 연 쪽 (방장)" : "상대가 연 판에 붙은 쪽"}. 하던 판은 두 폰에 모두 저장돼 있어서 다시 연결해도 사라지지 않아요.</p>
        <div class="duo-row"><button class="duo-btn primary" data-duo="reconnect"><b>다시 연결하기</b><span>표시가 이상하거나 오래 안 붙으면 눌러 보세요</span></button></div>
        <p class="duo-note">그래도 안 되면 두 폰 모두 와이파이나 데이터가 켜져 있는지 확인하고, 두 폰에서 이 페이지를 새로고침해 주세요.</p>`, "연결 상태");
    }
    if (sh.kind === "game") return wrapSheet(sh.html, sh.label || "선택", sh.center);
    if (sh.kind === "menu") {
      const k = ui.armed;
      return wrapSheet(`<h2>메뉴</h2><div class="duo-row" style="flex-direction:column">
        <button class="duo-btn warn" data-duo="again" data-key="again"><b>${k === "again" ? "정말 새로 시작할까요? 한 번 더 누르기" : "이 판 그만두고 새 게임"}</b><span>같은 두 사람으로 처음부터</span></button>
        <button class="duo-btn warn" data-duo="lobby" data-key="lobby"><b>${k === "lobby" ? "정말 나갈까요? 한 번 더 누르기" : "처음 화면으로"}</b><span>${ui.inSolo ? "연습 판은 저장돼요. 나중에 이어서 할 수 있어요" : "설정 화면으로 (상대도 함께 이동)"}</span></button>
      </div>`, "메뉴");
    }
    return "";
  }

  /* ───── events ───── */
  document.addEventListener("click", e => {
    const d = e.target.closest("[data-duo]");
    const a = e.target.closest("[data-a]");
    if (a && (!d || d.contains(a))) {
      const s = current();
      if (s && s.status === "playing" && s.game && game.onClick) { try { game.onClick(a, ctxFor(s), e); } catch (err) { console.error(err); } }
      return;
    }
    if (!d) return;
    const cmd = d.dataset.duo;
    if (cmd === "close" && d.dataset.scrim && e.target.closest("[data-stop]")) return;
    const key = d.dataset.key;
    if (key && ui.armed !== key) { ui.armed = key; render(); setTimeout(() => { if (ui.armed === key) { ui.armed = null; render(); } }, 4000); return; }
    ui.armed = null;
    const s = current();
    switch (cmd) {
      case "rules": ui.sheet = { kind: "rules" }; render(); break;
      case "log": ui.sheet = { kind: "log" }; render(); break;
      case "menu": ui.sheet = { kind: "menu" }; render(); break;
      case "close": ui.sheet = null; render(); break;
      case "peek": ui.sheet = { kind: "peek" }; render(); toast("다 봤으면 메뉴(⋯)에서 새 게임을 시작하세요"); break;
      case "name-save": {
        const nm = ($("#name-in").value || "").trim().slice(0, 12);
        if (!nm) { toast("이름을 먼저 적어 주세요"); $("#name-in").focus(); return; }
        const changed = ui.room && nm !== ui.name;
        ui.renaming = false;
        ui.name = nm; store.set("duo-name", nm);
        if (!ui.room) join();
        else { render(); if (changed && ui.conn) send({ t: "hello", id: ui.myId, name: ui.name, state: ui.online, seq: seqOf() }); }
        if (changed && ui.isHost && ui.online && ui.online.status !== "playing") { const n = clone(ui.online); n.players = n.players.map(p => p.id === ui.myId ? { id: p.id, name: nm } : p); n.seq += 1; setState(n); }
        break;
      }
      case "rename": ui.renaming = true; render(); break;
      case "reset": command("reset", ui.name); break;
      case "start": command("start"); break;
      case "again": ui.sheet = null; command("again"); break;
      case "lobby": ui.sheet = null; command("lobby"); break;
      case "solo": soloCommand("start"); break;
      case "solo-resume": soloCommand("resume"); break;
      case "solo-exit": soloCommand("lobby"); break;
      case "conn": ui.sheet = { kind: "conn" }; render(); break;
      case "reconnect": ui.sheet = null; reconnectNow(); break;
    }
  });
  document.addEventListener("change", e => {
    const sel = e.target.closest("[data-duo-opt]");
    if (!sel) return;
    const id = sel.dataset.duoOpt;
    const o = (game.options || []).find(x => x.id === id);
    const raw = sel.value;
    const v = o && typeof o.def === "number" ? +raw : raw;
    ui.opts[id] = v; store.set(K("opts"), ui.opts);
    if (ui.online && ui.online.status === "lobby") command("opts", { [id]: v });
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && ui.sheet) { ui.sheet = null; render(); }
    if (e.key === "Enter" && e.target.id === "name-in") { const b = $('[data-duo="name-save"]'); if (b) b.click(); }
  });

  /* ───── boot ───── */
  if (ui.net && ui.name) join();
  render();
  return { render, current, act };
};
})();
