"""PUBG Developer API 클라이언트 (stdlib만 사용 — 배포/Actions에서 의존성 0).

핵심 엔드포인트 (docs/pubg_api_notes.md 실측 기준):
  - GET /tournaments/{id}                      대회의 매치 목록 (리밋 카운트됨)
  - GET /shards/{shard}/matches/{id}           매치 상세 (리밋 제외)

레이트리밋: 기본 10 req/분. 429 시 X-Ratelimit-Reset(epoch) 또는 Retry-After를 존중해 대기.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

API_BASE = "https://api.pubg.com"


class PubgApiError(RuntimeError):
    pass


class PubgClient:
    def __init__(self, api_key: str, shard: str = "tournament", max_retries: int = 5):
        if not api_key:
            raise PubgApiError("PUBG_API_KEY 가 비어 있습니다 (.env 확인).")
        self._key = api_key
        self.shard = shard
        self.max_retries = max_retries

    # --- low level -------------------------------------------------------
    def _get(self, url: str) -> dict:
        headers = {
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/vnd.api+json",
        }
        last_err: Exception | None = None
        for attempt in range(self.max_retries):
            req = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code == 429:  # rate limited — 초 단위로 대기 후 재시도
                    wait = self._retry_after(e) or (2 ** attempt)
                    time.sleep(min(wait, 60))
                    last_err = e
                    continue
                body = e.read().decode("utf-8", "replace")[:300]
                raise PubgApiError(f"HTTP {e.code} for {url}\n{body}") from e
            except urllib.error.URLError as e:  # 네트워크 일시 오류
                last_err = e
                time.sleep(2 ** attempt)
        raise PubgApiError(f"재시도 초과 ({self.max_retries}) for {url}: {last_err}")

    @staticmethod
    def _retry_after(e: urllib.error.HTTPError) -> float | None:
        ra = e.headers.get("Retry-After")
        if ra and ra.isdigit():
            return float(ra)
        reset = e.headers.get("X-Ratelimit-Reset")
        if reset and reset.isdigit():
            return max(0.0, float(reset) - time.time()) + 1.0
        return None

    # --- endpoints -------------------------------------------------------
    def get_tournament_matches(self, tournament_id: str) -> list[dict]:
        """대회의 매치 목록을 [{'id','createdAt'}] 로 반환 (createdAt 오름차순)."""
        d = self._get(f"{API_BASE}/tournaments/{tournament_id}")
        matches = [
            {"id": x["id"], "createdAt": x["attributes"].get("createdAt")}
            for x in d.get("included", [])
            if x.get("type") == "match"
        ]
        matches.sort(key=lambda m: m["createdAt"] or "")
        return matches

    def get_match(self, match_id: str) -> dict:
        """매치 상세 원본 JSON. (이 엔드포인트는 레이트리밋에서 제외됨)"""
        return self._get(f"{API_BASE}/shards/{self.shard}/matches/{match_id}")

    def list_tournaments(self) -> list[dict]:
        d = self._get(f"{API_BASE}/tournaments")
        return [
            {"id": x["id"], "createdAt": x["attributes"].get("createdAt")}
            for x in d.get("data", [])
            if x.get("type") == "tournament"
        ]
