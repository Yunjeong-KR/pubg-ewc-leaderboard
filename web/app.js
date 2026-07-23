/* 정적 대시보드 — leaderboard.json 을 읽어 리더보드를 렌더한다.
   구조: { meta, phases:[{key,name,advanceCut,matchCount,total,days:[{date,label,matchCount,teams,players,matches:[...]}]}] }
   뷰 계층: Phase(Group Stage/Final) → DAY 1..N / TOTAL → 경기별(단일 매치).
   TOTAL 은 그 Phase 안에서만 누적된다. 백엔드/키 없음: Actions 가 갱신한 정적 JSON만 읽는다. */
let DATA = null;
let curPhase = 0;        // phases 인덱스
let curView = "total";   // "total" | "YYYY-MM-DD"
let curMatch = null;     // null(합산) | match_id
let curTab = "teams";    // "teams" | "players"
let TWIRE = {};          // tag -> {total, kills}  (외부 검증 소스 Twire)
let TWIRE_PHASE = "";    // TWIRE가 어느 phase 기준인지
let TWIRE_MATCHES = null;
let lastXKey = "";       // 자동 대조 중복 방지 키

const MAPS = {
  Baltic_Main: "Erangel", Desert_Main: "Miramar", Savage_Main: "Sanhok",
  DihorOtok_Main: "Vikendi", Tiger_Main: "Taego", Kiki_Main: "Deston",
  Neon_Main: "Rondo", Range_Main: "Camp Jackal", Summerland_Main: "Karakin",
  Chimera_Main: "Paramo", Heaven_Main: "Haven",
};
const mapName = (m) => MAPS[m] || m || "?";
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmt = (n) => (n ?? 0).toLocaleString();

function renderMeta(m) {
  const when = m.generatedAt ? new Date(m.generatedAt).toLocaleString("ko-KR") : "-";
  document.getElementById("meta").innerHTML =
    `<div>이벤트 <b>${esc(m.event || "-")}</b></div>` +
    `<div>갱신 <b>${esc(when)}</b></div>` +
    `<div>배점 <b>${esc(m.pointsRule || "-")}</b></div>`;
  const banner = document.getElementById("banner");
  // 배점·타이브레이크는 공식(SUPER) 반영. 단 운영 2차가공(보상점 CP·패널티·어드밴티지)은
  // API로 알 수 없어 미반영 → 공식 최종 순위와 다를 수 있음을 명시.
  banner.innerHTML = "⚠️ 참고 — 배점·동점처리는 <b>공식 SUPER 규정</b> 반영. 다만 운영 " +
    "<b>2차가공(보상점 CP·패널티·어드밴티지)</b>은 미반영이라 공식 최종 순위와 다를 수 있습니다.";
}

const phase = () => (DATA.phases || [])[curPhase] || { days: [], total: { teams: [], players: [] } };

function renderPhaseButtons() {
  document.getElementById("phases").innerHTML = (DATA.phases || []).map((p, i) => {
    const empty = !p.matchCount;
    return `<button role="tab" aria-selected="${i === curPhase}" ${empty ? "disabled title='아직 경기 없음'" : ""}
      onclick="setPhase(${i})">${esc(p.name)}${empty ? " <small>(예정)</small>" : ` <small>(${p.matchCount})</small>`}</button>`;
  }).join("");
}

function curDay() {
  return curView === "total" ? null : (phase().days || []).find((d) => d.date === curView);
}

function renderDayButtons() {
  const btns = (phase().days || []).map((d) =>
    `<button role="tab" aria-selected="${curView === d.date}" onclick="setView('${d.date}')">
       ${esc(d.label)} <small>· ${esc(d.date.slice(5))} (${d.matchCount})</small></button>`);
  btns.push(`<button class="total" role="tab" aria-selected="${curView === "total"}"
      onclick="setView('total')">TOTAL</button>`);
  document.getElementById("days").innerHTML = btns.join("");
}

