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
 *
 * Online play: the room creator's page is the authority. The guest sends its moves as
 * actions; the host applies them and sends back the whole state. Both keep the state in
 * localStorage, so a reload on either side resumes the game.
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

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const params = new URLSearchParams(location.search);

window.Duo = function (game) {
  const K = k => "duo-" + game.id + "-" + k;
  const defaults = {};
  (game.options || []).forEach(o => { defaults[o.id] = o.def; });

  const ui = {
    name: store.get("duo-name", "") || store.get("hanabi-name", ""),
    myId: (() => { let id = store.get("hanabi-id", null); if (!id) { id = "p" + Date.now().toString(36) + rnd(1e9).toString(36); store.set("hanabi-id", id); } return id; })(),
    net: window.RTCPeerConnection ? "peer" : null,
    room: null, isHost: false, peer: null, conn: null, peerStatus: "idle", joinCode: "", guestId: null,
    pending: [], aid: 0, lastAid: 0, lastRx: 0,
    online: null,
    sheet: null, armed: null, error: "",
    opts: Object.assign({}, defaults, store.get(K("opts"), {})),
    g: {},                          // per-game transient UI state (selection etc.)
  };

  /* ───── state helpers ───── */
  const current = () => ui.online;
  const names = s => (s && s.players ? s.players.map(p => p.name) : ["", ""]);
  function mySeat(s) {
    if (!s || !s.players) return -1;
    return s.players.findIndex(p => p.id === ui.myId);
  }
  function env(s) { return { players: s ? s.players : [], names: names(s) }; }

  const saveState = () => { if (ui.room) store.set(K("room-" + ui.room), ui.online); };
  function setState(next) {
    const prev = current();
    ui.online = next; saveState();
    sendSync();
    afterChange(prev, next);
  }
  function afterChange(prev, next) {
    if (ui.sheet && ui.sheet.kind === "game" && prev && next && prev.seq !== next.seq && !ui.sheet.keep) ui.sheet = null;
    render();
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

  /* ───── room-code play over PeerJS ───── */
  const PEER_PREFIX = "sw3-" + game.id + "-";
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
  const newCode = () => { let c = ""; for (let i = 0; i < 5; i++) c += CODE_CHARS[rnd(CODE_CHARS.length)]; return c; };
  const shareLink = () => location.origin + location.pathname + "?r=" + ui.room;
  let retryTimer = null;
  const retry = ms => { clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (ui.room) startPeer(); }, ms); };
  function lobbyState() { return { v: 1, status: "lobby", players: [{ id: ui.myId, name: ui.name }], opts: Object.assign({}, ui.opts), seq: 1, game: null }; }

  async function openRoom(code, host) {
    ui.room = code; ui.isHost = host; ui.error = "";
    store.set(K("room"), { code, host });
    ui.online = store.get(K("room-" + code), null);
    ui.pending = host ? [] : store.get(K("room-" + code + "-pend"), []);
    ui.aid = store.get(K("room-" + code + "-aid"), 0);
    ui.lastAid = host ? store.get(K("room-" + code + "-last"), 0) : 0;
    ui.lastEp = host ? store.get(K("room-" + code + "-ep"), null) : null;
    if (!host) { ui.ep = store.get(K("room-" + code + "-ep"), null); if (!ui.ep) { ui.ep = "e" + Date.now().toString(36) + rnd(1e6).toString(36); store.set(K("room-" + code + "-ep"), ui.ep); store.set(K("room-" + code + "-aid"), 0); ui.aid = 0; } }
    if (host && !ui.online) { ui.online = lobbyState(); store.set(K("room-" + code), ui.online); }
    ui.peerStatus = "opening"; render();
    try { await loadPeerLib(); } catch (e) { ui.peerStatus = "error"; ui.error = "연결 모듈을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요."; render(); return; }
    startPeer();
  }
  function leaveRoom() {
    clearTimeout(retryTimer);
    try { ui.conn && ui.conn.close(); } catch (e) {}
    try { ui.peer && ui.peer.destroy(); } catch (e) {}
    ui.peer = ui.conn = null; ui.room = null; ui.online = null; ui.peerStatus = "idle"; ui.joinCode = "";
    store.set(K("room"), null);
    if (params.get("r")) { params.delete("r"); const q = params.toString(); history.replaceState(null, "", location.pathname + (q ? "?" + q : "")); }
    render();
  }
  function startPeer() {
    if (!ui.room) return;
    try { ui.peer && ui.peer.destroy(); } catch (e) {}
    ui.conn = null;
    const host = ui.isHost;
    const peer = host ? new Peer(PEER_PREFIX + ui.room, peerOptions()) : new Peer(peerOptions());
    ui.peer = peer;
    peer.on("open", () => { if (ui.peer !== peer) return; if (host) { ui.peerStatus = "waiting"; render(); } else connectToHost(); });
    peer.on("connection", conn => { if (host && ui.peer === peer) attach(conn); });
    peer.on("disconnected", () => { if (ui.peer === peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} } });
    peer.on("error", err => {
      if (ui.peer !== peer) return;
      const t = err && err.type;
      if (t === "peer-unavailable") { ui.peerStatus = "nohost"; render(); retry(3000); }
      else if (t === "unavailable-id") { ui.peerStatus = "opening"; render(); retry(4000); }
      else if (t === "browser-incompatible") { ui.peerStatus = "error"; ui.error = "이 브라우저는 온라인 연결을 지원하지 않아요. 크롬이나 사파리로 열어 주세요."; render(); }
      else { if (!ui.conn) { ui.peerStatus = "lost"; render(); retry(5000); } }
    });
  }
  function connectToHost() {
    if (!ui.peer || ui.peer.destroyed) return;
    const peer = ui.peer;
    const conn = peer.connect(PEER_PREFIX + ui.room, { reliable: true, serialization: "json" });
    attach(conn);
    setTimeout(() => { if (!conn._opened && ui.peer === peer && !peer.destroyed && !ui.conn) { try { conn.close(); } catch (e) {} ui.peerStatus = "nohost"; render(); connectToHost(); } }, 12000);
  }
  function attach(conn) {
    conn.on("open", () => {
      conn._opened = true;
      if (ui.conn && ui.conn !== conn) { try { ui.conn.close(); } catch (e) {} }
      ui.conn = conn; ui.peerStatus = "connected"; ui.error = ""; ui.lastRx = Date.now();
      send({ t: "hello", id: ui.myId, name: ui.name, state: ui.online, seq: seqOf() });
      if (!ui.isHost) flushPending();
      render();
    });
    conn.on("data", m => { if (window.__duoStall) return; if (ui.conn === conn) { ui.lastRx = Date.now(); onMsg(m); } });
    const gone = () => {
      if (ui.conn !== conn) return;
      ui.conn = null; ui.peerStatus = ui.isHost ? "waiting" : "lost"; render();
      if (!ui.isHost) retry(1500);
    };
    conn.on("close", gone); conn.on("error", gone);
    conn._gone = gone;
  }
  const DROP = +(params.get("droptest") || 0);          // 시험용: 메시지를 일부러 이 비율만큼 버린다
  function send(m) {
    if ((DROP && Math.random() < DROP) || window.__duoStall) return false;
    try { if (ui.conn && ui.conn.open) { ui.conn.send(m); return true; } } catch (e) {}
    return false;
  }
  const seqOf = () => (ui.online ? ui.online.seq : 0);

  /* 손님 쪽: 아직 방장이 확인하지 않은 행동 */
  const pendKey = () => K("room-" + ui.room + "-pend");
  function queue(item) {
    ui.aid = (ui.aid || store.get(K("room-" + ui.room + "-aid"), 0)) + 1;
    store.set(K("room-" + ui.room + "-aid"), ui.aid);
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
  const lastKey = () => K("room-" + ui.room + "-last");
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
        if (m.state && typeof m.state.seq === "number" && (!ui.online || (ui.online.status === "lobby" && ui.online.seq <= 2 && m.state.seq > ui.online.seq))) {
          ui.online = clone(m.state); saveState();          // 방장이 기록을 잃어버린 경우에만 손님 것을 받는다
        }
        const s = ui.online ? clone(ui.online) : lobbyState();
        const name = String(m.name || "상대").slice(0, 12);
        const i = s.players.findIndex(p => p.id === m.id);
        if (i < 0) {
          if (s.status !== "lobby" || s.players.length >= 2) { send({ t: "full" }); return; }
          s.players.push({ id: String(m.id), name }); s.seq += 1;
        } else if (s.status === "lobby" && s.players[i].name !== name) { s.players[i].name = name; s.seq += 1; }
        ui.guestId = String(m.id);
        const prev = ui.online; ui.online = s; saveState();
        sendSync(); afterChange(prev, s);
      } else if (m.t === "act" || m.t === "cmd") {
        if (m.ep && m.ep !== ui.lastEp) { ui.lastEp = m.ep; ui.lastAid = 0; store.set(K("room-" + ui.room + "-ep"), m.ep); }
        if (typeof m.aid !== "number" || m.aid <= (ui.lastAid || 0)) { sendSync(); return; }   // 이미 처리한 것
        ui.lastAid = m.aid; store.set(lastKey(), ui.lastAid);
        if (m.t === "act") hostApply(ui.online ? ui.online.players.findIndex(p => p.id === ui.guestId) : -1, m.action);
        else if (m.cmd === "opts") sendSync();                 // 설정은 방장만
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

  /* 2초마다: 서로 상태 번호 확인, 못 받은 행동 다시 보내기, 응답이 끊긴 연결 정리 */
  setInterval(() => {
    if (!ui.room || !ui.conn) return;
    if (Date.now() - (ui.lastRx || 0) > 9000) { const c = ui.conn; try { c.close(); } catch (e) {} if (c._gone) c._gone(); return; }
    if (ui.isHost) send({ t: "ping", seq: seqOf(), ack: ui.lastAid || 0 });
    else {
      if (!ui.online || mySeat(ui.online) < 0) send({ t: "hello", id: ui.myId, name: ui.name, state: ui.online, seq: seqOf() });   // 아직 자리에 안 들어갔으면 인사 다시
      flushPending(); send({ t: "ping", seq: seqOf() });
    }
  }, 2000);
  // 다른 앱(카톡 등)에 갔다가 돌아오거나, 사파리가 뒤로 가기로 페이지를 되살리면 바로 다시 맞춘다
  const resume = () => {
    if (document.hidden || !ui.room) return;
    if (!ui.conn) { if (!ui.isHost) startPeer(); return; }
    if (Date.now() - (ui.lastRx || 0) > 5000) { const c = ui.conn; try { c.close(); } catch (e) {} if (c._gone) c._gone(); if (!ui.isHost) startPeer(); return; }
    if (ui.isHost) sendSync(); else { flushPending(); send({ t: "ping", seq: seqOf() }); }
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pageshow", e => { if (e.persisted && ui.room) { ui.lastRx = 0; resume(); } });

  /* ───── rendering ───── */
  const connPill = () => {
    if (!ui.room) return "";
    const st = ui.peerStatus;
    const txt = st === "connected" ? "연결됨" : st === "waiting" ? "상대 기다리는 중" : st === "nohost" ? "방장 찾는 중" : st === "lost" ? "다시 연결 중" : st === "full" ? "방이 가득 찼어요" : st === "error" ? "연결 안 됨" : "연결 준비 중";
    return `<span class="duo-conn ${st === "connected" ? "ok" : ""}" role="status">${txt}</span>`;
  };
  const hero = () => `<a class="duo-pill" href="../" style="align-self:flex-start">← 다른 게임</a>
    <div class="duo-hero"><div class="mark">${game.mark}</div><h1>${esc(game.title)}</h1><p>${game.tagline}</p></div>`;
  const rulesBtn = `<button class="duo-btn" data-duo="rules"><b>규칙 보기</b><span>처음이라면 먼저 읽어 보세요</span></button>`;

  function optsHTML(opts, editable) {
    if (!game.options || !game.options.length) return "";
    return `<div class="duo-opts">${game.options.map(o => `<label class="duo-fld" for="opt-${o.id}">${esc(o.label)}
      <select id="opt-${o.id}" data-duo-opt="${o.id}" ${editable ? "" : "disabled"}>${o.choices.map(c => `<option value="${esc(c.v)}" ${String(opts[o.id]) === String(c.v) ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>`).join("")}</div>`;
  }
  function roomEntryHTML() {
    return `<div class="duo-lobby">${hero()}
      <div class="duo-panel">
        <h2>방 만들고 코드로 들어오기</h2>
        <label class="duo-fld" for="name-in">내 이름<input type="text" id="name-in" maxlength="12" placeholder="예: 지우" value="${esc(ui.name)}"></label>
        ${ui.joinCode ? "" : `<div class="duo-row"><button class="duo-btn primary" data-duo="create"><b>방 만들기</b><span>코드와 링크가 나와요. 상대에게 보내 주세요</span></button></div>`}
        <label class="duo-fld" for="code-in">${ui.joinCode ? "받은 방 코드" : "받은 코드가 있다면"}<input type="text" id="code-in" maxlength="6" autocapitalize="characters" placeholder="예: K7QX2" value="${esc(ui.joinCode)}" style="text-transform:uppercase;letter-spacing:.2em"></label>
        <div class="duo-row"><button class="duo-btn ${ui.joinCode ? "primary" : ""}" data-duo="join"><b>이 코드로 들어가기</b><span>상대가 만든 방에 앉아요</span></button></div>
        ${ui.error ? `<p class="duo-err">${esc(ui.error)}</p>` : ""}
        <p class="duo-note">방을 만든 사람의 화면이 게임판 역할을 해요. 누가 페이지를 닫아도 다시 열면 이어서 할 수 있어요.</p>
      </div>
      <div class="duo-row">${rulesBtn}</div></div>`;
  }
  function noNetHTML() {
    return `<div class="duo-lobby">${hero()}<div class="duo-panel"><h2>이 브라우저에서는 연결할 수 없어요</h2>
      <p class="duo-note">이 브라우저는 폰끼리 연결하는 기능(WebRTC)을 지원하지 않아요. 크롬이나 사파리 최신 버전으로 열어 주세요.</p></div></div>`;
  }
  function roomLobbyHTML(s) {
    const players = (s && s.players) || [];
    const seats = [0, 1].map(i => { const p = players[i]; return `<div class="duo-seat ${p ? "filled" : ""}"><div class="tag">${i === 0 ? "방장" : "손님"}${p && p.id === ui.myId ? " · 나" : ""}</div><div class="who">${p ? esc(p.name) : "빈 자리"}</div></div>`; }).join("");
    const ready = players.length === 2 && players.some(p => p.id === ui.myId);
    let action;
    if (ui.peerStatus === "full") action = `<p class="duo-err">이 방은 이미 두 사람이 앉아 있어요. 코드를 다시 확인해 주세요.</p>`;
    else if (ready) action = `<div class="duo-row"><button class="duo-btn primary" data-duo="start" ${ui.peerStatus === "connected" ? "" : "disabled"}><b>게임 시작</b><span>${ui.peerStatus === "connected" ? "둘 다 준비됐어요" : "상대와 다시 연결되면 시작할 수 있어요"}</span></button></div>`;
    else if (ui.isHost) action = `<p class="duo-note">아래 링크나 코드를 상대에게 보내 주세요. 상대가 들어오면 자리에 이름이 떠요.</p>`;
    else action = `<p class="duo-note">${ui.peerStatus === "nohost" ? "방을 찾고 있어요. 방을 만든 사람이 페이지를 열어 두었는지 확인해 주세요." : "방에 연결하는 중…"}</p>`;
    return `<div class="duo-lobby">${hero()}
      <div class="duo-panel">
        <div class="duo-head"><h2>방 코드</h2>${connPill()}</div>
        <div class="duo-code">${esc(ui.room)}</div>
        ${ui.isHost ? `<div class="duo-share"><input type="text" id="share-link" readonly value="${esc(shareLink())}" aria-label="초대 링크"><button class="duo-pill" data-duo="copy">링크 복사</button></div>` : ""}
        <div class="duo-seats">${seats}</div>
        ${optsHTML((s && s.opts) || ui.opts, ui.isHost)}
        ${!ui.isHost && game.options && game.options.length ? `<p class="duo-note">설정은 방장이 정해요.</p>` : ""}
        ${action}
        ${ui.error ? `<p class="duo-err">${esc(ui.error)}</p>` : ""}
      </div>
      <div class="duo-row">${rulesBtn}
        <button class="duo-btn warn" data-duo="leave" data-key="leave"><b>${ui.armed === "leave" ? "정말 나갈까요? 한 번 더 누르기" : "방 나가기"}</b><span>다른 방을 만들거나 들어가요</span></button></div></div>`;
  }
  function ctxFor(s) {
    const me = mySeat(s);
    return {
      s, g: s.game, me, names: names(s), opts: s.opts || ui.opts,
      ui: ui.g, act, esc, toast, josa,
      rerender: render,
      flush() { if (renderPending) render(); },
      connected: ui.peerStatus === "connected", isHost: ui.isHost,
      sheet(html, opts) { ui.sheet = Object.assign({ kind: "game", html }, opts || {}); render(); },
      closeSheet() { ui.sheet = null; render(); },
    };
  }
  function tableHTML(s, ctx) {
    const log = s.game && Array.isArray(s.game.log);
    return `<div class="duo-bar"><a class="duo-pill" href="../" aria-label="게임 목록">←</a><span class="duo-title">${esc(game.title)}</span><span class="sp"></span>
        ${connPill()}${log ? `<button class="duo-pill" data-duo="log">기록</button>` : ""}<button class="duo-pill" data-duo="rules">규칙</button><button class="duo-pill" data-duo="menu" aria-label="메뉴">⋯</button></div>
      <main id="duo-game">${game.render(ctx)}</main>
      ${ctx.me < 0 ? `<p class="duo-wait">두 자리가 모두 차 있어서 구경 중이에요.</p>` : ""}`;
  }

  let renderPending = false;
  function render() {
    if (game.holdRender && game.holdRender()) { renderPending = true; return; }
    renderPending = false;
    const app = $("#app");
    const s = current();
    let html, ctx = null;
    if (!ui.net) html = noNetHTML();
    else if (!ui.room) html = roomEntryHTML();
    else if (!s || s.status !== "playing" || !s.game) html = roomLobbyHTML(s);
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
    if (sh.kind === "game") return wrapSheet(sh.html, sh.label || "선택", sh.center);
    if (sh.kind === "menu") {
      const k = ui.armed;
      return wrapSheet(`<h2>메뉴</h2><div class="duo-row" style="flex-direction:column">
        <button class="duo-btn warn" data-duo="again" data-key="again"><b>${k === "again" ? "정말 새로 시작할까요? 한 번 더 누르기" : "이 판 그만두고 새 게임"}</b><span>같은 두 사람으로 처음부터</span></button>
        <button class="duo-btn warn" data-duo="lobby" data-key="lobby"><b>${k === "lobby" ? "정말 나갈까요? 한 번 더 누르기" : "처음 화면으로"}</b><span>설정 화면으로 (상대도 함께 이동)</span></button>
        ${ui.room ? `<button class="duo-btn warn" data-duo="leave" data-key="leave"><b>${k === "leave" ? "정말 나갈까요? 한 번 더 누르기" : "방 나가기"}</b><span>같은 코드로 다시 들어올 수 있어요</span></button>` : ""}
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
      case "copy": {
        const link = shareLink(), inp = $("#share-link");
        const fb = () => { if (inp) { inp.focus(); inp.select(); } toast("링크를 길게 눌러 복사해 주세요"); };
        try { navigator.clipboard.writeText(link).then(() => toast("링크를 복사했어요. 카톡으로 보내 주세요"), fb); } catch (err) { fb(); }
        break;
      }
      case "create": case "join": {
        const nm = ($("#name-in").value || "").trim().slice(0, 12);
        if (!nm) { toast("이름을 먼저 적어 주세요"); $("#name-in").focus(); return; }
        ui.name = nm; store.set("duo-name", nm);
        if (cmd === "create") { openRoom(newCode(), true); break; }
        const code = ($("#code-in").value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (code.length < 4) { toast("방 코드를 확인해 주세요"); $("#code-in").focus(); return; }
        openRoom(code, false); break;
      }
      case "leave": ui.sheet = null; leaveRoom(); break;
      case "start": command("start"); break;
      case "again": ui.sheet = null; command("again"); break;
      case "lobby": ui.sheet = null; command("lobby"); break;
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
    if (ui.isHost && ui.online && ui.online.status === "lobby") runCommand("opts", { [id]: v });
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && ui.sheet) { ui.sheet = null; render(); }
    if (e.key === "Enter" && (e.target.id === "name-in" || e.target.id === "code-in")) {
      const b = (e.target.id === "code-in" || ui.joinCode) ? $('[data-duo="join"]') : $('[data-duo="create"]');
      if (b) b.click();
    }
  });

  /* ───── boot ───── */
  const urlRoom = (params.get("r") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const saved = store.get(K("room"), null);
  if (ui.net) {
    if (urlRoom) {
      if (saved && saved.code === urlRoom && ui.name) openRoom(saved.code, saved.host);
      else ui.joinCode = urlRoom;
    } else if (saved && ui.name) openRoom(saved.code, saved.host);
  }
  render();
  return { render, current, act };
};
})();
