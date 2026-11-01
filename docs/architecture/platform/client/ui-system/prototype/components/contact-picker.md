# ContactPicker · 找人/新建会话无头选择器（迁移增量 3，增量 35 重做，增量 37 补身份态）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-30 · **Updated**: 2026-11-02（增量 37：联邦行 PTID 行 + 自己/已是好友身份态）
> · 2026-11-01（增量 35：无头化 + 联邦目录查找）
> · **Owner**: Client Platform / UI System
> **旧来源**：`components/chat/FindPeopleModal.tsx`、`ChatContactsPanel.tsx`、`CreateGroupModal.tsx`
> **真身对齐**：desktop `components/chat/FindPeopleModal.tsx`（scope chips、`@user@host` 解析、
> 好友请求状态机）
> **前置**：[SearchField](./search-field.md)

## 1. 产品边界

- **用于**：选择一人开启 1:1 会话；已知人（联系人 + 最近会话）直接打开/新建会话；
  联邦目录里的**陌生人**只能发好友请求，不直接开会话。
- **不用于**：创建群（[群 Dialog](./chat-catalog.md) 多选/群名）、真实联邦解析与请求传输、
  联系人详情页、邀请/二维码。
- 本地 fixture；目录为确定性种子（`FEDERATION_DIRECTORY`），不产生真实请求。

## 2. 无头合同（增量 35）

信息冗余归零：打开后屏幕第一行就是搜索框，其下立即是结果。**禁止**标题、说明描述、
footer 取消钮、解释性 tip 段落——「带找人图标的搜索框 + 结果」自身已说明功能。

- `Dialog` 头被 scoped CSS 隐藏（`.sk-picker-dialog .pt-dialog-header { display:none }`），
  关闭控件是搜索行右侧唯一 ✕（`picker.close`）；Esc 与遮罩点击仍走 modal 合同。
- 搜索框 `autoFocus`、leading 放大镜；placeholder 是**功能性语法提示**
  （`搜索联系人、@用户名 或 @user@host`），不是解释文案。
- 搜索行只有一个 ✕：不再使用 TextField 的 clearable，避免「清除/关闭」双 ✕。
- 每次打开重置 query/scope/请求状态（真身 `destroyOnHidden` 语义）。

## 3. 查找模型（对齐真身 FindPeopleModal）

- **scope**：peers-ui `Segmented` 两项——全部 / 联邦（Globe 图标）。
  全部 = 已知人 + 联邦目录；联邦 = 仅目录。`data-picker-scope` 挂在容器。
- **空查询 · 全部**：直接列出全部已知人（11 行；本站 + 联邦已知联系人 + 最近会话），
  这是相对真身"先看 hint"保留的优点。
- **前缀搜索**：输入即时过滤已知人；同时在联邦目录按 名字/handle/站名/简介 前缀匹配，
  命中时以独立「联邦」分区展示（与「联系人」分区仅在两区都有结果时出小标题）。
- **handle 精确解析**：`@user@host` 形态只在目录里做唯一直属解析，
  抑制已知人结果；未解析到 → 空态（真身 `federationResolve` 语义）。
- **联邦行**：方圆头像 + 姓名 + ✓已验证 Tag + 站名 Tag + `@user@host` handle 副行 +
  PTID 副行（`.sk-fed-ptid[data-fed-ptid]`，显示联邦 actor id，对齐真身身份标识）+
  尾列动作钮。行身份由 `data-fed-state` 四态机决定（`PickPersonDialog` 经新增 props
  `friends` 与 `selfName` 推导）：
  - `available`：陌生人，钮 primary「发送请求」，点击翻 `pending`；
  - `pending`：已发请求，钮 secondary + disabled「等待通过」（真身 awaiting-approval）；
  - `friend`：目录命中的人已是好友（同名同站），钮 secondary + disabled「已是好友」；
  - `self`：命中当前观众（`selfName`，种子为 `VIEWER_NAME`），钮 secondary + disabled「自己」。
  只有 `available` 可动作；其余三态禁用原因即状态串。行本身不可点开会话（杜绝 button 嵌 button）。
- **空态**：唯一允许的零结果提示，联邦 scope 空查询时给功能性引导文案
  （输入名字或 @user@host），不写成 tip 段落。

## 4. 旧设计审计

- 增量 3 初版是带标题「新建会话」+ 描述 + 底部计数 tip + footer 取消的 Dialog，
  解释性文字三行、主体检索被压到第二屏；增量 35 全部删除。
- 初版只能搜本地已知人，联邦只能从种子联系人里碰到；增量 35 引入独立目录种子与
  scope/handle 两套查找路径，对齐真身能力面（传输/轮询仍 UNPROVEN）。
- 弹层 portal/令牌/焦点规则不变（见下，增量 3 踩坑保留）。

### 弹层架构（增量 3 踩坑，持续有效）

peers-ui Dialog 经 `createPortal` 渲染在 `UIProvider` 的 `.pt-overlay-host`
（`.sk-shell` 外）：皮肤令牌在 `UIProvider` 根桥接（`--pt-*`），窗框与弹层同源；
弹层内交互的探针操作必须用 `clickGlobal`/全局 oracle，`.sk-shell` 作用域选择器
（如旧版 `.sk-picker input` 局部 type）会命不中。

## 5. 状态与交互

打开（会话轨「＋」→ 找人）→ 无头搜索框聚焦 + 已知人列表 → 输入即时过滤 /
切联邦 scope / handle 解析 → 点已知人直接打开并关闭弹窗；点陌生人「发送请求」翻状态，
弹窗保留（真身发送后停留，由 message 反馈，本地仅行内翻态）。

## 6. 门禁

`north-star.suite.json`：

- `picker-open`：无头断言（header `display:none`、无 description/footer/tip）、
  首行 `[data-picker-query]`、scope 存在、空态 11 个已知行、0 联邦行、头像方圆。
- `picker-create`：点第 5 行（老周）直接创建并选中、轨 7→8、弹窗关。
- `picker-filter-empty`：无命中出 peers-ui `Empty`，弹层 input 无方形 outline。
- `picker-cancel`：搜索行 ✕（`picker.close`）关闭且会话数不变。
- `picker-federation-discover`（35，37 增 `ptid-line`）：搜「青衫」→ 1 联邦行，
  站名/handle/已验证/PTID 行可见（全局 `[data-fed-ptid]` 断言）；
  发送请求 → `data-fed-state=pending`、钮 `aria-disabled`、文案「等待通过」、已知人 0 行。
  自己 / 已是好友态由同型 disabled 钮表达（`data-fed-state=self|friend`）。
- `picker-federation-scope`（35）：切联邦后已知人 0 行、空查询功能空态、搜「晚」只出晚舟。
- `picker-handle-resolve`（35）：`@muyun@seeds.local` 精确 1 行且抑制已知人；
  未知 handle → 0 行 + 空态。

## 7. UNPROVEN

真实通讯录/联邦目录数据源与 `@user@host` 网络解析、好友请求传输/撤回/状态同步、
联邦 MLS 群边界之外的跨站会话、联系人详情、虚拟长列表、
弹层在 390px 的真机读屏模态语义、i18n 完整走读、晋升 peers-ui 后的组件 API
（候选：无头 `SearchPickerDialog`：搜索首行 + scope + 分区结果 + 行尾动作槽）。
