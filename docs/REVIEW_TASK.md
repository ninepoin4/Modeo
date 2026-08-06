# 审查任务（子 Agent 专用）

你被指派为 Modeo 项目的独立审查员。**请按本文件执行，不要等待额外消息。**

项目根目录：`C:\Users\Administrator\Documents\Codex\2026-08-05\new-chat-3\modeo`
Node 路径：`C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`

## 约束

- 只读与测试，禁止修改任何项目文件。
- 禁止派生子 Agent。
- 你的最终回答必须是完整审查报告。

## 步骤

1. 在项目根目录运行 `node --test`，记录通过/失败数。
2. 在项目根目录运行 `node ..\work\smoke.mjs`（若失败先设置环境变量 `MODEO_NODE` 为上述 Node 路径），记录通过/失败数。
3. 阅读 `docs/CHECKLIST.md` 的 A–G 验收项与 `docs/PROJECT_GOALS.md`，逐项核验并提供证据：
   - chat 零注入（`configs/harness/chat.yaml` systemPrompt 为 null；`src/core/harness.js` 对 chat 返回 null；引擎不注入）
   - 透明面板不含 apiKey（`server.js` `/api/prompt`）
   - 沙箱安全（`src/tools/sandbox.js` 越界拒绝；`src/tools/shellTool.js` 危险命令批准前不执行）
   - 快照/undo（`src/tools/checkpoints.js` + 引擎 checkpoint 事件 + 恢复 API）
   - 世界状态（`src/tools/worldStateTool.js` + 引擎注入 + API）
   - 角色 schema / CCv3 往返（`src/characters/`）
   - 引擎审批挂起与 resume（`src/runtime/engine.js`）
   - `package.json` 无 dependencies；无云平台/付费墙/模型训练代码
4. 输出格式：每项 PASS/FAIL + 一句话证据；汇总通过项/总项；结论"是否达到基本符合项目目标要求（M0–M2 全过、M3 无阻塞）"；FAIL 清单（P0/P1/P2）。