function renderMatchButtons() {
  const day = curDay();
  const box = document.getElementById("matches");
  if (!day) { box.innerHTML = ""; return; }
  const btns = [`<button role="tab" aria-selected="${curMatch === null}" onclick="setMatch(null)">당일 합산</button>`];
  (day.matches || []).forEach((mt) => {
    btns.push(`<button role="tab" aria-selected="${curMatch === mt.match_id}"
      onclick="setMatch('${mt.match_id}')">${mt.game}경기 <small>· ${esc(mapName(mt.map))}</small></button>`);
  });
  box.innerHTML = btns.join("");
}

function currentSet() {
  if (curView === "total") return { data: phase().total, isTotal: true };
  const day = curDay() || { teams: [], players: [], matches: [] };
  if (curMatch) {
    const mt = (day.matches || []).find((m) => m.match_id === curMatch);
    return { data: mt || { teams: [], players: [] }, isTotal: false, match: mt, day };
  }
  return { data: day, isTotal: false, day };
}

function hint(sel) {
  const el = document.getElementById("viewhint");
  const p = phase();
  const cut = p.advanceCut || 0;
  if (sel.isTotal) {
    el.innerHTML = `<b>${esc(p.name)} · 누적(TOTAL)</b> — 이 단계 전체 매치 합산`
      + (cut ? ` (점선 = 상위 <b>${cut}팀</b> 진출선).` : ".")
      + (p.matchCount ? "" : " <b>아직 경기가 없습니다.</b>");
  } else if (sel.match) {
    el.innerHTML = `<b>${esc(sel.day.label)} · ${sel.match.game}경기</b> — ${esc(mapName(sel.match.map))} 단일 경기 결과.`;
  } else {
    el.innerHTML = `<b>${esc(sel.day.label)} (${esc(sel.day.date)})</b> — 당일 경기만 합산.`;
  }
}

// Twire 대조: total 뷰에서 값이 다르면 Twire 값을 붉게 출력(우리값은 툴팁)
function xcCell(tag, field, ourVal, isTotal) {
  if (!(isTotal && TWIRE_PHASE === phase().key && Object.keys(TWIRE).length)) return fmt(ourVal);
  const w = TWIRE[tag];
  if (!w || w[field] === ourVal) return fmt(ourVal);
  return `<span class="diff" title="우리 계산: ${fmt(ourVal)} · Twire 기준으로 표시">${fmt(w[field])}</span>`;
}

// 태그 → 공식 풀네임 (없으면 태그 그대로)
function fullName(tag) {
  return ((DATA.meta || {}).teamNames || {})[tag] || tag;
}

function teamsTable(teams, isTotal) {
  const cut = isTotal ? (phase().advanceCut || 0) : 0;
  if (!teams.length) return `<table><tbody><tr><td style="padding:24px;color:var(--muted)">데이터 없음</td></tr></tbody></table>`;
  let out = "";
  teams.forEach((t) => {
    const cls = t.standing <= 3 ? ` class="top${t.standing}"` : "";
    const adjList = t.adjustments || [];
    const adjSum = adjList.reduce((s, a) => s + a.points, 0);
    const adjBadge = adjSum
      ? ` <span class="adj" title="${esc(adjList.map((a) => `${a.points > 0 ? "+" : ""}${a.points} ${a.reason}`).join("; "))}">(${adjSum > 0 ? "+" : ""}${adjSum})</span>`
      : "";
    out += `<tr${cls}>
      <td class="rank">${t.standing}</td>
      <td class="fullname">${esc(fullName(t.tag))}</td>
      <td class="tag">${esc(t.tag)}</td>
      <td class="num">${fmt(t.matches)}</td>
      <td class="num">${fmt(t.placement_points)}</td>
      <td class="num">${xcCell(t.tag, "kills", t.kill_points, isTotal)}</td>
      <td class="total">${xcCell(t.tag, "total", t.total, isTotal)}${adjBadge}</td>
      <td class="num">${fmt(t.wins)}</td>
      <td class="players">${esc((t.players || []).join(", "))}</td>
    </tr>`;
    if (cut && t.standing === cut) {
      out += `<tr class="cutline"><td colspan="9"><div>▲ 진출 (상위 ${cut}) ㆍ 탈락 ▼</div></td></tr>`;
    }
  });
  return `<table class="tbl-team"><thead><tr>
    <th>#</th><th>팀명</th><th>태그</th><th>경기</th><th>순위P</th><th>킬P</th><th>총점</th><th>WWCD</th><th>선수</th>
  </tr></thead><tbody>${out}</tbody></table>`;
}

