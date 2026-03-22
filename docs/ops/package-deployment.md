# 패키지 수정 → 배포 → 에이전트 업데이트 체크리스트

> **핵심 원칙:** 코드 수정 → publish → install → 프로세스 재시작은 **한 세트**다. 하나라도 빠지면 구버전이 돈다.

## 체크리스트

### 1. 코드 수정 & 검증
- [ ] 소스 수정
- [ ] `pnpm build` 성공
- [ ] `npx @biomejs/biome lint --diagnostic-level=error` 통과
- [ ] `as any` 미사용 확인

### 2. 버전 bump & publish
- [ ] `package.json` 버전 올리기 (patch/minor/major)
- [ ] `pnpm build` (publish 전 최종 빌드)
- [ ] `npm publish` (또는 `pnpm publish`)
- [ ] npm registry에서 새 버전 확인: `npm view @sena-ai/<패키지명> version`

### 3. 커밋 & 푸시
- [ ] 변경사항 커밋
- [ ] `git push`

### 4. 에이전트별 종속성 업데이트
각 에이전트 워크스페이스에서:
```bash
# 예시: sena 에이전트
cd ~/agents/sena
pnpm update @sena-ai/<패키지명>
# 또는 특정 버전 지정
pnpm install @sena-ai/<패키지명>@latest
```

대상 에이전트 목록:
- `~/agents/sena` (세나)
- `~/agents/lumie` (루미)
- `~/agents/sooki` (수키)
- 기타 해당 패키지를 사용하는 에이전트

### 5. 프로세스 재시작
```bash
# 각 에이전트의 restart.js 실행
node ~/agents/<에이전트>/restart.js
```

- [ ] lumie 재시작 완료
- [ ] sooki 재시작 완료
- [ ] sena 재시작 완료 (자기 자신은 마지막에)

### 6. 동작 검증
- [ ] 수정한 기능이 실제로 반영됐는지 테스트
- [ ] 각 에이전트가 새 버전을 로드하고 있는지 확인

## 흔한 실수

| 실수 | 증상 | 원인 |
|------|------|------|
| publish 안 함 | 코드 고쳤는데 에이전트가 구버전 동작 | npm registry에 새 버전이 안 올라감 |
| install만 하고 재시작 안 함 | node_modules는 업데이트됐는데 구버전 동작 | 기존 프로세스가 구 코드를 메모리에 물고 있음 |
| 자기 자신(sena) 재시작 누락 | 다른 에이전트는 되는데 자기만 구버전 | 자기 프로세스도 재시작해야 새 코드 로드 |

## 사고 기록

### 2026-03-22: @sena-ai/tools-slack 이미지 다운로드 버그 수정
- **문제:** slack_download_file이 이미지 바이너리를 `response.text()`로 읽어서 데이터 깨짐
- **수정:** `response.arrayBuffer()` + base64 인코딩 + `type: 'image'` 반환으로 변경
- **교훈:** 코드 수정 후 npm publish를 빠뜨려서 에이전트 3개가 전부 구버전으로 동작. publish → install → 재시작을 한 세트로 체크해야 함.
