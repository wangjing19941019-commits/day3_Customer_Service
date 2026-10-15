# 项目经验

存放位置：`<active_project_path>/.sdd/experience.md`。仅由编排器在修复复验后判断、去重并更新；Developer/Tester 返回建议与证据。开始任务时按关键词检索相关标题，无命中就继续，不读取全部历史。

流程依据：`<harness_root>/harness-core/protocols/experience-loop.md`。经验不覆盖当前项目契约与所选规范；未复验、原因推测、一次性问题留在错误记录，不为每次报错增加条目。

## 条目格式（说明，不是已发生的经验）

实际记录时使用有辨识度的标题，填写：

- 关键词与适用条件：已知的技术栈、版本或触发场景。
- 现象与已证实根因；有效修复；下次如何避免。
- 来源任务或独立 Bugfix 描述；复验日期；证据的项目相对路径和具体章节，交付时返回实际绝对路径。
- 同类复发时更新原条目，说明旧经验未能避免问题的已核实原因，补充新的验证证据；失效结论标明并保留旧来源。

有跨项目价值时在原条目附简短全局候选；经用户授权，由编排器更新 `<harness_root>/memory/harness-experience.md` 并回链对应标题。全局记录不是自动生效的强制规则，不自动修改 Skill 或技术规范。不记录密钥、敏感原始数据或完整日志。

## 异步 SQLAlchemy：读 messages 须 selectinload

- 关键词与适用条件：SQLAlchemy 异步 Session、关系字段、FastAPI TestClient；本项目 `Conversation.messages`。
- 现象：`POST /api/conversations` 在组装响应时读 `messages` 触发 `MissingGreenlet`。已证实：异步 Session 下未预加载关系会隐式 IO。
- 有效修复：`create` / `transfer` 后按 id `get_by_id`，并 `selectinload(Conversation.messages)`。Tester 复验创建/转接路径未再出现 MissingGreenlet。未做去掉 selectinload 的负向对照。
- 下次：凡在异步 Session 中读取关系，先 `selectinload` 或显式查询，不要在序列化时懒加载。
- 来源：T-008；复验 2026-09-13；证据 `.sdd/test-reports/test-T-008.md`（TC-01a/01c）。
- 全局候选：异步 SQLAlchemy 序列化关系前必须预加载。未授权写入全局经验。

## 异步 SQLAlchemy：写子行后 expire 已加载集合再按 id 查询

- 关键词与适用条件：同一请求内先 `selectinload` 集合再 `add` 子行；本项目客服回复写入 `messages`。
- 现象：回复已 flush，但 `waiting_for_agent` 仍为 True、新消息不在响应里。已证实：同一 Session 里集合已加载时，再次 `selectinload` 不刷新 identity map。
- 有效修复：`add_message` 后只 `expire(conversation, ["messages", "updated_at"])`，再用路径上的 `conversation_id` `get_by_id`。Tester 复验 `test_agent_reply_after_transfer` 可见新消息。未做 expire 整对象后再读 `.id` 的负向对照；避免 expire 整对象后同步访问主键。
- 下次：T-009 写员工消息同样先 expire 已加载集合，再按 id 重载。
- 来源：T-008；复验 2026-09-13；证据 `.sdd/test-reports/test-T-008.md`（TC-03b）。
- 全局候选：AsyncSession 写子行后须 expire 已加载集合再查。未授权写入全局经验。

## Markdown 切块：父标题无正文不落空块

- 关键词与适用条件：按 ATX 标题栈切 Markdown；本项目 `chunk_markdown`（800/80）。
- 现象：多级标题时第一块 `heading_path` 只有一级（如 `VPN` 而非 `VPN / Reset`）。已证实：切到子标题时把尚无正文的父标题 flush 成空 section。
- 有效修复：遇到下一标题只在已有正文时落 section。Tester 复验 heading_path 为 `VPN / Reset`、`A / B / C`。
- 下次：标题栈切块不要为无正文的父标题单独成块。
- 来源：T-007；复验 2026-09-13；证据 `.sdd/test-reports/test-T-007.md`（TC-02）。
- 全局候选：Markdown 标题路径切块跳过无正文父级。未授权写入全局经验。

## Mock 订单匹配：无「两笔」只自动填一条

- 关键词与适用条件：客服填单 Mock；订单中心按商品关键词模糊匹配；本项目 `frontend/src/mocks/tickets.ts`。
- 现象：「昨天买的蓝色手机」被收成两条候选。已证实：目录里两笔订单都含同一关键词，未要求用户说出「两笔」时仍走了多条分支。
- 有效修复：只有原话出现「两笔」或「两条」才列候选且不预选；否则只自动填一条。Tester 复验一条填 `JD20260922001`，「两笔」才出现两个候选。
- 下次：单条和多条要用明确说法触发，不能只靠关键词重叠。
- 来源：T-031；复验 2026-09-23；证据 `.sdd/test-reports/test-T-031.md`。
- 全局候选：无。这是本项目 Mock 规则，不写入全局经验。

## Mock 润色：保留会话里的时效数字

- 关键词与适用条件：客服润色 Mock；原稿含「超时间了」，会话政策含「7 天」。
- 现象：润色稿只写「可退时效」，被判成改了时效，不能采用。已证实：合规检查要求稿内保留会话或原稿中的时效数字。
- 有效修复：润色稿写明「超过 7 天」后可以对比并采用。Tester 复验该句可对比；「一定全额退，赔500元」仍不能采用。
- 下次：润色只改语气时，不要删掉会话里已经出现的天数或金额。
- 来源：T-031；复验 2026-09-23；证据 `.sdd/test-reports/test-T-031.md`。
- 全局候选：无。未授权写入全局经验。

## 隔离 uvicorn 不热加载：新路由要重启进程才验得到

- 关键词与适用条件：本项目 FastAPI 用独立 `t0xx_serve.py` 起 uvicorn，且不用 `--reload`；`pycore` 的 `use_env=False`，进程环境变量改不了 `database_path`。
- 现象：工单列表没有 `id`，客服工作台不显示进度，`GET /api/tickets/{id}` 为 405。已证实：代码里已经补了列表 `id`、单张工单 GET，以及工作台和管理端对 `progress.detail` 的展示，但当时 8109 仍是旧进程。重启并改用隔离库后，同一路径变为 200，页面能看到「已发起退货」或失败说明。未对照旧二进制做负向实验。
- 有效修复：列表项带 `id`；与列表并存的详情用 GET 返回 `progress`；工作台和只读列表渲染 `detail`。验收前停掉旧进程，在内存里指定隔离库再启动，不要用 `--reload`，也不要靠环境变量改库路径。
- 下次：联调若要验证刚加上的路由或页面，先确认当前进程就是这版代码。不要拿仍在跑的旧端口当作新接口不存在。
- 来源：T-052；复验 2026-09-23；证据 `.sdd/test-reports/test-T-052.md`（复验一节）。
- 全局候选：不用热加载的 uvicorn 不会自动带上新路由，验收前要重启自己的进程。未授权写入全局经验。
