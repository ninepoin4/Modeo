# Modeo 技术规格（v1.0）

## 1. 技术决策

- **客户端 UI**：React 18 + Vite 5 + Tailwind CSS 3 + Radix UI（shadcn/ui 风格本地组件）+ Framer Motion。黑白纸墨主题、衬线字体、细腻动效；源码在 `frontend/`，构建产物在 `web/`，服务端自动优先托管 `web/`（无产物时回退 `public/`）。

- **运行时**：Node.js（>=20），纯内置模块（http、fs、path、child_process、node:test），主项目零 npm 依赖。
- **前端**：原生 HTML/CSS/JS 单页应用，由同一 Node 服务托管静态文件，无构建步骤。
- **流式**：SSE（text/event-stream），客户端用 fetch 读取。
- **配置/数据**：YAML（harness、角色），JSON（会话、设置、审批、角色包）。内置 YAML 子集解析器。
- **模型接入**：Provider 抽象；内置 `mock`（离线演示/测试）与 `openai`（OpenAI 兼容 chat/completions API）。
- **桌面封装**：`desktop/` 目录独立 Electron 壳（自带 package.json），以 Electron 内置 Node（ELECTRON_RUN_AS_NODE）启动服务并加载本地界面；支持 `electron-builder` 生成免安装便携版 exe（`npm run dist`，产物在 `desktop/release/`），打包后应用文件置于 `resources/modeo`。
- **可移植目录（环境变量）**：服务端支持 `MODEO_DATA_DIR`（会话/设置/审批）、`MODEO_WORKSPACE_DIR`（沙箱）、`MODEO_CHARACTERS_DIR`（角色）、`MODEO_PACKS_DIR`（角色包）、`MODEO_PLUGINS_DIR`（插件）、`MODEO_PORT`（端口）。Electron 打包模式下自动指向用户数据目录（`%APPDATA%/Modeo`），首次运行复制内置角色/插件/工作区种子，保证便携版数据可持久化。

## 2. 目录结构

```
modeo/
  server.js              # HTTP 服务：静态资源 + API + SSE
  configs/harness/       # 内置模式 YAML：chat / code / roleplay
  data/harness/          # 用户自定义模式（设置内可创建/编辑/删除）
  characters/            # 角色 YAML 文件
  characters/packs/      # 本地角色包（*.modeopack.json）
  plugins/               # 工具插件（ESM，默认导出工具或工具数组）
  workspaces/default/    # Code 模式沙箱工作区
  data/                  # 本地数据：sessions/、checkpoints/、approvals.json、settings.json
  src/core/              # types、yaml、harness、provider、session、approvals
  src/tools/             # registry、sandbox、fileTools、shellTool、checkpoints、diff、runTests、reviewChanges、worldStateTool、pluginLoader
  src/characters/        # schema、manager、ccv3、png、pack
  src/runtime/           # engine（agent loop）
  public/                # 前端：index.html / app.js / styles.css
  desktop/               # Electron 桌面封装（独立依赖）
  tests/                 # node --test 测试
  docs/                  # PROJECT_GOALS / SPEC / CHECKLIST / REVIEW_TASK
```

## 3. 共享契约（src/core/types.js）

### Message
```js
{ role: 'system'|'user'|'assistant'|'tool'|'notice',
  content: string,
  toolCalls?: ToolCall[],
  toolCallId?: string,   // tool 消息回填用
  name?: string }        // tool 消息的工具名
```
`notice` 为系统提示消息（如「已设置会话目标」），仅作界面反馈，不发给模型。

### ToolCall / ToolResult
```js
{ id: string, name: string, args: object }
{ id: string, name: string, output: string, isError?: boolean }
```

