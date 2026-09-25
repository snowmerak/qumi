# Qumi

Q Gateway에 연결하는 Chrome Manifest V3 사이드 패널 확장입니다. Gateway 연결과 모델 선택, 스트리밍 채팅, 도구 호출을 처리할 수 있는 TypeScript 에이전트 루프, 긴 문맥 압축을 제공합니다. UI는 `merak-protocol-design-system`의 CSS를 사용합니다.

## 실행

1. Q에서 `q gateway start`를 실행하고 출력된 `http://127.0.0.1:<port>/v1` 주소를 확인합니다. API 키를 설정했다면 키도 준비합니다.
2. 이 디렉터리에서 `pnpm install`과 `pnpm build`를 실행합니다.
3. Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 `dist` 폴더를 압축 해제된 확장 프로그램으로 로드합니다.
4. 웹페이지에서 Qumi 아이콘을 클릭해 사이드 패널을 열고 Gateway 주소, API 키(필요할 때만), 모델을 설정합니다. 모델 목록에 문맥 길이가 없으면 토큰 수를 직접 입력합니다.
5. 일반 HTTP(S) 웹페이지를 열고 Qumi 사이드 패널의 `현재 페이지`에서 **연결**을 누릅니다. Chrome이 현재 사이트 접근 권한을 요청하면 허용합니다. 이 권한은 Chrome에 사이트 단위로 저장되며 확장 관리에서 나중에 철회할 수 있습니다. 페이지 질문을 하면 모델이 URL·제목·본문 읽기 도구를 호출할 수 있습니다. `dom_list`는 `body`부터 시작해 보이는 자식 요소와 고유 CSS 선택자를 반환하고, `dom_read`는 선택한 요소의 내용·직접 자식 텍스트 노드·속성을 읽습니다. `dom_write`는 `textNodeIndex`로 본문 문구를 바꾸고, 입력값과 허용된 HTML 속성도 변경합니다. 속성 제거에는 `value: null`을 사용합니다. `dom_write`와 `dom_click`은 사용자 확인 후 실행됩니다. URL 이동, 새 탭 열기, 기존 탭 전환도 목적지를 확인한 뒤 실행됩니다.

확장 코드를 다시 빌드한 뒤에는 `chrome://extensions`에서 Qumi의 **새로고침**을 누르고 사이드 패널을 다시 여세요. 특히 manifest 권한 변경은 확장 새로고침 전에는 적용되지 않습니다.

Q Gateway는 기본적으로 임의의 로컬 포트를 사용하므로 확장에 포트를 고정하지 않았습니다. 현재 확장은 `127.0.0.1`과 `localhost`의 HTTP(S) Gateway만 허용합니다. 설정과 대화, API 키는 Chrome의 로컬 확장 저장소에 저장됩니다.

## 개발

```powershell
pnpm install
pnpm dev
pnpm test
pnpm build
```

`pnpm dev`는 UI 미리보기용입니다. Gateway와의 실제 연결은 Chrome에 로드한 `dist` 확장에서 확인하세요. 확장은 `POST /v1/chat/completions`의 SSE 스트림을 사용하고, 스트림이 지원되지 않으면 일반 JSON 응답을 처리합니다. Gateway가 thinking을 스트리밍하면 답변이 시작되기 전까지 사이드 패널에 보여 주고, 최종 답변이 시작되면 숨깁니다. thinking은 대화 기록에 저장하지 않습니다. 완료된 턴의 `conversation_id`와 압축 문맥을 다음 요청에 사용합니다. 문맥이 한도에 가까워지면 이전 기록을 체크포인트로 요약하고, 전체 대화 기록은 따로 보존합니다.

브라우저 도구는 현재 연결한 탭에만 묶입니다. 탭이나 주소가 바뀌면 다시 연결해야 하며 `chrome://` 같은 제한 페이지와 교차 출처 iframe은 읽을 수 없습니다. 페이지 읽기는 본문·선택 텍스트·일부 링크를 제한된 크기로 가져옵니다. DOM 도구도 보이는 요소에만 접근하고, 쓰기와 클릭은 대상 CSS 선택자가 요소 하나와 일치해야 합니다. 본문 수정은 직접 자식 텍스트 노드 하나씩 처리하여 하위 요소와 마크업을 보존하며, 페이지가 자체적으로 다시 렌더링하면 수정 내용이 사라질 수 있습니다. 속성 변경은 `id`, `class`, `title`, `role`, `lang`, `dir`, `hidden`, `disabled`, `readonly`, `required`, `placeholder`, `alt`, `tabindex`, `aria-*`, `data-*`에 한정합니다. URL·이벤트 핸들러·스타일 속성과 비밀번호·파일 입력은 쓰지 않습니다. 같은 창의 기존 탭 목록을 보여 주기 위해 확장은 `tabs` 권한으로 탭의 URL과 제목에 접근합니다. 설정과 전체 대화 기록은 Chrome의 `storage.local`에 저장되므로 매우 긴 대화는 저장소 용량 한도에 닿을 수 있습니다.

개발 스크립트는 Node.js 24 이상에서 확인했습니다.

브라우저 안에서 동작하는 작은 도우미의 남은 기능 범위와 공수는 [에이전트 루프 검토](docs/browser-agent-loop-estimate.md)에 정리했습니다.
