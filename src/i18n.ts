export type Locale = "en" | "ko" | "ja" | "zh";
export type LanguagePreference = Locale | "auto";

const messages = {
  connected: { en: "Connected", ko: "연결됨", ja: "接続済み", zh: "已连接" },
  checking: { en: "Checking", ko: "확인 중", ja: "確認中", zh: "检查中" },
  disconnected: { en: "Disconnected", ko: "연결 안 됨", ja: "未接続", zh: "未连接" },
  annotation: { en: "<Note {number}>", ko: "<주석 {number}>", ja: "<注記 {number}>", zh: "<注释 {number}>" },
  removeAnnotation: { en: "Remove note {number}", ko: "주석 {number} 제거", ja: "注記 {number} を削除", zh: "移除注释 {number}" },
  regionText: { en: "Selected text", ko: "영역의 텍스트", ja: "選択範囲のテキスト", zh: "选定区域的文本" },
  regionHtml: { en: "Selected HTML", ko: "영역의 HTML", ja: "選択範囲の HTML", zh: "选定区域的 HTML" },
  attachmentTruncated: { en: " · truncated", ko: " · 길이 제한으로 일부만 첨부됨", ja: " · 長さ制限により一部のみ添付", zh: " · 因长度限制仅附加部分内容" },
  backToChat: { en: "Back to chat", ko: "채팅으로 돌아가기", ja: "チャットに戻る", zh: "返回聊天" },
  settingsTitle: { en: "Qumi settings", ko: "Qumi 설정", ja: "Qumi の設定", zh: "Qumi 设置" },
  settingsIntro: { en: "Configure Q Gateway and browser action confirmations.", ko: "Q Gateway 연결과 브라우저 작업 확인 방식을 설정하세요.", ja: "Q Gateway 接続とブラウザー操作の確認方法を設定します。", zh: "配置 Q Gateway 连接和浏览器操作确认方式。" },
  language: { en: "Language", ko: "언어", ja: "言語", zh: "语言" },
  languageAuto: { en: "Automatic (browser language)", ko: "자동 (브라우저 언어)", ja: "自動（ブラウザーの言語）", zh: "自动（浏览器语言）" },
  languageHint: { en: "Applies immediately. Chinese uses Simplified Chinese.", ko: "즉시 적용됩니다. 중국어는 간체를 사용합니다.", ja: "すぐに適用されます。中国語は簡体字です。", zh: "立即生效。中文使用简体。" },
  gatewayUrlHint: { en: "Connects to a local Q Gateway.", ko: "현재는 로컬 Q Gateway에 연결합니다.", ja: "ローカルの Q Gateway に接続します。", zh: "连接到本地 Q Gateway。" },
  apiKeyOptional: { en: "API key (optional)", ko: "API 키 (선택)", ja: "API キー（任意）", zh: "API 密钥（可选）" },
  hideApiKey: { en: "Hide API key", ko: "API 키 숨기기", ja: "API キーを隠す", zh: "隐藏 API 密钥" },
  showApiKey: { en: "Show API key", ko: "API 키 보기", ja: "API キーを表示", zh: "显示 API 密钥" },
  apiKeyHint: { en: "Enter a key only if Q Gateway requires one.", ko: "Q Gateway에 인증 키를 설정한 경우에만 입력하세요.", ja: "Q Gateway に認証キーを設定した場合のみ入力してください。", zh: "仅当 Q Gateway 设置了认证密钥时填写。" },
  model: { en: "Model", ko: "모델", ja: "モデル", zh: "模型" },
  selectAfterConnection: { en: "Check connection to select", ko: "연결 확인 후 선택", ja: "接続確認後に選択", zh: "检查连接后选择" },
  modelHint: { en: "Select a model provided by the Gateway.", ko: "Gateway가 제공하는 모델 목록에서 선택합니다.", ja: "Gateway が提供するモデルから選択します。", zh: "从 Gateway 提供的模型中选择。" },
  modelApi: { en: "Model API", ko: "모델 API", ja: "モデル API", zh: "模型 API" },
  codexApiHint: { en: "The current Q Gateway Codex Responses adapter cannot continue after tool calls. Use Chat Completions.", ko: "현재 Q Gateway의 Codex Responses 어댑터는 도구 호출 후 대화를 제대로 이어가지 못해 Chat Completions를 사용합니다.", ja: "現在の Q Gateway の Codex Responses アダプターはツール呼び出し後に会話を継続できないため、Chat Completions を使用します。", zh: "当前 Q Gateway 的 Codex Responses 适配器无法在工具调用后继续对话，因此使用 Chat Completions。" },
  responsesApiHint: { en: "Responses requires native provider support. Changing the API resets this conversation.", ko: "Responses는 제공자의 기본 Responses API 지원이 필요합니다. API를 바꾸면 현재 대화가 초기화됩니다.", ja: "Responses にはプロバイダーのネイティブ対応が必要です。API を変更すると現在の会話はリセットされます。", zh: "Responses 需要提供商原生支持。更改 API 会重置当前对话。" },
  contextLength: { en: "Context length (tokens)", ko: "문맥 길이 (토큰)", ja: "コンテキスト長（トークン）", zh: "上下文长度（Token）" },
  contextPlaceholder: { en: "Enter if the model does not provide it", ko: "모델이 제공하지 않으면 입력", ja: "モデルが提供しない場合は入力", zh: "模型未提供时填写" },
  contextProvided: { en: "Gateway value: {count} · An entered value takes priority.", ko: "Gateway 제공값 {count} · 입력하면 우선 적용됩니다.", ja: "Gateway の値: {count} · 入力した値が優先されます。", zh: "Gateway 提供值：{count} · 手动输入的值优先。" },
  contextMissing: { en: "Enter a context length to enable compression when the Gateway does not provide one.", ko: "Gateway 제공값이 없으면 직접 입력해야 압축할 수 있습니다.", ja: "Gateway が値を提供しない場合、圧縮には手動入力が必要です。", zh: "Gateway 未提供时，需手动填写上下文长度以启用压缩。" },
  approvalPolicy: { en: "Browser action confirmations", ko: "브라우저 작업 확인", ja: "ブラウザー操作の確認", zh: "浏览器操作确认" },
  approvalAll: { en: "Confirm every action", ko: "모든 작업마다 확인", ja: "すべての操作を確認", zh: "每项操作都确认" },
  approvalChanges: { en: "Confirm changes only", ko: "변경 작업만 확인", ja: "変更操作のみ確認", zh: "仅确认更改操作" },
  approvalNone: { en: "Run without confirmation", ko: "확인 없이 실행", ja: "確認せずに実行", zh: "无需确认直接执行" },
  approvalHint: { en: "Reads include page, DOM and tab lists. Changes include input, clicks and tab navigation. Chrome site access is requested separately.", ko: "읽기는 페이지·DOM·탭 목록 조회, 변경은 입력·클릭·탭 이동입니다. Chrome 사이트 접근 권한은 별도로 요청됩니다.", ja: "読み取りはページ・DOM・タブ一覧、変更は入力・クリック・タブ移動です。Chrome のサイトアクセス権は別に要求されます。", zh: "读取包括页面、DOM 和标签页列表；更改包括输入、点击和标签页切换。Chrome 网站访问权限另行请求。" },
  mcpServers: { en: "MCP servers", ko: "MCP 서버", ja: "MCP サーバー", zh: "MCP 服务器" },
  mcpHint: { en: "Register a Streamable HTTP endpoint with request headers or OAuth. Adding or removing a server saves immediately. MCP tool calls use the change confirmation setting.", ko: "Streamable HTTP 주소를 요청 헤더 또는 OAuth로 등록합니다. 서버 추가·삭제는 즉시 저장됩니다. MCP 도구 호출에는 변경 작업 확인 설정이 적용됩니다.", ja: "Streamable HTTP エンドポイントをリクエストヘッダーまたは OAuth で登録します。サーバーの追加・削除はすぐに保存されます。MCP ツールには変更操作の確認設定が適用されます。", zh: "使用请求头或 OAuth 注册 Streamable HTTP 端点。添加或删除服务器后会立即保存。MCP 工具调用遵循更改确认设置。" },
  mcpOriginRejected: { en: "The MCP server rejected this Chrome extension's Origin. Direct access requires the server to allow the extension origin; otherwise use a local MCP bridge.", ko: "MCP 서버가 Chrome 확장의 Origin을 거부했습니다. 이 서버에 직접 연결하려면 서버가 확장 출처를 허용해야 합니다. 그렇지 않으면 로컬 MCP 브리지가 필요합니다.", ja: "MCP サーバーが Chrome 拡張機能の Origin を拒否しました。直接接続するにはサーバー側で拡張機能の Origin を許可する必要があります。それ以外の場合はローカル MCP ブリッジが必要です。", zh: "MCP 服务器拒绝了此 Chrome 扩展的 Origin。直接连接需要服务器允许该扩展来源，否则需要本地 MCP 桥接。" },
  mcpClientRegistrationUnsupported: { en: "This MCP authorization server does not support automatic client registration. Enter a registered OAuth client ID.", ko: "MCP 인증 서버가 자동 클라이언트 등록을 지원하지 않습니다. 등록된 OAuth 클라이언트 ID를 입력해 주세요.", ja: "この MCP 認証サーバーはクライアントの自動登録に対応していません。登録済みの OAuth クライアント ID を入力してください。", zh: "此 MCP 授权服务器不支持自动注册客户端。请输入已注册的 OAuth 客户端 ID。" },
  mcpAuthMode: { en: "MCP authentication", ko: "MCP 인증 방식", ja: "MCP 認証方式", zh: "MCP 认证方式" },
  mcpHeaderAuth: { en: "Request headers", ko: "요청 헤더", ja: "リクエストヘッダー", zh: "请求头" },
  mcpClientId: { en: "OAuth client ID (optional)", ko: "OAuth 클라이언트 ID (선택)", ja: "OAuth クライアント ID（任意）", zh: "OAuth 客户端 ID（可选）" },
  mcpClientMetadataUrl: { en: "Public client metadata URL (optional)", ko: "공개 클라이언트 메타데이터 URL (선택)", ja: "公開クライアントメタデータ URL（任意）", zh: "公开客户端元数据 URL（可选）" },
  mcpScopes: { en: "OAuth scopes, separated by spaces (optional)", ko: "OAuth 범위, 공백으로 구분 (선택)", ja: "OAuth スコープ、スペース区切り（任意）", zh: "OAuth 范围，以空格分隔（可选）" },
  mcpOAuthHint: { en: "Use a registered client ID, a public metadata URL, or leave both empty for dynamic registration. After adding, select Sign in. Sign-in is kept across browser restarts until you sign out or the server revokes access.", ko: "등록된 클라이언트 ID나 공개 메타데이터 URL을 입력하세요. 둘 다 비우면 동적 등록을 시도합니다. 추가 후 로그인하세요. 로그아웃하거나 서버가 접근을 취소하기 전까지 브라우저 재시작 후에도 로그인이 유지됩니다.", ja: "登録済みクライアント ID または公開メタデータ URL を入力します。両方空欄なら動的登録を試みます。追加後にログインしてください。ログアウトまたはサーバーによるアクセス取り消しまで、ブラウザーの再起動後もログイン状態が保持されます。", zh: "输入已注册的客户端 ID 或公开元数据 URL；两者留空则尝试动态注册。添加后请登录。退出登录或服务器撤销访问前，浏览器重启后仍保持登录。" },
  mcpSignIn: { en: "Sign in", ko: "로그인", ja: "ログイン", zh: "登录" },
  mcpSignOut: { en: "Sign out", ko: "로그아웃", ja: "ログアウト", zh: "退出登录" },
  mcpSignedOut: { en: "MCP sign-in cleared.", ko: "MCP 로그인을 해제했습니다.", ja: "MCP のログインを解除しました。", zh: "已退出 MCP 登录。" },
  mcpName: { en: "Server name", ko: "서버 이름", ja: "サーバー名", zh: "服务器名称" },
  mcpUrl: { en: "MCP endpoint URL", ko: "MCP 주소", ja: "MCP エンドポイント URL", zh: "MCP 端点 URL" },
  mcpHeaders: { en: "Request headers (JSON)", ko: "요청 헤더 (JSON)", ja: "リクエストヘッダー（JSON）", zh: "请求头（JSON）" },
  mcpHeadersInvalid: { en: "Headers must be a JSON object of strings.", ko: "헤더는 문자열 값으로 된 JSON 객체여야 합니다.", ja: "ヘッダーは文字列値の JSON オブジェクトで指定してください。", zh: "请求头必须是值为字符串的 JSON 对象。" },
  mcpIdInvalid: { en: "Use a server name starting with a letter or number, up to 32 characters.", ko: "MCP 서버 이름은 영문·숫자로 시작하고 32자 이하여야 합니다.", ja: "サーバー名は英数字で始め、32 文字以内にしてください。", zh: "服务器名称须以字母或数字开头，最多 32 个字符。" },
  mcpUrlInvalid: { en: "Enter a valid MCP server URL.", ko: "MCP 서버 URL이 올바르지 않습니다.", ja: "有効な MCP サーバー URL を入力してください。", zh: "请输入有效的 MCP 服务器 URL。" },
  mcpHttpRequired: { en: "MCP servers require an HTTP(S) URL.", ko: "MCP 서버에는 HTTP(S) URL이 필요합니다.", ja: "MCP サーバーには HTTP(S) URL が必要です。", zh: "MCP 服务器需要 HTTP(S) URL。" },
  mcpUrlCredentials: { en: "Do not include credentials or a fragment in the MCP URL.", ko: "MCP URL에 사용자 정보나 fragment를 넣을 수 없습니다.", ja: "MCP URL に認証情報やフラグメントを含めないでください。", zh: "MCP URL 中不能包含凭据或片段。" },
  mcpIdExists: { en: "That MCP server name is already registered.", ko: "같은 이름의 MCP 서버가 이미 있습니다.", ja: "同じ名前の MCP サーバーは登録済みです。", zh: "该名称的 MCP 服务器已注册。" },
  mcpAddFailed: { en: "Could not add the MCP server.", ko: "MCP 서버를 추가하지 못했습니다.", ja: "MCP サーバーを追加できませんでした。", zh: "无法添加 MCP 服务器。" },
  mcpConnectFailed: { en: "MCP connection failed", ko: "MCP 연결 실패", ja: "MCP 接続に失敗", zh: "MCP 连接失败" },
  mcpConnected: { en: "Connected. Found {count} tools.", ko: "연결됨. 도구 {count}개를 찾았습니다.", ja: "接続しました。ツール {count} 件。", zh: "已连接。找到 {count} 个工具。" },
  mcpActionApproval: { en: "Run MCP tool", ko: "MCP 도구 실행", ja: "MCP ツールを実行", zh: "运行 MCP 工具" },
  addMcpServer: { en: "Add MCP server", ko: "MCP 서버 추가", ja: "MCP サーバーを追加", zh: "添加 MCP 服务器" },
  remove: { en: "Remove", ko: "제거", ja: "削除", zh: "移除" },
  agentSkills: { en: "Agent Skills", ko: "Agent Skills", ja: "Agent Skills", zh: "Agent Skills" },
  skillHint: { en: "Import a SKILL.md file or a skill folder with text resources. Qumi searches installed skills and reads full instructions only when needed.", ko: "SKILL.md 파일이나 텍스트 리소스가 포함된 스킬 폴더를 가져오세요. Qumi는 설치된 스킬을 검색하고 필요할 때만 본문을 읽습니다.", ja: "SKILL.md またはテキストリソースを含むスキルフォルダーを読み込みます。Qumi は必要なときだけ本文を取得します。", zh: "导入 SKILL.md 或包含文本资源的技能文件夹。Qumi 搜索已安装技能，仅在需要时读取全文。" },
  importSkillFile: { en: "Import SKILL.md", ko: "SKILL.md 가져오기", ja: "SKILL.md を読み込む", zh: "导入 SKILL.md" },
  importSkillFolder: { en: "Import skill folder", ko: "스킬 폴더 가져오기", ja: "スキルフォルダーを読み込む", zh: "导入技能文件夹" },
  skillFileMissing: { en: "The selected files do not contain SKILL.md.", ko: "선택한 파일에 SKILL.md가 없습니다.", ja: "選択したファイルに SKILL.md がありません。", zh: "所选文件中没有 SKILL.md。" },
  skillFrontmatterMissing: { en: "SKILL.md needs YAML frontmatter.", ko: "SKILL.md에 YAML frontmatter가 필요합니다.", ja: "SKILL.md には YAML frontmatter が必要です。", zh: "SKILL.md 需要 YAML frontmatter。" },
  skillMetadataInvalid: { en: "Skill metadata is invalid.", ko: "스킬 메타데이터가 올바르지 않습니다.", ja: "スキルのメタデータが無効です。", zh: "技能元数据无效。" },
  skillNameDescriptionInvalid: { en: "A skill needs a valid name and description.", ko: "스킬에는 유효한 name과 description이 필요합니다.", ja: "スキルには有効な name と description が必要です。", zh: "技能需要有效的 name 和 description。" },
  skillInstallTooLarge: { en: "A skill exceeds the 5 MiB install limit.", ko: "스킬 전체 크기가 5 MiB를 초과합니다.", ja: "スキル全体が 5 MiB の上限を超えています。", zh: "技能总大小超过 5 MiB 上限。" },
  skillImportFailed: { en: "Could not import the skill.", ko: "스킬을 가져오지 못했습니다.", ja: "スキルを読み込めませんでした。", zh: "无法导入技能。" },
  skillsInstalled: { en: "Installed {count} skill(s).", ko: "스킬 {count}개를 설치했습니다.", ja: "スキル {count} 件をインストールしました。", zh: "已安装 {count} 个技能。" },
  executionLog: { en: "Execution log", ko: "실행 진단 로그", ja: "実行ログ", zh: "执行日志" },
  logHint: { en: "Stores up to 10,000 events from the last 7 days in this browser. Prompts, page content and API keys are not logged.", ko: "최근 7일, 최대 10,000개 이벤트를 이 브라우저에 저장합니다. 프롬프트·페이지 내용·API 키는 기록하지 않습니다.", ja: "直近 7 日間のイベントを最大 10,000 件、このブラウザーに保存します。プロンプト、ページ内容、API キーは記録しません。", zh: "在此浏览器中保存最近 7 天最多 10,000 条事件。不记录提示词、页面内容或 API 密钥。" },
  downloadJson: { en: "Download JSON", ko: "JSON 다운로드", ja: "JSON をダウンロード", zh: "下载 JSON" },
  clearLog: { en: "Clear log", ko: "로그 지우기", ja: "ログを消去", zh: "清除日志" },
  logDownloaded: { en: "Downloaded {count} events.", ko: "{count}개 이벤트를 다운로드했습니다.", ja: "{count} 件のイベントをダウンロードしました。", zh: "已下载 {count} 条事件。" },
  logDownloadFailed: { en: "Could not download the log.", ko: "로그를 다운로드하지 못했습니다.", ja: "ログをダウンロードできませんでした。", zh: "无法下载日志。" },
  logCleared: { en: "Saved execution log cleared.", ko: "저장된 실행 로그를 지웠습니다.", ja: "保存済みの実行ログを消去しました。", zh: "已清除保存的执行日志。" },
  logClearFailed: { en: "Could not clear the log.", ko: "로그를 지우지 못했습니다.", ja: "ログを消去できませんでした。", zh: "无法清除日志。" },
  checkConnection: { en: "Check connection", ko: "연결 확인", ja: "接続を確認", zh: "检查连接" },
  checkingEllipsis: { en: "Checking…", ko: "확인 중…", ja: "確認中…", zh: "检查中…" },
  save: { en: "Save", ko: "저장", ja: "保存", zh: "保存" },
  noAvailableModels: { en: "No models are available. Check Q provider settings.", ko: "사용 가능한 모델이 없습니다. Q의 제공자 설정을 확인해 주세요.", ja: "利用可能なモデルがありません。Q のプロバイダー設定を確認してください。", zh: "没有可用模型。请检查 Q 的提供商设置。" },
  modelsFound: { en: "Found {count} models.", ko: "{count}개 모델을 확인했습니다.", ja: "{count} 件のモデルが見つかりました。", zh: "找到 {count} 个模型。" },
  gatewayConnectFailed: { en: "Could not connect to the Gateway.", ko: "Gateway에 연결하지 못했습니다.", ja: "Gateway に接続できませんでした。", zh: "无法连接到 Gateway。" },
  contextLengthMissing: { en: "This model does not provide a context length. Enter one.", ko: "이 모델은 문맥 길이를 제공하지 않습니다. 문맥 길이를 입력해 주세요.", ja: "このモデルはコンテキスト長を提供しません。値を入力してください。", zh: "此模型未提供上下文长度。请手动填写。" },
  settingsAria: { en: "Qumi settings", ko: "Qumi 설정", ja: "Qumi の設定", zh: "Qumi 设置" },
  newChat: { en: "New chat", ko: "새 대화", ja: "新しいチャット", zh: "新对话" },
  noModels: { en: "No models", ko: "모델 없음", ja: "モデルなし", zh: "无模型" },
  currentPage: { en: "Current page", ko: "현재 페이지", ja: "現在のページ", zh: "当前页面" },
  noWebPage: { en: "No connectable web page", ko: "연결할 웹페이지 없음", ja: "接続可能なウェブページなし", zh: "没有可连接的网页" },
  extensionOnly: { en: "Available in the Chrome extension", ko: "Chrome 확장에서 연결 가능", ja: "Chrome 拡張機能で利用可能", zh: "可在 Chrome 扩展中使用" },
  pageReadHint: { en: "Reading this page sends its content to Q Gateway.", ko: "페이지를 읽으면 내용이 Q Gateway에 전달됩니다.", ja: "ページを読み取ると内容が Q Gateway に送信されます。", zh: "读取此页面会将内容发送至 Q Gateway。" },
  pageLoading: { en: "Page loading…", ko: "페이지 로딩 중…", ja: "ページを読み込み中…", zh: "页面加载中…" },
  pageAutoConnectHint: { en: "Connects automatically after load. If site access is restricted, select Connect.", ko: "페이지 로드 후 자동 연결됩니다. 브라우저에서 사이트 접근을 제한했다면 연결을 눌러 주세요.", ja: "読み込み後に自動接続します。サイトアクセスが制限されている場合は［接続］を選んでください。", zh: "加载后自动连接。如果浏览器限制了网站访问，请点击“连接”。" },
  pageNavigationHint: { en: "Page content requires an HTTP(S) site. URL navigation and tab switching are available.", ko: "본문 연결은 일반 HTTP(S) 페이지에서 가능합니다. 주소 이동과 탭 전환은 사용할 수 있습니다.", ja: "本文の接続には HTTP(S) ページが必要です。URL 移動とタブ切り替えは利用できます。", zh: "读取页面内容需要 HTTP(S) 网站。仍可跳转网址和切换标签页。" },
  extensionHint: { en: "Load the extension in Chrome to connect to a page.", ko: "확장을 Chrome에 로드하면 연결할 수 있습니다.", ja: "Chrome に拡張機能を読み込むと接続できます。", zh: "在 Chrome 中加载扩展后即可连接。" },
  connect: { en: "Connect", ko: "연결", ja: "接続", zh: "连接" },
  conversation: { en: "Conversation", ko: "대화 내용", ja: "会話", zh: "对话内容" },
  howCanIHelp: { en: "How can I help?", ko: "무엇을 도와드릴까요?", ja: "何をお手伝いしましょうか？", zh: "有什么可以帮您？" },
  gatewayRequired: { en: "Connect to Q Gateway to begin.", ko: "Q Gateway 연결이 필요합니다.", ja: "Q Gateway への接続が必要です。", zh: "需要连接 Q Gateway。" },
  startConversation: { en: "Ask Q a question to start a conversation.", ko: "Q에 질문을 보내 대화를 시작하세요.", ja: "Q に質問して会話を始めましょう。", zh: "向 Q 提问以开始对话。" },
  checkGateway: { en: "Check the Gateway URL and model in settings.", ko: "설정에서 Gateway 주소와 모델을 확인하세요.", ja: "設定で Gateway の URL とモデルを確認してください。", zh: "请在设置中检查 Gateway 地址和模型。" },
  gatewaySettings: { en: "Gateway settings", ko: "Gateway 설정", ja: "Gateway の設定", zh: "Gateway 设置" },
  user: { en: "You", ko: "사용자", ja: "ユーザー", zh: "用户" },
  cachedTokens: { en: "Cache used: {count} tokens", ko: "캐시 사용 {count} 토큰", ja: "キャッシュ使用: {count} トークン", zh: "缓存命中：{count} Token" },
  thinking: { en: "Thinking", ko: "생각 중", ja: "思考中", zh: "思考中" },
  browserActionConfirmation: { en: "Confirm browser action", ko: "브라우저 작업 확인", ja: "ブラウザー操作の確認", zh: "确认浏览器操作" },
  cancel: { en: "Cancel", ko: "취소", ja: "キャンセル", zh: "取消" },
  run: { en: "Run", ko: "실행", ja: "実行", zh: "执行" },
  contextLengthRequired: { en: "Enter this model's context length in settings.", ko: "설정에서 이 모델의 문맥 길이를 입력해 주세요.", ja: "設定でこのモデルのコンテキスト長を入力してください。", zh: "请在设置中填写此模型的上下文长度。" },
  cancelSelection: { en: "Cancel selection", ko: "선택 취소", ja: "選択をキャンセル", zh: "取消选择" },
  addRegion: { en: "+ Select region", ko: "+ 영역 선택", ja: "+ 範囲を選択", zh: "+ 选择区域" },
  selectingRegionHint: { en: "Drag a rectangle on the page · Esc to cancel", ko: "페이지에서 사각형을 드래그하세요 · Esc로 취소", ja: "ページ上で矩形をドラッグ · Esc でキャンセル", zh: "在页面上拖出矩形 · 按 Esc 取消" },
  pickerHint: { en: "Drag to select a region · Esc to cancel", ko: "드래그로 영역 선택 · Esc로 취소", ja: "ドラッグして範囲を選択 · Esc でキャンセル", zh: "拖动以选择区域 · 按 Esc 取消" },
  pickerTooSmall: { en: "Drag a larger region · Esc to cancel", ko: "조금 더 넓게 드래그해 주세요 · Esc로 취소", ja: "もう少し広い範囲を選択してください · Esc でキャンセル", zh: "请拖出更大的区域 · 按 Esc 取消" },
  selectRegionHint: { en: "Select a region on the page after pressing the button", ko: "버튼을 누른 뒤 페이지의 원하는 영역을 드래그", ja: "ボタンを押してページ上の範囲をドラッグ", zh: "点击按钮后在页面上拖选区域" },
  askQ: { en: "Ask Q", ko: "Q에게 물어보기", ja: "Q に質問", zh: "向 Q 提问" },
  localConnection: { en: "Q Gateway · Local connection", ko: "Q Gateway · 로컬 연결", ja: "Q Gateway · ローカル接続", zh: "Q Gateway · 本地连接" },
  stop: { en: "Stop", ko: "중단", ja: "停止", zh: "停止" },
  send: { en: "Send", ko: "보내기", ja: "送信", zh: "发送" },
  readSettingsFailed: { en: "Could not read saved settings.", ko: "저장된 설정을 읽지 못했습니다.", ja: "保存された設定を読み込めませんでした。", zh: "无法读取已保存的设置。" },
  saveConversationFailed: { en: "Could not save the conversation.", ko: "대화 내용을 저장하지 못했습니다.", ja: "会話を保存できませんでした。", zh: "无法保存对话。" },
  openWebPage: { en: "Open a regular HTTP(S) page before connecting.", ko: "일반 HTTP(S) 웹페이지를 연 뒤 다시 연결해 주세요.", ja: "通常の HTTP(S) ページを開いてから接続してください。", zh: "请打开普通 HTTP(S) 网页后再连接。" },
  waitForPageLoad: { en: "Wait for the page to finish loading before connecting.", ko: "페이지 로딩이 끝난 뒤 연결해 주세요.", ja: "ページの読み込みが終わってから接続してください。", zh: "请等待页面加载完成后再连接。" },
  pageConnectFailed: { en: "Could not connect to this page.", ko: "페이지에 연결하지 못했습니다.", ja: "このページに接続できませんでした。", zh: "无法连接到此页面。" },
  pageChanged: { en: "The page changed. Check the new page connection and try again.", ko: "페이지가 바뀌었습니다. 새 페이지 연결을 확인한 뒤 다시 요청해 주세요.", ja: "ページが変わりました。新しいページの接続を確認して再試行してください。", zh: "页面已更改。请检查新页面的连接后重试。" },
  pageChangedSelection: { en: "The page changed. Check the new page connection and try again.", ko: "페이지가 바뀌었습니다. 새 페이지 연결을 확인한 뒤 다시 시도해 주세요.", ja: "ページが変わりました。新しいページの接続を確認して再試行してください。", zh: "页面已更改。请检查新页面的连接后重试。" },
  noPageAccess: { en: "This page cannot be connected. Try a regular HTTP(S) page.", ko: "이 페이지는 연결할 수 없습니다. 일반 HTTP(S) 웹페이지에서 다시 시도해 주세요.", ja: "このページには接続できません。通常の HTTP(S) ページで再試行してください。", zh: "无法连接此页面。请在普通 HTTP(S) 网页上重试。" },
  extensionRequired: { en: "Page connections require the installed Chrome extension.", ko: "페이지 연결은 설치된 Chrome 확장에서 사용할 수 있습니다.", ja: "ページ接続にはインストール済みの Chrome 拡張機能が必要です。", zh: "页面连接需要安装 Chrome 扩展。" },
  siteAccessDenied: { en: "Site access was denied. Check Qumi's site access settings in your browser.", ko: "사이트 접근 권한이 거부되었습니다. 브라우저의 Qumi 사이트 접근 설정을 확인해 주세요.", ja: "サイトへのアクセスが拒否されました。ブラウザーの Qumi サイトアクセス設定を確認してください。", zh: "网站访问权限被拒绝。请检查浏览器中的 Qumi 网站访问设置。" },
  regionCaptureFailed: { en: "Could not select a page region. Check page access permissions.", ko: "페이지에서 영역을 선택하지 못했습니다. 페이지 연결 권한을 확인해 주세요.", ja: "ページ上の範囲を選択できませんでした。ページへのアクセス権を確認してください。", zh: "无法选择页面区域。请检查页面访问权限。" },
  gatewayUrlInvalid: { en: "Check the Gateway URL.", ko: "Gateway URL을 확인해 주세요.", ja: "Gateway の URL を確認してください。", zh: "请检查 Gateway URL。" },
  gatewayUrlRequired: { en: "Enter a local Q Gateway URL, for example http://127.0.0.1:8080/v1.", ko: "로컬 Q Gateway 주소를 입력해 주세요. 예: http://127.0.0.1:8080/v1", ja: "ローカル Q Gateway の URL を入力してください。例: http://127.0.0.1:8080/v1", zh: "请输入本地 Q Gateway 地址，例如 http://127.0.0.1:8080/v1。" },
  gatewayModelFormat: { en: "The Gateway model list has an invalid format.", ko: "Gateway 모델 목록 형식이 올바르지 않습니다.", ja: "Gateway のモデル一覧の形式が正しくありません。", zh: "Gateway 模型列表格式无效。" },
  gatewayEmptyResponse: { en: "The Gateway returned an empty response.", ko: "Gateway가 빈 응답을 반환했습니다.", ja: "Gateway から空の応答が返されました。", zh: "Gateway 返回了空响应。" },
  gatewayStreamUnreadable: { en: "Could not read the Gateway stream.", ko: "Gateway 스트림을 읽을 수 없습니다.", ja: "Gateway のストリームを読み取れません。", zh: "无法读取 Gateway 流。" },
  gatewayToolFormat: { en: "The Gateway tool call has an invalid format.", ko: "Gateway 도구 호출 형식이 올바르지 않습니다.", ja: "Gateway のツール呼び出し形式が正しくありません。", zh: "Gateway 工具调用格式无效。" },
  gatewayResponsesFormat: { en: "The Gateway Responses output has an invalid format.", ko: "Gateway Responses 출력 형식이 올바르지 않습니다.", ja: "Gateway Responses の出力形式が正しくありません。", zh: "Gateway Responses 输出格式无效。" },
  gatewayResponsesStreamIncomplete: { en: "The Gateway Responses stream ended without a completion event.", ko: "Gateway Responses 스트림이 완료 이벤트 없이 끝났습니다.", ja: "Gateway Responses ストリームが完了イベントなしで終了しました。", zh: "Gateway Responses 流结束时没有完成事件。" },
  gatewayResponsesTextMissing: { en: "The Gateway Responses completion did not include streamed text.", ko: "Gateway Responses 완료 응답에 스트리밍 텍스트가 없습니다.", ja: "Gateway Responses の完了応答にストリーミングテキストがありません。", zh: "Gateway Responses 完成响应中没有流式文本。" },
  gatewayTextMissing: { en: "No text was found in the Gateway response.", ko: "Gateway 응답에서 텍스트를 찾지 못했습니다.", ja: "Gateway の応答にテキストがありません。", zh: "Gateway 响应中没有文本。" },
  codexResponsesUnsupported: { en: "The current Q Gateway Codex Responses adapter cannot continue after tool results. Select Chat Completions.", ko: "현재 Q Gateway의 Codex Responses 어댑터는 도구 결과를 이어받지 못합니다. Chat Completions를 선택해 주세요.", ja: "現在の Q Gateway Codex Responses アダプターはツール結果を引き継げません。Chat Completions を選択してください。", zh: "当前 Q Gateway Codex Responses 适配器无法继续处理工具结果。请选择 Chat Completions。" },
  gatewayHttpError: { en: "Gateway request failed ({status}).", ko: "Gateway 요청에 실패했습니다. ({status})", ja: "Gateway のリクエストに失敗しました（{status}）。", zh: "Gateway 请求失败（{status}）。" },
  gatewayResponsesHttpError: { en: "Gateway Responses request failed ({status}).", ko: "Gateway Responses 요청에 실패했습니다. ({status})", ja: "Gateway Responses のリクエストに失敗しました（{status}）。", zh: "Gateway Responses 请求失败（{status}）。" },
  gatewayNonJsonError: { en: "Gateway did not return JSON ({status}).", ko: "Gateway가 JSON 응답을 반환하지 않았습니다. ({status})", ja: "Gateway が JSON を返しませんでした（{status}）。", zh: "Gateway 未返回 JSON（{status}）。" },
  modelRequired: { en: "Select a model.", ko: "모델을 선택해 주세요.", ja: "モデルを選択してください。", zh: "请选择模型。" },
  tooManyRegions: { en: "You can attach up to 5 regions per request.", ko: "선택 영역은 한 요청에 최대 5개까지 첨부할 수 있습니다.", ja: "1 回のリクエストに添付できる範囲は最大 5 件です。", zh: "每次请求最多可附加 5 个区域。" },
  regionReadFailed: { en: "Could not read the selected region.", ko: "선택 영역을 읽지 못했습니다.", ja: "選択範囲を読み取れませんでした。", zh: "无法读取选定区域。" },
  responding: { en: "Responding…", ko: "응답 중…", ja: "応答中…", zh: "正在回答…" },
  waitingForModel: { en: "Waiting for model…", ko: "모델 응답 대기 중…", ja: "モデルの応答を待機中…", zh: "等待模型响应…" },
  thinkingEllipsis: { en: "Thinking…", ko: "생각 중…", ja: "思考中…", zh: "思考中…" },
  compacting: { en: "Compressing context…", ko: "문맥 압축 중…", ja: "コンテキストを圧縮中…", zh: "正在压缩上下文…" },
  runningTool: { en: "Running {tool}…", ko: "{tool} 실행 중…", ja: "{tool} を実行中…", zh: "正在运行 {tool}…" },
  requestCancelled: { en: "Request cancelled.", ko: "요청을 취소했습니다.", ja: "リクエストをキャンセルしました。", zh: "已取消请求。" },
  responseFailed: { en: "Could not get a response.", ko: "응답을 받지 못했습니다.", ja: "応答を取得できませんでした。", zh: "无法获取响应。" },
  logSaveFailed: { en: "Could not save the execution log.", ko: "실행 로그를 저장하지 못했습니다.", ja: "実行ログを保存できませんでした。", zh: "无法保存执行日志。" },
  pageReadApproval: { en: "Read browser information", ko: "브라우저 정보 읽기", ja: "ブラウザー情報を読み取る", zh: "读取浏览器信息" },
  openNewTabApproval: { en: "Open new tab", ko: "새 탭 열기", ja: "新しいタブを開く", zh: "打开新标签页" },
  switchTabApproval: { en: "Switch existing tab", ko: "기존 탭 전환", ja: "既存のタブに切り替える", zh: "切换现有标签页" },
  navigateTabApproval: { en: "Navigate current tab", ko: "현재 탭 이동", ja: "現在のタブを移動", zh: "跳转当前标签页" },
  replacePageTextApproval: { en: "Change page text", ko: "페이지 본문 텍스트 변경", ja: "ページ本文を変更", zh: "修改页面正文" },
  changeAttributeApproval: { en: "Change element attribute", ko: "엘리먼트 속성 변경", ja: "要素の属性を変更", zh: "修改元素属性" },
  changeValueApproval: { en: "Change element value", ko: "엘리먼트 값 변경", ja: "要素の値を変更", zh: "修改元素值" },
  batchTextApproval: { en: "Change page text in batch", ko: "페이지 본문 일괄 변경", ja: "ページ本文を一括変更", zh: "批量修改页面正文" },
  clickElementApproval: { en: "Click element", ko: "엘리먼트 클릭", ja: "要素をクリック", zh: "点击元素" },
  sendKeyApproval: { en: "Send key to page", ko: "페이지에 키 입력", ja: "ページにキーを送信", zh: "向页面发送按键" },
  sendKeysApproval: { en: "Send keys to page", ko: "페이지에 연속 키 입력", ja: "ページに連続キーを送信", zh: "向页面连续发送按键" },
  taskFindings: { en: "Findings", ko: "발견", ja: "確認事項", zh: "发现" },
  taskArtifacts: { en: "Artifacts", ko: "결과물", ja: "成果物", zh: "产出" },
  taskVerification: { en: "Verification", ko: "검증", ja: "検証", zh: "验证" },
  taskBlocker: { en: "Blocker", ko: "막힌 이유", ja: "阻害要因", zh: "受阻原因" },
} as const satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof messages;