function playersTable(players) {
  if (!players.length) return `<table><tbody><tr><td style="padding:24px;color:var(--muted)">데이터 없음</td></tr></tbody></table>`;
  const rows = players.slice(0, 60).map((p, i) => `<tr>
    <td class="rank">${i + 1}</td>
    <td class="tag">${esc(p.name)}</td>
    <td class="num total">${fmt(p.kills)}</td>
    <td class="num">${fmt(p.damageDealt)}</td>
    <td class="num">${fmt(p.assists)}</td>
    <td class="num">${fmt(p.matches)}</td>
    <td class="num">${fmt(p.wwcd)}</td>
    <td>${esc(p.tag)}</td>
  </tr>`).join("");
  return `<table class="tbl-player"><thead><tr>
    <th>#</th><th>선수</th><th>킬</th><th>데미지</th><th>어시</th><th>경기</th><th>WWCD</th><th>팀</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function render() {
  if (!DATA) return;
  renderPhaseButtons();
  renderDayButtons();
  renderMatchButtons();
  document.getElementById("tab-teams").setAttribute("aria-selected", curTab === "teams");
  document.getElementById("tab-players").setAttribute("aria-selected", curTab === "players");
  const sel = currentSet();
  hint(sel);
  document.getElementById("view").innerHTML =
    curTab === "teams" ? teamsTable(sel.data.teams || [], sel.isTotal) : playersTable(sel.data.players || []);
}

// --- 엑셀/CSV 다운로드 -------------------------------------------------
function fileLabel() {
  const p = phase();
  if (curView === "total") return `${p.name}_TOTAL`;
  const d = curDay();
  if (curMatch) {
    const mt = (d.matches || []).find((m) => m.match_id === curMatch);
    return `${p.name}_${d.label}${mt ? "_" + mt.game + "경기" : ""}`;
  }
  return `${p.name}_${d ? d.label : ""}`;
}
const sanitize = (s) => String(s).replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

function downloadResults() {
  if (!DATA) return;
  const sel = currentSet();
  const teams = sel.data.teams || [];
  const players = sel.data.players || [];
  if (!teams.length && !players.length) { alert("이 뷰에는 다운로드할 데이터가 없습니다."); return; }

  const teamHeader = ["순위", "팀", "총점", "순위P", "킬P", "경기", "WWCD", "최고순위", "평균순위", "선수"];
  const teamRows = teams.map((t) => [t.standing, t.tag, t.total, t.placement_points, t.kill_points, t.matches, t.wins, t.best_rank, t.avg_rank, (t.players || []).join(", ")]);
  const playerHeader = ["순위", "선수", "킬", "데미지", "어시", "경기", "WWCD", "팀"];
  const playerRows = players.map((p, i) => [i + 1, p.name, p.kills, p.damageDealt, p.assists, p.matches, p.wwcd, p.tag]);
  const base = sanitize(`${DATA.meta.event || "leaderboard"}_${fileLabel()}`);

  // CSV 폴백 (현재 탭, UTF-8 BOM → 엑셀에서 한글 정상)
  function csvDownload() {
    const header = curTab === "teams" ? teamHeader : playerHeader;
    const rows = curTab === "teams" ? teamRows : playerRows;
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = base + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  try {
    if (!window.XLSX) throw new Error("XLSX 라이브러리 미로딩");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([teamHeader, ...teamRows]), "팀 순위");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([playerHeader, ...playerRows]), "선수");
    XLSX.writeFile(wb, base + ".xlsx");
  } catch (e) {
    try {
      csvDownload();  // xlsx 실패 시 CSV로 폴백
    } catch (e2) {
      alert("다운로드 실패: " + ((e2 && e2.message) || e2));
    }
  }
}

// --- Twire 교차검증 -----------------------------------------------------
const TWIRE_Q = "query PlatformLeaderboard($tournament: String!, $game: String!){ platformLeaderboard(tournament:$tournament, game:$game){ numberOfMatches leaderboard{ team totalPoints kills players } } }";

function twTag(players) {
  const c = {};
  (players || []).forEach((p) => { if (p && p.includes("_")) { const t = p.split("_")[0]; c[t] = (c[t] || 0) + 1; } });
  let best = "?", n = 0;
  for (const k in c) if (c[k] > n) { n = c[k]; best = k; }
  return best;
}

function setXStatus(text, cls) {
  const el = document.getElementById("xstatus");
  if (el) { el.className = "xstatus " + cls; el.textContent = text; }
}

async function crossCheck(manual) {
  const p = phase();
  const meta = DATA.meta || {};
  const tw = meta.twire, tour = p.twireTournament;
  lastXKey = curPhase + "|" + (meta.generatedAt || "");
  if (!tw || !tour) {
    TWIRE = {}; TWIRE_PHASE = p.key;
    setXStatus("이 단계는 Twire 대조 대상이 없습니다 (예: 파이널 미시작).", "muted");
    render(); return;
  }
  setXStatus("Twire 대조 중…", "muted");
  try {
    const res = await fetch(tw.endpoint, {
      method: "POST",
      headers: { "x-api-key": tw.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query: TWIRE_Q, variables: { tournament: tour, game: "pubg" } }),
    });
    const j = await res.json();
    const lb = j.data && j.data.platformLeaderboard;
    if (!lb || !lb.leaderboard) throw new Error("Twire 응답에 데이터 없음");
    const map = {};
    lb.leaderboard.forEach((x) => { map[twTag(x.players)] = { total: x.totalPoints || 0, kills: x.kills || 0 }; });
    TWIRE = map; TWIRE_PHASE = p.key; TWIRE_MATCHES = lb.numberOfMatches;
    const ours = p.total.teams;
    let diff = 0, missing = 0;
    ours.forEach((t) => { const w = map[t.tag]; if (!w) { missing++; return; } if (w.total !== t.total || w.kills !== t.kills) diff++; });
    if (diff === 0 && missing === 0) {
      setXStatus(`✅ 이상 없음 — Twire와 일치 (${ours.length}팀 · ${TWIRE_MATCHES}경기 기준)`, "ok");
    } else {
      setXStatus(`⚠️ Twire와 차이 ${diff}팀${missing ? ` (Twire에 없는 ${missing}팀)` : ""} — 붉은 값 = Twire 기준 · Twire ${TWIRE_MATCHES}경기 vs 우리 ${p.matchCount}경기`, "warn");
    }
    render();
  } catch (e) {
    TWIRE = {}; TWIRE_PHASE = p.key;
    setXStatus("Twire 대조 실패: " + ((e && e.message) || e) + " — 버튼으로 재시도", "warn");
    render();
  }
}

function maybeCrossCheck() {
  if (!DATA) return;
  const k = curPhase + "|" + ((DATA.meta || {}).generatedAt || "");
  if (k !== lastXKey) crossCheck(false);
}

function setPhase(i) { curPhase = i; curView = "total"; curMatch = null; render(); maybeCrossCheck(); }
function setView(v) { curView = v; curMatch = null; render(); }
function setMatch(id) { curMatch = id; render(); }
function setTab(t) { curTab = t; render(); }

async function load() {
  try {
    const res = await fetch("leaderboard.json?_=" + Date.now());
    if (!res.ok) throw new Error("leaderboard.json " + res.status);
    DATA = await res.json();
    if (!(DATA.phases || [])[curPhase]) curPhase = 0;
    const days = phase().days || [];
    if (curView !== "total" && !days.some((d) => d.date === curView)) { curView = "total"; curMatch = null; }
    renderMeta(DATA.meta || {});
    render();
    maybeCrossCheck();   // 데이터 불러온 순간 Twire와 자동 대조 (새 데이터일 때만)
  } catch (e) {
    document.getElementById("view").innerHTML =
      `<div class="err">데이터를 불러오지 못했습니다: ${esc(e.message)}<br>` +
      `폴러를 먼저 실행하세요: <code>py -m src.poll --once</code></div>`;
  }
}

load();
setInterval(load, 60000); // 1분마다 새 데이터 자동 반영