### HarnessConfig（YAML -> JS）
```js
{
  id: string,                  // 小写字母/数字/下划线/连字符，最长 32
  name: string,
  description: string,
  systemPrompt: string|null,   // chat 模式必须为 null（零注入）
  tools: string[],             // 内置 + 插件工具名
  defaultModel: string,
  context: { compactAfter: number, maxIterations: number },
  approval: { mode: 'none'|'dangerous-only'|'all' },
  ui: { showSidebar: boolean, sidebarKind: 'none'|'characters', showToolOutput: boolean },
  characterPromptTemplate?: string
}
```

### Tool 接口
```js
{ name, description, parameters, async execute(args, ctx) -> { output, needsApproval?, isError? } }
```
ctx 含 `{ workspaceRoot, approvals, session, persist, forceApproved? }`。

### Provider 接口
```js
{ id, name, async complete(messages, opts) -> { content, toolCalls? }, async *stream(messages, opts) }
```
opts：`{ model, modeId, tools, temperature }`。

### Session
```js
{ id, modeId, characterId: string|null, characters: string[], title, createdAt, updatedAt,
  messages: Message[], modeLog: [], worldState: Record<string,string>, pendingApproval: null|{approvalId, toolCall},
  goal: string|null, lastSummary: string|null }
```
`characters` 为角色扮演模式的在场阵容；`characterId` 为当前发言角色。
`goal` 为会话目标（/goal 设置，注入系统提示词）；`lastSummary` 为最近一次压缩的历史摘要。

## 4. 引擎循环（src/runtime/engine.js）

1. 组装消息：system（harness.systemPrompt + 角色渲染；code 额外注入 AGENTS.md；roleplay 注入世界状态与多角色阵容）+ 历史 + 用户输入。每次工具执行后重新组装。
1a. 会话目标（session.goal）追加为「【会话目标】」块；`notice` 消息一律过滤，不发给模型。
2. 调用 provider.stream；收到 tool_calls 则执行工具（审批拦截：all 模式先审批后执行；dangerous-only 由工具预检，危险命令批准前绝不执行）。
3. 工具结果回填后继续循环，直到最终回答或 `maxIterations`。
4. 每次模型调用后持久化会话。
5. 需要审批时：发出 `approval_required` 事件停止本轮；用户批准后 resume 续跑。
6. 变更型工具（write_file / edit_file / shell）实际执行前自动创建快照，发出 `checkpoint` 事件。
7. roleplay 注入 `session.worldState`；`update_world_state` 工具让模型持续更新剧情事实。
8. roleplay 多角色：阵容逐个渲染，标注"当前发言角色/其他在场角色"。
9. 压缩（src/runtime/compress.js）：模型总结历史为「【历史摘要】」，替换为「摘要 + 最近若干条（仅 user/assistant）」。

### SSE 事件
`text_delta | tool_call | tool_result | approval_required | checkpoint | done | error`

## 5. API 一览