export function languagePreferenceFrom(value: unknown): LanguagePreference {
  return value === "en" || value === "ko" || value === "ja" || value === "zh" ? value : "auto";
}

export function resolveLocale(preference: LanguagePreference, browserLanguage?: string): Locale {
  if (preference !== "auto") return preference;
  const language = (browserLanguage ?? (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage ? chrome.i18n.getUILanguage() : typeof navigator !== "undefined" ? navigator.language : "en")).toLowerCase();
  if (language.startsWith("ko")) return "ko";
  if (language.startsWith("ja")) return "ja";
  if (language.startsWith("zh")) return "zh";
  return "en";
}

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat({ en: "en-US", ko: "ko-KR", ja: "ja-JP", zh: "zh-CN" }[locale]).format(value);
}

export function translate(locale: Locale, key: MessageKey, variables: Record<string, string | number> = {}): string {
  return messages[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => name in variables ? String(variables[name]) : match);
}

const approvalKeys: MessageKey[] = [
  "pageReadApproval", "openNewTabApproval", "switchTabApproval", "navigateTabApproval", "replacePageTextApproval",
  "changeAttributeApproval", "changeValueApproval", "batchTextApproval", "clickElementApproval", "sendKeyApproval", "sendKeysApproval",
];

export function localizeApprovalTitle(locale: Locale, title: string): string {
  const key = approvalKeys.find((candidate) => messages[candidate].ko === title);
  return key ? translate(locale, key) : title;
}

