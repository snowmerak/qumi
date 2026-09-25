# Qumi

Q Gateway에 연결하는 Chrome Manifest V3 사이드 패널 확장입니다. 현재 골격은 Gateway 연결 설정, 모델 선택, 기본 채팅, 대화 이어가기를 제공합니다. UI는 `merak-protocol-design-system`의 CSS를 사용합니다.

## 실행

1. Q에서 `q gateway start`를 실행하고 출력된 `http://127.0.0.1:<port>/v1` 주소를 확인합니다. API 키를 설정했다면 키도 준비합니다.
2. 이 디렉터리에서 `pnpm install`과 `pnpm build`를 실행합니다.
3. Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 `dist` 폴더를 압축 해제된 확장 프로그램으로 로드합니다.
4. Qumi 아이콘을 클릭해 사이드 패널을 열고 Gateway 주소, API 키(필요할 때만), 모델을 설정합니다.

Q Gateway는 기본적으로 임의의 로컬 포트를 사용하므로 확장에 포트를 고정하지 않았습니다. 현재 확장은 `127.0.0.1`과 `localhost`의 HTTP(S) Gateway만 허용합니다. 설정과 대화, API 키는 Chrome의 로컬 확장 저장소에 저장됩니다.

## 개발

```powershell
pnpm install
pnpm dev
pnpm test
pnpm build
```

`pnpm dev`는 UI 미리보기용입니다. Gateway와의 실제 연결은 Chrome에 로드한 `dist` 확장에서 확인하세요. 확장은 `POST /v1/chat/completions`를 사용하며, Gateway가 돌려준 `conversation_id`와 이전 메시지를 다음 요청에 함께 보냅니다. 현재 페이지의 내용을 읽는 기능은 이 골격에 포함되지 않습니다.

개발 스크립트는 Node.js 24 이상에서 확인했습니다.
