# Modeo 交付审查清单（子 Agent 审查用）

审查者须逐项给出 **通过 / 不通过 / 证据**。证据包括命令输出、测试结果、API 响应。

## A. 可运行性

- [ ] `npm test` 全部通过（记录失败数，必须为 0）
- [ ] `node server.js` 可启动，`GET /api/health` 返回 ok
- [ ] 首页 `GET /` 返回 HTML，无构建步骤可访问

## B. 三模式

- [ ] `GET /api/modes` 返回 chat / code / roleplay 三个模式
- [ ] chat 模式 `systemPrompt` 为 null（零注入）
- [ ] code 模式 tools 含 shell 与文件工具；roleplay 模式含 characterPromptTemplate
- [ ] `POST /api/sessions`（modeId=chat）与（modeId=roleplay, characterId=示例角色）均成功
- [ ] `POST /api/sessions/:id/switch-mode` 后 modeLog 有记录，会话可继续

## C. 引擎与透明面板

- [ ] mock provider 下发送消息能返回最终回答，会话持久化
- [ ] code 模式 mock 会话触发工具调用并能拿到 tool_result
- [ ] `GET /api/prompt/:sessionId` 返回完整生效 prompt；chat 模式 system 部分为空
- [ ] 透明面板数据不含 apiKey

## D. 角色系统

- [ ] `GET /api/characters` 至少返回一个示例角色
- [ ] 非法角色 YAML `POST /api/characters` 返回 400 与可读错误
- [ ] CCv3 JSON 导入 -> 导出往返字段不丢失（核心字段）
- [ ] PNG tEXt 角色卡导入可用（构造最小 PNG 测试）
- [ ] 角色编辑器支持表单/源码双视图：表单可编辑字段、切回源码保留数据、表单保存成功
- [ ] `POST /api/characters/parse` 与 `POST /api/characters/stringify` 可用（合法通过、非法 400）

## E. Code 沙箱安全

- [ ] 文件工具写 `../` 越界路径被拒绝
- [ ] shell 在 `workspaces/default` 内执行成功
- [ ] 危险命令触发 `approval_required`，批准后 resume 完成
- [ ] 危险命令在批准前未实际执行（shell 预检）
- [ ] 变更型工具执行前自动创建快照，恢复后工作区还原
- [ ] review_changes 能列出新增/修改/删除文件并给出行级 diff
- [ ] 工具输出不泄露工作区外文件内容

## F. 非目标检查

- [ ] 无 npm install 依赖（package.json 无 dependencies）
- [ ] 无云平台、无付费墙、无模型训练代码

## G. v2 增量（undo/checkpoint + 世界状态）

- [ ] Code 变更型工具执行前自动 checkpoint，`GET /api/sessions/:id/checkpoints` 可列出
- [ ] `POST /api/sessions/:id/checkpoints/restore` 还原工作区并提示
- [ ] UI 工具面板"撤销"按钮可一键恢复最近快照
- [ ] `PUT /api/sessions/:id/world-state` 合并更新并持久化；`DELETE` 清空
- [ ] roleplay 模式 mock 触发 `update_world_state` 工具，引擎持久化到会话
- [ ] 透明面板 `GET /api/prompt/:sessionId` 包含世界状态记忆
- [ ] UI 角色侧栏显示世界状态区块，编辑保存后渲染

## 结论

- 通过项数 / 总项数
- 是否达到"基本符合项目目标要求"（M0–M2 全过，M3 无阻塞）
- 遗留问题清单（如有）
