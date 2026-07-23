# 운영 런북 (집에서 · 브라우저만으로)

대회 중 Claude/터미널 없이 **웹 브라우저만으로** 대시보드를 운영·대응하는 법.
라이브: **https://yunjeong-kr.github.io/pubg-ewc-leaderboard/** · 레포: **github.com/Yunjeong-KR/pubg-ewc-leaderboard**

> 대전제: 데이터는 GitHub Actions가 **10분마다 자동 폴링**해 배포한다. 아래는 "즉시 하고 싶을 때" 또는 "전환할 때"만 필요.

---

## 1. 지금 당장 최신화하고 싶을 때 (수동 갱신)
경기가 방금 끝났는데 10분 기다리기 싫다면:
1. 레포 → **Actions** 탭
2. 왼쪽 **poll-leaderboard** → **Run workflow** 버튼 → Run
3. 1~2분 뒤 대시보드 새로고침(Ctrl+Shift+R)

## 2. Twire 대조 (보조 검증)
대시보드에서 자동으로 Twire와 대조된다.
- **초록 "✅ 이상 없음"** = Twire와 일치 (정상).
- **붉은 값 / "⚠️ Twire와 차이"** = 그 팀 수치가 Twire와 다름. 붉은 숫자가 **Twire 기준값**(우리값은 마우스 올리면 툴팁).
  - 대개 **Twire가 아직 최신 경기를 반영 못 한 것**(상태바에 'Twire N경기 vs 우리 M경기'로 표시됨). 잠시 후 **🔄 Twire 대조** 버튼 클릭 → 재확인.
  - 그래도 계속 다르면 실제 불일치 가능 → 확인 필요.

## 3. 파이널 시작(7/24) 시 전환 — 브라우저만으로
파이널은 지금 "예정"으로 비어 있다. 파이널이 시작되면:

**① 필요한 값 찾기** — 레포 → Actions → **discover** → Run workflow → 실행 로그 열기:
- "PUBG 대회 ID 목록"에서 **파이널 대회 ID** 찾기 (예: `eu-ewc26fs` 같은 것 — 그룹스테이지 `eu-ewc26gs`와 형제. 날짜가 7/24~인 것).
- "Twire 라운드값"에서 파이널 라운드의 **`twireTournament = ...`** 줄 복사.

**② config 편집** — 레포에서 `config/ewc2026.json` 열기 → 우측 연필(✏️) 아이콘 → `final` 부분 수정:
```json
{
  "key": "final", "name": "Final", "advance_cut": 0,
  "tournaments": ["여기에_파이널_PUBG_ID"],
  "adjustments": [],
  "twireTournament": "여기에_discover가_알려준_문자열"
}
```
→ 아래 **Commit changes** (main에 직접). 1~2분 뒤 자동 배포 → 파이널 탭 활성화.

> 파이널은 **SMASH 룰**: Day2 후 1위 +10점. 이건 자동계산 안 되니 아래 4번(수동 보정)으로 넣는다.

## 4. 수동 보정 넣기 (패널티 / 보상점 CP / 어드밴티지)
API로 못 받는 운영 확정값을 반영할 때. `config/ewc2026.json`의 해당 phase `adjustments`에 추가(웹 편집 → Commit):
```json
"adjustments": [
  { "tag": "GEN", "points": -10, "reason": "규정외 스킨" },
  { "tag": "VP",  "points": 10,  "reason": "Day2 1위 어드밴티지(SMASH)" }
]
```
- `tag` = 대시보드에 보이는 팀 태그(예: `VP`, `GEN`). `points` = +가점/−감점. `reason` = 사유(툴팁 표시).
- 반영되면 총점 재계산·재정렬되고, 총점 옆에 **(±N) 배지**가 뜬다. 비우면 순수 SUPER 계산값.

## 5. 대회 자체를 바꿀 때 (예: 2026 PGS)
- `config/` 에 새 이벤트 파일 추가(`pgs2026.json`), 워크플로 `poll.yml`·`discover.yml`의 `EVENT_CONFIG` 를 그 파일로 변경. 대회 ID는 discover(1·3번)로 확인.

---

## 문제 대응 빠른 참고
- **대시보드가 안 뜬다** → Actions 최근 실행이 실패인지 확인. 실패해도 이전 배포는 유지됨(과거 데이터 보임).
- **숫자가 이상하다** → Twire 대조(2번)로 교차 확인. 배점·동점처리는 공식 SUPER(문서 `scoring_rules.md`).
- **키 관련** → PUBG 키는 repo Secret `PUBG_API_KEY`. 만료 없음. 노출/커밋 금지.
- 상세 배포 구조는 `docs/deployment.md`, 채점 규정은 `docs/scoring_rules.md`.
