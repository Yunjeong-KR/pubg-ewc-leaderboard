"""포인트 규칙 로딩·계산. 배점표는 대회마다 다르므로 config/*.json 으로 분리한다."""
from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass
class PointsRules:
    name: str
    placement_points: dict[int, int]
    kill_points_per_kill: int
    tag_from: str = "name_prefix"
    tag_separator: str = "_"

    def placement(self, rank: int) -> int:
        return int(self.placement_points.get(rank, 0))

    def kills(self, kills: int) -> int:
        return int(kills) * self.kill_points_per_kill

    @classmethod
    def from_dict(cls, raw: dict) -> "PointsRules":
        tag = raw.get("team_tag", {})
        return cls(
            name=raw.get("name", "unnamed"),
            placement_points={int(k): int(v) for k, v in raw.get("placement_points", {}).items()},
            kill_points_per_kill=int(raw.get("kill_points_per_kill", 1)),
            tag_from=tag.get("from", "name_prefix"),
            tag_separator=tag.get("separator", "_"),
        )


def load_points(path: str) -> PointsRules:
    with open(path, encoding="utf-8") as f:
        return PointsRules.from_dict(json.load(f))
