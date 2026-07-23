"""매치 상세(JSON:API) → 팀/선수 리더보드 집계.

팀 식별자: roster 의 teamId 는 매치마다 바뀌는 슬롯 번호라 누적 집계에 못 쓴다.
esports 매치는 선수 인게임명이 `TAG_Player` 형태이므로 **이름 접두어(팀태그)** 를 안정적
팀 키로 사용한다 (config team_tag.separator). 접두어가 없으면 이름 전체를 태그로 둔다.
"""
from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from .scoring import PointsRules


def _tag_of(name: str, sep: str) -> str:
    if name and sep in name:
        return name.split(sep, 1)[0]
    return name or "UNKNOWN"


def _roster_tag(names: list[str], sep: str) -> str:
    """roster 내 4명의 이름에서 다수결로 팀태그를 뽑는다."""
    tags = [_tag_of(n, sep) for n in names if n]
    if not tags:
        return "UNKNOWN"
    return Counter(tags).most_common(1)[0][0]


def parse_match(match_json: dict, rules: PointsRules) -> dict:
    """단일 매치 → 팀별 결과. 반환: {match_id, createdAt, map, gameMode, teams:[...]}"""
    data = match_json["data"]
    attr = data["attributes"]
    inc = match_json.get("included", [])

    participants = {x["id"]: x["attributes"]["stats"] for x in inc if x["type"] == "participant"}
    rosters = [x for x in inc if x["type"] == "roster"]

    teams = []
    for r in rosters:
        rank = int(r["attributes"]["stats"].get("rank", 0))
        pids = [p["id"] for p in r["relationships"]["participants"]["data"]]
        players = []
        team_kills = 0
        for pid in pids:
            st = participants.get(pid, {})
            k = int(st.get("kills", 0))
            team_kills += k
            players.append({
                "name": st.get("name", "?"),
                "playerId": st.get("playerId"),
                "kills": k,
                "damageDealt": round(float(st.get("damageDealt", 0.0)), 1),
                "assists": int(st.get("assists", 0)),
                "winPlace": int(st.get("winPlace", rank)),
            })
        tag = _roster_tag([p["name"] for p in players], rules.tag_separator)
        placement_pts = rules.placement(rank)
        kill_pts = rules.kills(team_kills)
        teams.append({
            "tag": tag,
            "rank": rank,
            "kills": team_kills,
            "placement_points": placement_pts,
            "kill_points": kill_pts,
            "total": placement_pts + kill_pts,
            "won": rank == 1,
            "players": players,
        })
    teams.sort(key=lambda t: t["rank"])
    return {
        "match_id": data["id"],
        "createdAt": attr.get("createdAt"),
        "map": attr.get("mapName"),
        "gameMode": attr.get("gameMode"),
        "teams": teams,
    }


def aggregate(parsed_matches: list[dict]) -> dict:
    """여러 매치 결과 → 누적 팀/선수 리더보드."""
    teams: dict[str, dict] = defaultdict(lambda: {
        "tag": "", "total": 0, "placement_points": 0, "kill_points": 0,
        "kills": 0, "matches": 0, "wins": 0, "best_rank": 99, "_rank_sum": 0,
        "players": set(),
    })
    players: dict[str, dict] = defaultdict(lambda: {
        "playerId": "", "name": "", "tag": "",
        "kills": 0, "damageDealt": 0.0, "assists": 0, "matches": 0, "wwcd": 0,
    })

    # createdAt 순으로 처리 (선수 name/tag 는 최신값으로 갱신)
    for pm in sorted(parsed_matches, key=lambda m: m.get("createdAt") or ""):
        for t in pm["teams"]:
            agg = teams[t["tag"]]
            agg["tag"] = t["tag"]
            agg["total"] += t["total"]
            agg["placement_points"] += t["placement_points"]
            agg["kill_points"] += t["kill_points"]
            agg["kills"] += t["kills"]
            agg["matches"] += 1
            agg["wins"] += 1 if t["won"] else 0
            agg["best_rank"] = min(agg["best_rank"], t["rank"])
            agg["_rank_sum"] += t["rank"]
            for p in t["players"]:
                agg["players"].add(p["name"])
                pid = p["playerId"] or p["name"]
                pl = players[pid]
                pl["playerId"] = p["playerId"] or pid
                pl["name"] = p["name"]
                pl["tag"] = t["tag"]
                pl["kills"] += p["kills"]
                pl["damageDealt"] += p["damageDealt"]
                pl["assists"] += p["assists"]
                pl["matches"] += 1
                pl["wwcd"] += 1 if t["won"] else 0

    team_rows = []
    for agg in teams.values():
        m = agg["matches"] or 1
        team_rows.append({
            "tag": agg["tag"],
            "total": agg["total"],
            "placement_points": agg["placement_points"],
            "kill_points": agg["kill_points"],
            "kills": agg["kills"],
            "matches": agg["matches"],
            "wins": agg["wins"],
            "best_rank": agg["best_rank"],
            "avg_rank": round(agg["_rank_sum"] / m, 2),
            "players": sorted(agg["players"]),
        })
    team_rows.sort(key=lambda r: (-r["total"], -r["wins"], r["avg_rank"]))
    for i, r in enumerate(team_rows, 1):
        r["standing"] = i

    player_rows = list(players.values())
    for p in player_rows:
        p["damageDealt"] = round(p["damageDealt"], 1)
    player_rows.sort(key=lambda p: (-p["kills"], -p["damageDealt"]))

    return {"teams": team_rows, "players": player_rows}


def _day_key(created_at: str | None, tz_offset_hours: int) -> str:
    if not created_at:
        return "unknown"
    u = dt.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    return (u + dt.timedelta(hours=tz_offset_hours)).strftime("%Y-%m-%d")


def build_views(parsed_matches: list[dict], tz_offset_hours: int = 9) -> dict:
    """전체(total) + 날짜별(days) 리더보드를 함께 만든다.

    반환: {"total": {teams, players}, "days": [{date, matchCount, teams, players}, ...]}
    날짜는 createdAt(UTC)을 tz_offset_hours 만큼 이동한 로컬 달력일 기준(기본 KST +9).
    """
    days_map: dict[str, list] = defaultdict(list)
    for pm in parsed_matches:
        days_map[_day_key(pm.get("createdAt"), tz_offset_hours)].append(pm)

    days = []
    for i, date in enumerate(sorted(days_map), 1):
        pms = sorted(days_map[date], key=lambda m: m.get("createdAt") or "")
        v = aggregate(pms)
        matches = []
        for g, pm in enumerate(pms, 1):
            mv = aggregate([pm])  # 단일 매치도 같은 스키마로 집계
            matches.append({
                "game": g,
                "match_id": pm["match_id"],
                "createdAt": pm.get("createdAt"),
                "map": pm.get("map"),
                "gameMode": pm.get("gameMode"),
                "teams": mv["teams"],
                "players": mv["players"],
            })
        days.append({
            "date": date,
            "label": f"DAY {i}",
            "matchCount": len(pms),
            "teams": v["teams"],
            "players": v["players"],
            "matches": matches,
        })
    return {"total": aggregate(parsed_matches), "days": days}
