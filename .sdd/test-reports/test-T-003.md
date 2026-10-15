# T-003 Tester 报告

- 时间：2026-09-13
- 项目：`C:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service`
- Developer 实例：`aafa89a5-a858-4840-958b-0bb0709fd092`
- 模式：automatic；`gate_phase=frontend_in_progress`，前端门禁仍在 T-005
- 总结果：**PASS（前端阶段 / Mock）**
- 范围：`acceptanceCriteria=[]`，仅验 technicalChecks。AC-003 / AC-004 / AC-017 / AC-018 / AC-023 / AC-024 由 T-011 真实验收，本轮不判业务 AC。
- 本 PASS 不证明完整业务功能，也不等于用户已放行门禁。

## 环境

- 工作目录：`frontend/`
- 指纹：Harness HEAD `ec75f8f`；无 `frontend/.env`，`VITE_USE_MOCK` 未关，默认 Mock
- 服务：复用已在监听的本项目 Vite（PID 18672，`frontend/node_modules/vite`，`--host 127.0.0.1 --port 5199`）。Tester 未另起、未关闭。
- URL：http://127.0.0.1:5199/knowledge （先登录 `it-help`，再进知识库）
- 拉取间隔：`VITE_POLL_INTERVAL_MS=3000`（`.env.example`）；Mock 入库约 8s
- 视口：1440×900，无头 Chrome + CDP 9334（独立 `user-data-dir`，与 T-002 会话隔离）
- 证据：`.sdd/test-reports/t003-browser-evidence.json` 与 `t003-*.png`
- 验收后：已关掉本轮 Chrome/CDP；5199 仍在（他方进程）

## 检查表

| ID | 场景 / 输入 | 动作 | 预期 | 方法 | 实际 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-01a | 非 md | 选 `notes.txt` 点上传 | 立刻「请重新上传」，列表无新行 | Chrome CDP + 截图 | 53ms 内 `[Mock] 请重新上传`；行数仍 1，仅 `[Mock] vpn-faq.md` | PASS（Mock） |
| TC-01b | 合法 md | 上传 `ingesting-demo.md` | 立刻「入库中」；无分块、无标签/FAQ 编辑 | Chrome CDP + 截图 | 53ms 列表「入库中」；详情「正在入库中…」；`hasChunks=false`，`hasEditForm=false` | PASS（Mock） |
| TC-01c | 进行中离开再回 | 切员工端再回知识库（<8s） | 仍见进行中；仍不能预览/改标签 FAQ | Chrome CDP + 截图 | 526ms 后仍「入库中」；无分块、无编辑表、无「保存」 | PASS（Mock） |
| TC-02a | Mock 完成后详情 | 等 ingesting-demo 变 ready | 切块策略含标题与段落、800、80；多块只读；无保存分块入口 | Chrome CDP + 截图 | 约 8.7s 变「已完成 · 3 块」；策略三要素齐；3 块只读（无 input / contenteditable）；按钮仅「保存」 | PASS（Mock） |
| TC-02b | 保存标签/FAQ | 勾选硬件设备并改 FAQ 后保存 | 页面立即更新；分块正文不变 | Chrome CDP + 截图 | 标签含「硬件设备」；问法/答案已换；`[Mock] 已保存，将立即用于后续提问。`；`chunksUnchanged=true` | PASS（Mock） |
| TC-02c | 种子 vpn-faq.md | 打开已 ready 文档 | 多块只读预览 + 策略原文 | Chrome CDP | 4 块，标题路径 VPN 使用说明 / 连接失败 / 配置导入 / 常见报错 | PASS（Mock） |
| TC-02d | fail.md | 上传后等 Mock 失败 | 约 8s 后「请重新上传」；无分块、不可改 | Chrome CDP + 截图 | 73ms「入库中」→ 9.5s「请重新上传」；详情 `[Mock] 请重新上传`；无分块/编辑 | PASS（Mock） |
| TC-03a | 中文三态 | 扫列表状态 | 只用「入库中 / 已完成 / 请重新上传」 | Chrome CDP | 列表状态仅为这三词；未见 `ready`/`failed` 英文状态 | PASS（Mock） |
| TC-03b | [Mock] | 看文件名、策略、错误 | Mock 带可见 `[Mock]` | Chrome CDP | 文件名、策略、上传错误、详情、保存提示均带 `[Mock]` | PASS（Mock） |
| TC-03c | UI-04 / 原型 04-knowledge | 量布局色值并对布局 | 上传条 64、列表 320、详情≥520、主色与状态点 | Chrome CDP + 截图 | 顶栏 56px；上传 min-height 64 / 高 65；列表 320；详情 min 520（实宽 900，flex 撑开）；主色 `rgb(29,78,137)`；已完成点 `rgb(15,123,90)`；分块正文 14px / 辅助 12px；上条+左列表+右详情与原型一致 | PASS（Mock） |

## 未验 / 责任外

- 真实入库、向量、FAQ 拦截与改标签后提问：AC-003 / AC-004 / AC-017 / AC-018 / AC-023 / AC-024，由 T-011。
- 本轮未重跑 type-check / lint / build（并行 T-004 可能改同一前端工程；本任务必要项为浏览器用户路径）。
- 用户门禁预览端口 5175：T-005。

## 观察（不计入失败）

- 原型入库中会多「正在分块 / 打标 / 抽 FAQ」步骤句；产品 TC 与 UI-04 要求状态只用三中文。实现按产品文案，详情为「正在入库中…」。
- 切块策略句与 UI-04 示例一致（「按 Markdown 标题与段落切块…」），与原型 `CHUNK_RULE` 措辞略有差别，但含标题与段落、800、80。
- `statusScan.hasIngestingEn=true` 来自测试文件名 `ingesting-demo.md`，不是状态英文。
- 无头 Chrome 截图中文可能乱码；判定以 DOM/`t003-browser-evidence.json` 为准。

## 经验候选

无。
