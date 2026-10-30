/* Solo shell — the part every one-player puzzle page shares: picking a level, today's puzzle, building the
 * puzzle in a worker, the clock, saving progress, records, and the finish / give-up / rules dialogs.
 *
 * A page calls Solo.init({ game, title, intro, rules, sizes, mount }).
 * mount(puzzle, saved, ctx) draws the board into ctx.board / ctx.tools and returns
 *   { reveal(), check?() -> number of wrong marks shown }.
 * The page calls ctx.save(state) after every move and ctx.solved() when the puzzle is done.
 */
(function () {
"use strict";
const LEVELS = ["hard", "extreme", "nightmare"];
const LEVEL_NAME = { hard: "어려움", extreme: "극악", nightmare: "악몽" };
const ENGINE = { nonogram: "Nonogram", stars: "Stars", code: "Code" };
const script = document.currentScript, BASE = new URL(".", script.src), VER = new URL(script.src).search;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: progress just isn't kept */ } },
};
const pad = n => String(n).padStart(2, "0");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isDaily = seed => /^\d{4}-\d\d-\d\d$/.test(seed);
const dailyLabel = seed => { const [, m, d] = seed.split("-").map(Number); return `${m}월 ${d}일 오늘의 퍼즐`; };
const clock = sec => { sec = Math.floor(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

let toastTimer;
function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = el(`<div class="toast" role="status"></div>`); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// A modal sheet. buttons: [{ label, cls, value }]. Resolves with the chosen value (undefined if dismissed).
function sheet(title, bodyHtml, buttons) {
  return new Promise(resolve => {
    const d = el(`<dialog class="sheet"><h2>${title}</h2><div class="body">${bodyHtml}</div><div class="acts"></div></dialog>`);
    for (const b of buttons) {
      const btn = el(`<button class="btn ${b.cls || ""}">${b.label}</button>`);
      btn.onclick = () => { d.close(); resolve(b.value); };
      d.querySelector(".acts").append(btn);
    }
    d.addEventListener("close", () => { d.remove(); resolve(undefined); });
    document.body.append(d); d.showModal();
  });
}

function generate(game, level, seed) {
  const local = () => new Promise(res => setTimeout(() => res(window[ENGINE[game]].generate(level, seed)), 30));
  let worker;
  try { worker = new Worker(new URL("gen.js" + VER, BASE)); } catch (e) { return local(); }
  return new Promise(resolve => {
    worker.onmessage = e => { worker.terminate(); resolve(e.data.ok ? e.data.puzzle : local()); };
    worker.onerror = e => { e.preventDefault(); worker.terminate(); resolve(local()); };
    worker.postMessage({ game, level, seed });
  });
}

function init(cfg) {
  const app = document.getElementById("app");
  const P = new URLSearchParams(location.search), level = P.get("d"), seed = P.get("s");
  const K = `solo:${cfg.game}`, help = cfg.helpWord || "검사";
  const rulesNote = `<p class="note" style="text-align:left">모든 퍼즐은 답이 딱 하나뿐인지 컴퓨터가 끝까지 확인한 것만 나와요. 찍을 필요 없이 논리로 풀 수 있어요.</p>`;
  const showRules = () => sheet(`${cfg.title} 규칙`, cfg.rules + rulesNote, [{ label: "닫기", cls: "main" }]);
  if (LEVELS.includes(level) && seed) play(level, seed); else setup();

  function setup() {
    let lv = store.get(`${K}:lastLevel`, "hard");
    if (!LEVELS.includes(lv)) lv = "hard";
    app.innerHTML = "";
    app.append(el(`<header class="bar"><a class="pill" href="../">← 목록</a><h1>${cfg.title}</h1><span class="sp"></span><button class="pill" data-rules>규칙</button></header>`));
    const box = el(`<section class="setup">
      <p class="intro">${cfg.intro}</p>
      <div class="levels" role="group" aria-label="난이도">${LEVELS.map(l => `<button data-lv="${l}" style="--c:var(--lv-${l})"><b>${LEVEL_NAME[l]}</b><small>${cfg.sizes[l]}</small></button>`).join("")}</div>
      <div class="starts">
        <button class="btn main" data-daily></button>
        <div class="row"><button class="btn" data-new>새 퍼즐</button><button class="btn" data-resume>이어서 하기</button></div>
        <div class="daily-done" data-dailydone></div>
      </div>
      <div class="recs"><h2>내 기록 · 최고 기록은 ${help} 없이 푼 판만</h2><table data-recs></table></div>
    </section>`);
    app.append(box);
    app.querySelector("[data-rules]").onclick = showRules;
    const go = s => { store.set(`${K}:lastLevel`, lv); location.href = `?d=${lv}&s=${encodeURIComponent(s)}`; };
    box.querySelector("[data-daily]").onclick = () => go(today());
    box.querySelector("[data-new]").onclick = () => go(Math.random().toString(36).slice(2, 8));
    const cur = store.get(`${K}:current`, null), curSave = cur && store.get(`${K}:${cur.level}:${cur.seed}`, null);
    const resume = box.querySelector("[data-resume]");
    if (cur && curSave && !curSave.done) {
      resume.textContent = `이어서 하기 · ${LEVEL_NAME[cur.level]}`;
      resume.onclick = () => { location.href = `?d=${cur.level}&s=${encodeURIComponent(cur.seed)}`; };
    } else resume.disabled = true;
    const paint = () => {
      box.querySelectorAll("[data-lv]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lv === lv)));
      const done = store.get(`${K}:${lv}:${today()}`, null);
      box.querySelector("[data-daily]").textContent = `오늘의 퍼즐 · ${LEVEL_NAME[lv]}`;
      box.querySelector("[data-dailydone]").textContent = done && done.done ? (done.gaveUp ? "오늘 퍼즐은 정답을 봤어요" : `오늘 퍼즐 완료 · ${clock(done.elapsed)}`) : "";
    };
    box.querySelectorAll("[data-lv]").forEach(b => { b.onclick = () => { lv = b.dataset.lv; store.set(`${K}:lastLevel`, lv); paint(); }; });
    paint();
    box.querySelector("[data-recs]").innerHTML = LEVELS.map(l => {
      const r = store.get(`${K}:rec:${l}`, {});
      return `<tr><td><span class="lv ${l}">${LEVEL_NAME[l]}</span></td><td>${r.solved || 0}판 풂</td><td>${r.best != null ? "최고 " + clock(r.best) : "—"}</td></tr>`;
    }).join("");
  }

  async function play(level, seed) {
    const key = `${K}:${level}:${seed}`;
    let save = store.get(key, null) || { state: null, elapsed: 0, checks: 0, done: false, gaveUp: false };
    store.set(`${K}:current`, { level, seed });
    app.innerHTML = "";
    app.append(el(`<header class="bar"><a class="pill" href="./">← ${cfg.title}</a><span class="sp"></span><button class="pill" data-rules>규칙</button></header>`));
    app.querySelector("[data-rules]").onclick = showRules;
    const status = el(`<div class="status"><span class="lv ${level}">${LEVEL_NAME[level]}</span><span class="pid">${isDaily(seed) ? dailyLabel(seed) : "퍼즐 #" + esc(seed)}</span><span class="sp"></span><span class="clock" aria-label="걸린 시간">${clock(save.elapsed)}</span></div>`);
    const loading = el(`<div class="loading"><div class="spinner"></div><div>퍼즐을 만들고 있어요…<br><small>답이 하나뿐인지 확인하는 중이라 조금 걸릴 수 있어요</small></div></div>`);
    app.append(status, loading);
    const puzzle = await generate(cfg.game, level, seed);
    loading.remove();

    const banner = el(`<div class="solved-banner" hidden></div>`);
    const board = el(`<div class="board-area"></div>`), tools = el(`<div class="tools"></div>`);
    const foot = el(`<div class="foot"></div>`);
    app.append(banner, tools, board, foot);
    const clockEl = status.querySelector(".clock");

    let ctl, lastTick = Date.now();
    const persist = () => store.set(key, save);
    const ticking = () => !save.done && document.visibilityState === "visible";
    setInterval(() => {
      const now = Date.now();
      if (ticking()) { save.elapsed += Math.min(5, (now - lastTick) / 1000); clockEl.textContent = clock(save.elapsed); }
      lastTick = now;
    }, 1000);
    setInterval(() => { if (ticking()) persist(); }, 5000);
    document.addEventListener("visibilitychange", () => { lastTick = Date.now(); persist(); });
    addEventListener("pagehide", persist);

    const showBanner = () => {
      banner.hidden = !save.done;
      banner.className = "solved-banner" + (save.gaveUp ? " gaveup-banner" : "");
      banner.textContent = save.gaveUp ? "정답을 펼쳐 봤어요" : `다 풀었어요 · ${clock(save.elapsed)}${save.checks ? ` · ${help} ${save.checks}번` : ""}`;
      foot.querySelectorAll("[data-live]").forEach(b => { b.disabled = save.done; });
    };
    const newPuzzle = () => { location.href = `?d=${level}&s=${Math.random().toString(36).slice(2, 8)}`; };

    const ctx = {
      board, tools, foot, level, seed, toast, sheet,
      done: () => save.done,
      penalty() { save.checks++; persist(); },
      save(state) { save.state = state; persist(); },
      async solved() {
        if (save.done) return;
        save.done = true;
        const rk = `${K}:rec:${level}`, rec = store.get(rk, {});
        rec.solved = (rec.solved || 0) + 1;
        const clean = !save.checks, best = clean && (rec.best == null || save.elapsed < rec.best);
        if (best) rec.best = Math.floor(save.elapsed);
        store.set(rk, rec); persist(); showBanner();
        clockEl.textContent = clock(save.elapsed);
        const v = await sheet("다 풀었어요!", `<div class="result"><div class="time">${clock(save.elapsed)}</div>
          <div class="sub">${LEVEL_NAME[level]} · ${isDaily(seed) ? dailyLabel(seed) : "퍼즐 #" + esc(seed)}</div>
          ${best ? `<div class="best">새 최고 기록!</div>` : clean ? `<div class="sub">최고 기록 ${clock(rec.best)}</div>` : `<div class="sub">${help} ${save.checks}번이 있어서 최고 기록에는 안 들어가요</div>`}</div>`,
          [{ label: "목록으로", value: "back" }, { label: "새 퍼즐", cls: "main", value: "new" }]);
        if (v === "new") newPuzzle(); else if (v === "back") location.href = "./";
      },
    };
    ctl = cfg.mount(puzzle, save, ctx);

    if (ctl.check) {
      const b = el(`<button class="pill" data-live>검사</button>`);
      b.onclick = async () => {
        if (!save.checks) {
          const ok = await sheet("검사할까요?", `<p>잘못 놓은 칸을 잠깐 빨갛게 보여 줘요. 검사를 쓰면 이 판은 최고 기록에 들어가지 않아요.</p>`, [{ label: "취소" }, { label: "검사", cls: "main", value: true }]);
          if (!ok) return;
        }
        save.checks++; persist();
        const n = ctl.check();
        toast(n ? `잘못된 칸 ${n}개` : "아직 틀린 곳은 없어요");
      };
      foot.append(b);
    }
    const give = el(`<button class="pill" data-live>정답 보기</button>`);
    give.onclick = async () => {
      const ok = await sheet("정답을 볼까요?", `<p>이 판은 푼 것으로 치지 않아요.</p>`, [{ label: "취소" }, { label: "정답 보기", cls: "danger", value: true }]);
      if (!ok) return;
      save.done = true; save.gaveUp = true; ctl.reveal(); persist(); showBanner();
    };
    const fresh = el(`<button class="pill">새 퍼즐</button>`);
    fresh.onclick = newPuzzle;
    const share = el(`<button class="pill">같은 퍼즐 링크</button>`);
    share.onclick = async () => {
      const url = location.href;
      try { if (navigator.share) await navigator.share({ title: cfg.title, url }); else { await navigator.clipboard.writeText(url); toast("링크를 복사했어요"); } }
      catch (e) { /* closed the share sheet */ }
    };
    foot.append(give, fresh, share);
    showBanner();
  }
}

window.Solo = { init, LEVELS, LEVEL_NAME, store, clock, el, esc, toast, sheet };
})();
