/* 정적 대시보드 — leaderboard.json 을 읽어 리더보드를 렌더한다.
   구조: { meta, phases:[{key,name,advanceCut,matchCount,total,days:[{date,label,matchCount,teams,players,matches:[...]}]}] }
   뷰 계층: Phase(Group Stage/Final) → DAY 1..N / TOTAL → 경기별(단일 매치).
   TOTAL 은 그 Phase 안에서만 누적된다. 백엔드/키 없음: Actions 가 갱신한 정적 JSON만 읽는다. */
let DATA = null;
let curPhase = 0;        // phases 인덱스
let curView = "total";   // "total" | "YYYY-MM-DD"
let curMatch = null;     // null(합산) | match_id
let curTab = "teams";    // "teams" | "players"

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
  banner.innerHTML = /placeholder/i.test(m.pointsRule || "")
    ? "⚠️ 비공식 — 순위 배점이 <b>확정 전 placeholder</b>입니다. 공식 EWC 점수와 다를 수 있습니다."
    : "";
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

function teamsTable(teams, isTotal) {
  const cut = isTotal ? (phase().advanceCut || 0) : 0;
  if (!teams.length) return `<table><tbody><tr><td style="padding:24px;color:var(--muted)">데이터 없음</td></tr></tbody></table>`;
  let out = "";
  teams.forEach((t) => {
    const cls = t.standing <= 3 ? ` class="top${t.standing}"` : "";
    out += `<tr${cls}>
      <td class="rank">${t.standing}</td>
      <td class="tag">${esc(t.tag)}</td>
      <td class="total">${fmt(t.total)}</td>
      <td class="num">${fmt(t.placement_points)}</td>
      <td class="num">${fmt(t.kill_points)}</td>
      <td class="num">${fmt(t.matches)}</td>
      <td class="num">${fmt(t.wins)}</td>
      <td class="num">${t.best_rank}</td>
      <td class="num">${t.avg_rank}</td>
      <td class="players">${esc((t.players || []).join(", "))}</td>
    </tr>`;
    if (cut && t.standing === cut) {
      out += `<tr class="cutline"><td colspan="10"><div>▲ 진출 (상위 ${cut}) ㆍ 탈락 ▼</div></td></tr>`;
    }
  });
  return `<table><thead><tr>
    <th>#</th><th>팀</th><th>총점</th><th>순위P</th><th>킬P</th>
    <th>경기</th><th>WWCD</th><th>최고</th><th>평균순위</th><th>선수</th>
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
  return `<table><thead><tr>
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

function setPhase(i) { curPhase = i; curView = "total"; curMatch = null; render(); }
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
  } catch (e) {
    document.getElementById("view").innerHTML =
      `<div class="err">데이터를 불러오지 못했습니다: ${esc(e.message)}<br>` +
      `폴러를 먼저 실행하세요: <code>py -m src.poll --once</code></div>`;
  }
}

load();
setInterval(load, 60000); // 1분마다 새 데이터 자동 반영
