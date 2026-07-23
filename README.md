# PUBG Esports — Live Match Leaderboard

PUBG Esports 대회(EWC 2026 등)의 경기 종료 직후 **순위/킬/포인트**를 집계해 보여주는 정적 대시보드.
단계(Group Stage / Final) → DAY / TOTAL → 경기별로 드릴다운.

- **수집**: GitHub Actions가 주기적으로 PUBG API를 폴링해 `web/leaderboard.json` 갱신 (키는 repo Secret).
- **열람**: GitHub Pages가 `web/`을 정적 배포 → 공개 URL로 어디서든 열람.

## 로컬 실행

```bash
export PUBG_API_KEY=...            # 또는 .env 파일 (gitignore됨)
python -m src.poll --once          # 외부 의존성 없음 (Python 3.10+ stdlib)
python -m http.server 8000 --directory web   # http://localhost:8000
```

## 배포 (GitHub Actions + Pages)

1. 이 레포를 **public**으로 둔다.
2. Settings → Secrets and variables → Actions → `PUBG_API_KEY` 등록.
3. Settings → Pages → Deploy from a branch → `main` / `/web`.
4. Actions → `poll-leaderboard` → Run workflow (이후 10분마다 자동).

## 대회 전환

`config/<event>.json`이 단계·소속 tournament ID·배점·진출선을 정의한다.
사용 가능한 대회 ID 확인: `python -m src.poll --list`.
워크플로의 `EVENT_CONFIG` 를 새 설정으로 바꾸면 다른 대회로 전환된다.

## 유의

- **배점은 확정 전 placeholder** — 대시보드 상단 배너로 표기됨. 공식 룰 확정 시 `config/*.json` 교체.
- API 키를 커밋하거나 브라우저에 노출하지 않는다 (`.env` gitignore, Secret 사용).
