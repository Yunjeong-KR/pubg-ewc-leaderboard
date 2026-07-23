"""폴링러 CLI — 대회를 단계(Phase)별로 수집·집계해 web/leaderboard.json 을 생성한다.

이벤트 설정(config/*.json)이 단계 구조를 정의한다:
  phases[] → 각 단계(Group Stage / Final)마다 tournament ID + 진출선(advance_cut)
  각 단계 안에서 DAY별 + TOTAL(그 단계 누적) 리더보드가 만들어지고, DAY 안엔 경기별 뷰가 들어간다.

    py -m src.poll --once                       # config/ewc2026.json 로 1회 실행
    py -m src.poll --event config/pgs2026.json --once
    py -m src.poll --list                       # 사용 가능한 대회 ID 목록 (ID 찾기/교정)
    py -m src.poll --tournament eu-ewc26gs --once   # 단일 대회 애드혹(단계 1개) 실행

매치 상세는 immutable + 레이트리밋 제외라, raw_matches/ 에 캐시해 재호출을 피한다(완료 경기 재폴링 X).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import time

from .leaderboard import build_views, parse_match
from .pubg_client import PubgClient
from .scoring import PointsRules

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_dotenv(path: pathlib.Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def _resolve(path: str) -> pathlib.Path:
    return pathlib.Path(path) if os.path.isabs(path) else ROOT / path


def fetch_parsed(client: PubgClient, tournament_ids: list[str], rules: PointsRules,
                 cache_dir: pathlib.Path, esports_only: bool) -> list[dict]:
    """대회 ID들의 매치를 (캐시 활용) 수집·파싱한다."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    parsed: list[dict] = []
    skipped = 0
    for tid in tournament_ids:
        matches = client.get_tournament_matches(tid)
        print(f"  [{tid}] 매치 {len(matches)}개", file=sys.stderr)
        for m in matches:
            cache_file = cache_dir / f"{m['id']}.json"
            if cache_file.exists():
                raw = json.loads(cache_file.read_text(encoding="utf-8"))
            else:
                raw = client.get_match(m["id"])
                cache_file.write_text(json.dumps(raw), encoding="utf-8")
            pm = parse_match(raw, rules)
            if esports_only and not (pm.get("gameMode") or "").startswith("esports"):
                skipped += 1
                continue
            parsed.append(pm)
    if skipped:
        print(f"    (비-esports 매치 {skipped}개 제외 — --all 로 포함 가능)", file=sys.stderr)
    return parsed


def build_event(client: PubgClient, cfg: dict, cache_dir: pathlib.Path,
                esports_only: bool, tz_offset: int) -> dict:
    rules = PointsRules.from_dict(cfg.get("points", {}))
    phases_out = []
    for ph in cfg.get("phases", []):
        print(f"[{ph.get('name', ph.get('key'))}]", file=sys.stderr)
        parsed = fetch_parsed(client, ph.get("tournaments", []), rules, cache_dir, esports_only)
        views = build_views(parsed, tz_offset_hours=tz_offset)
        phases_out.append({
            "key": ph.get("key"),
            "name": ph.get("name", ph.get("key")),
            "advanceCut": int(ph.get("advance_cut", 0)),
            "matchCount": len(parsed),
            "total": views["total"],
            "days": views["days"],
        })
    return {
        "meta": {
            "event": cfg.get("event", ""),
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "pointsRule": rules.name,
            "tzOffsetHours": tz_offset,
        },
        "phases": phases_out,
    }


def main(argv: list[str] | None = None) -> int:
    load_dotenv(ROOT / ".env")
    ap = argparse.ArgumentParser(description="PUBG Esports 리더보드 폴링러 (단계별)")
    ap.add_argument("--event", default=os.environ.get("EVENT_CONFIG", "config/ewc2026.json"),
                    help="이벤트 설정 JSON (단계·대회·배점). 기본 config/ewc2026.json")
    ap.add_argument("--tournament", default="",
                    help="애드혹: 이 대회 ID(콤마 구분)만 단일 단계로 실행 (--event 무시)")
    ap.add_argument("--shard", default=os.environ.get("PUBG_SHARD", "tournament"))
    ap.add_argument("--out", default="web/leaderboard.json")
    ap.add_argument("--cache-dir", default="raw_matches")
    ap.add_argument("--all", action="store_true", help="비-esports(워밍업 등) 매치도 포함")
    ap.add_argument("--tz", type=int, default=None, help="날짜 버킷 시간대 오프셋(시). 기본=설정값 또는 9(KST)")
    ap.add_argument("--once", action="store_true", help="1회 실행 후 종료")
    ap.add_argument("--interval", type=int, default=int(os.environ.get("POLL_INTERVAL_SEC", "60")))
    ap.add_argument("--list", action="store_true", help="사용 가능한 대회 ID 목록만 출력하고 종료")
    args = ap.parse_args(argv)

    client = PubgClient(os.environ.get("PUBG_API_KEY", ""), shard=args.shard)

    if args.list:  # 대회 ID 찾기/교정 (EWC / PGS 등 전환 시)
        for t in sorted(client.list_tournaments(), key=lambda x: x.get("createdAt") or "", reverse=True):
            print(f"{t['id']:<16} {t.get('createdAt','')}")
        return 0

    if args.tournament:  # 애드혹 단일 단계
        ids = [t.strip() for t in args.tournament.split(",") if t.strip()]
        cfg = {"event": f"ad-hoc: {','.join(ids)}",
               "points": json.loads(_resolve("config/ewc2026.json").read_text(encoding="utf-8"))["points"],
               "phases": [{"key": "adhoc", "name": ",".join(ids), "advance_cut": 0, "tournaments": ids}]}
    else:
        cfg = json.loads(_resolve(args.event).read_text(encoding="utf-8"))

    tz_offset = args.tz if args.tz is not None else int(cfg.get("tz_offset_hours", 9))
    out_path = _resolve(args.out)
    cache_dir = _resolve(args.cache_dir)

    def run_once() -> None:
        lb = build_event(client, cfg, cache_dir, esports_only=not args.all, tz_offset=tz_offset)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(lb, ensure_ascii=False, indent=2), encoding="utf-8")
        parts = []
        for ph in lb["phases"]:
            top = ph["total"]["teams"][0] if ph["total"]["teams"] else None
            days = "/".join(d["label"] for d in ph["days"])
            parts.append(f"{ph['name']}: 매치{ph['matchCount']} [{days}]"
                         + (f" 선두 {top['tag']} {top['total']}pt" if top else " (경기 없음)"))
        print(f"✅ {out_path.relative_to(ROOT)} — " + " | ".join(parts), file=sys.stderr)

    run_once()
    if args.once:
        return 0
    while True:  # 데몬 모드
        time.sleep(args.interval)
        try:
            run_once()
        except Exception as e:  # noqa: BLE001 — 데몬은 죽지 않고 계속
            print(f"⚠️ 폴링 오류(계속 진행): {e}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