const approvalDetailLabels: Record<string, Record<Locale, string>> = {
  "도구": { en: "Tool", ko: "도구", ja: "ツール", zh: "工具" },
  "인수": { en: "Arguments", ko: "인수", ja: "引数", zh: "参数" },
  "텍스트 노드": { en: "Text node", ko: "텍스트 노드", ja: "テキストノード", zh: "文本节点" },
  "기존 텍스트": { en: "Previous text", ko: "기존 텍스트", ja: "変更前のテキスト", zh: "原文本" },
  "새 텍스트": { en: "New text", ko: "새 텍스트", ja: "新しいテキスト", zh: "新文本" },
  "속성": { en: "Attribute", ko: "속성", ja: "属性", zh: "属性" },
  "기존 값": { en: "Previous value", ko: "기존 값", ja: "変更前の値", zh: "原值" },
  "새 값": { en: "New value", ko: "새 값", ja: "新しい値", zh: "新值" },
  "기존": { en: "Previous", ko: "기존", ja: "変更前", zh: "原内容" },
  "키": { en: "Key", ko: "키", ja: "キー", zh: "按键" },
};

export function localizeApprovalDetail(locale: Locale, detail: string): string {
  if (locale === "ko") return detail;
  const nodeCount = { en: "text nodes", ja: "件のテキストノード", zh: "个文本节点" }[locale];
  const textCount = { en: "Text", ja: "テキスト", zh: "文本" }[locale];
  const characters = { en: "characters", ja: "文字", zh: "字" }[locale];
  return detail.split("\n").map((line) => {
    const translatedLine = line.replace(" (속성 제거)", { en: " (remove attribute)", ja: "（属性を削除）", zh: "（移除属性）" }[locale]);
    const label = /^([^:]+): /.exec(translatedLine)?.[1];
    if (label && approvalDetailLabels[label]) return `${approvalDetailLabels[label][locale]}: ${translatedLine.slice(label.length + 2)}`;
    if (/^\d+개 텍스트 노드$/.test(line)) return line.replace(/^(\d+)개 텍스트 노드$/, locale === "en" ? `$1 ${nodeCount}` : `$1${nodeCount}`);
    if (/^텍스트 \d+자: /.test(line)) return line.replace(/^텍스트 (\d+)자: /, locale === "en" ? `${textCount} $1 ${characters}: ` : `${textCount} $1${characters}: `);
    return translatedLine;
  }).join("\n");
}