| 方法/路径 | 说明 |
|---|---|
| GET /api/health | 健康检查 |
| GET /api/modes | 模式列表（脱敏） |
| GET /api/modes/:id | 完整 harness 配置（透明面板用） |
| POST /api/modes | 创建自定义模式（禁止覆盖内置） |
| PUT /api/modes/:id | 更新自定义模式 |
| DELETE /api/modes/:id | 删除自定义模式（内置只读） |
| GET /api/plugins | 已加载插件工具列表 |
| POST /api/plugins/reload | 热重载 plugins/ 并重建工具注册表 |
| GET/POST /api/sessions | 会话列表 / 创建（modeId, characterId?） |
| POST /api/sessions/import | 导入会话 JSON（新 id） |
| GET /api/sessions/:id | 会话详情 |
| GET /api/sessions/:id/export | 导出会话 JSON |
| GET /api/sessions/:id/diff | 工作区变更（相对基线） |
| GET /api/sessions/:id/checkpoints | 快照列表 |
| POST /api/sessions/:id/checkpoints/restore | 恢复快照 |
| POST /api/sessions/:id/messages | 发送消息（Accept: text/event-stream 则 SSE） |
| POST /api/sessions/:id/switch-mode | 切换模式 |
| PUT /api/sessions/:id/goal | 设置/清除会话目标（空值清除） |
| POST /api/sessions/:id/compress | 调用模型压缩历史为摘要 |
| POST /api/sessions/:id/clear | 清空会话消息历史（目标/世界状态/快照保留） |
| POST /api/sessions/:id/resume | 继续被审批挂起的工具调用 |
| POST /api/sessions/:id/characters | 向角色阵容添加角色 |
| DELETE /api/sessions/:id/characters/:characterId | 从阵容移除角色 |
| POST /api/sessions/:id/active-character | 切换当前发言角色 |
| PUT /api/sessions/:id/world-state | 合并更新世界状态 |
| DELETE /api/sessions/:id/world-state | 清空世界状态 |
| GET /api/prompt/:sessionId | 透明面板：完整生效 prompt（不含密钥） |
| GET/POST /api/characters | 角色列表 / 新建（yaml 内容） |
| GET/PUT/DELETE /api/characters/:id | 角色读取/更新/删除 |
| POST /api/characters/parse | YAML -> 对象 |
| POST /api/characters/stringify | 对象 -> YAML（含校验） |
| POST /api/characters/import-ccv3 | CCv3 JSON（或 PNG base64）导入 |
| GET /api/characters/:id/export-ccv3 | 导出 CCv3 JSON |
| POST /api/characters/export-pack | 导出角色包 |
| POST /api/characters/import-pack | 从角色包对象/JSON 安装 |
| POST /api/characters/import-pack-url | 从 URL 下载并安装（限 5MB / 10s） |
| POST /api/characters/market/refresh | 刷新市场索引（modeo-market-index） |
| POST /api/characters/market/install | 从市场包 URL 远程安装 |
| GET /api/characters/packs | 本地角色包列表 |
| POST /api/characters/packs/import | 安装本地角色包 |
| POST /api/characters/packs/save | 保存角色包到本地目录 |
| DELETE /api/characters/packs/:id | 删除本地角色包 |
| GET /api/approvals/pending | 待审批列表 |
| POST /api/approvals/:id | 批准/拒绝 { decision: 'approve'|'deny' } |
| GET/POST /api/settings | 读取/保存设置 |

## 6. 安全模型

- 文件工具只允许操作 `workspaces/default`（规范化路径 + 前缀校验，Windows 大小写不敏感）。
- `..` 与符号链接逃逸一律拒绝，返回 isError。
- shell：cwd 锁在工作区、默认 30s 超时、进程树清理；危险命令（rm/format/del 等）预检后需审批，批准前不实际执行。
- 快照：变更型工具执行前落盘 `data/checkpoints/<sessionId>/`，每会话最多保留 20 份；恢复仅允许作用于项目 workspaces 下。
- run_tests：自动探测测试入口（npm test / node --test / pytest），沙箱内执行。
- review_changes：以最近快照为基线对比工作区，输出变更清单与行级 diff。
- 插件：`plugins/*.js` 默认导出工具或工具数组；插件为**受信任的本地代码**，运行在服务进程内。
- 世界状态与角色 YAML 均作为**数据**渲染进提示词，不作为指令执行；顶层护栏独立于角色与世界状态内容。
- apiKey 只存本地 settings.json，透明面板 API 不返回密钥。
- 角色包/市场下载：仅 http/https、大小与超时限制、格式严格校验。

## 7. 测试策略

- `node --test` 全绿为交付前提。
- 覆盖：yaml 解析（含防原型污染）、harness 加载与 chat 零注入、用户模式目录、沙箱路径逃逸、shell 审批前置、checkpoint、run_tests、review_changes、世界状态、多角色阵容、角色 schema/CCv3/角色包/市场、插件加载、会话导出导入、引擎循环（mock）、OpenAI Provider（本地 mock 服务）。
