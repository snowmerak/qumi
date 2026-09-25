# Qumi

Q Gateway에 연결하는 Chrome Manifest V3 사이드 패널 확장입니다. Gateway 연결과 모델 선택, 스트리밍 채팅, 도구 호출을 처리할 수 있는 TypeScript 에이전트 루프, 긴 문맥 압축을 제공합니다. UI는 `merak-protocol-design-system`의 CSS를 사용합니다.

## 실행

1. Q에서 `q gateway start`를 실행하고 출력된 `http://127.0.0.1:<port>/v1` 주소를 확인합니다. API 키를 설정했다면 키도 준비합니다.
2. 이 디렉터리에서 `pnpm install`과 `pnpm build`를 실행합니다.
3. Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 `dist` 폴더를 압축 해제된 확장 프로그램으로 로드합니다.
4. Qumi 아이콘을 클릭해 사이드 패널을 열고 Gateway 주소, API 키(필요할 때만), 모델을 설정합니다. 모델 목록에 문맥 길이가 없으면 토큰 수를 직접 입력합니다.

Q Gateway는 기본적으로 임의의 로컬 포트를 사용하므로 확장에 포트를 고정하지 않았습니다. 현재 확장은 `127.0.0.1`과 `localhost`의 HTTP(S) Gateway만 허용합니다. 설정과 대화, API 키는 Chrome의 로컬 확장 저장소에 저장됩니다.

## 개발

```powershell
pnpm install
pnpm dev
pnpm test
pnpm build
```

`pnpm dev`는 UI 미리보기용입니다. Gateway와의 실제 연결은 Chrome에 로드한 `dist` 확장에서 확인하세요. 확장은 `POST /v1/chat/completions`의 SSE 스트림을 사용하고, 스트림이 지원되지 않으면 일반 JSON 응답을 처리합니다. 완료된 턴의 `conversation_id`와 압축 문맥을 다음 요청에 사용합니다. 문맥이 한도에 가까워지면 이전 기록을 체크포인트로 요약하고, 전체 대화 기록은 따로 보존합니다.

현재 화면에서는 브라우저 도구를 등록하지 않았습니다. 루프는 도구 호출·결과 전달을 지원하지만 현재 페이지 읽기나 클릭은 아직 실행하지 않습니다. 설정과 전체 대화 기록은 Chrome의 `storage.local`에 저장되므로 매우 긴 대화는 저장소 용량 한도에 닿을 수 있습니다.

개발 스크립트는 Node.js 24 이상에서 확인했습니다.

브라우저 안에서 동작하는 작은 도우미의 남은 기능 범위와 공수는 [에이전트 루프 검토](docs/browser-agent-loop-estimate.md)에 정리했습니다.