export function localizeKnownError(locale: Locale, message: string): string {
  const keys: MessageKey[] = ["readSettingsFailed", "saveConversationFailed", "openWebPage", "waitForPageLoad", "pageConnectFailed", "pageChanged", "pageChangedSelection", "noPageAccess", "extensionRequired", "siteAccessDenied", "regionCaptureFailed", "gatewayUrlInvalid", "gatewayUrlRequired", "gatewayModelFormat", "gatewayEmptyResponse", "gatewayStreamUnreadable", "gatewayToolFormat", "gatewayResponsesFormat", "gatewayResponsesStreamIncomplete", "gatewayResponsesTextMissing", "gatewayTextMissing", "codexResponsesUnsupported", "modelRequired", "tooManyRegions", "regionReadFailed", "requestCancelled", "responseFailed", "logSaveFailed", "gatewayConnectFailed", "contextLengthMissing", "noAvailableModels", "mcpIdInvalid", "mcpUrlInvalid", "mcpHttpRequired", "mcpUrlCredentials", "mcpOriginRejected", "mcpClientRegistrationUnsupported", "skillFrontmatterMissing", "skillMetadataInvalid", "skillNameDescriptionInvalid", "skillInstallTooLarge"];
  const key = keys.find((candidate) => messages[candidate].ko === message);
  if (key) return translate(locale, key);
  if (message.startsWith("MCP 헤더")) return translate(locale, "mcpHeadersInvalid");
  if (message.startsWith("잘못된 스킬 파일 경로:") || message.endsWith("파일이 1 MiB를 초과합니다.")) return translate(locale, "skillImportFailed");
  const statusPatterns: [RegExp, MessageKey][] = [
    [/^Gateway 요청에 실패했습니다\. \((\d+)\)$/, "gatewayHttpError"],
    [/^Gateway Responses 요청에 실패했습니다\. \((\d+)\)$/, "gatewayResponsesHttpError"],
    [/^Gateway가 JSON 응답을 반환하지 않았습니다\. \((\d+)\)$/, "gatewayNonJsonError"],
  ];
  for (const [pattern, statusKey] of statusPatterns) {
    const match = pattern.exec(message);
    if (match) return translate(locale, statusKey, { status: match[1] });
  }
  return message;
}
