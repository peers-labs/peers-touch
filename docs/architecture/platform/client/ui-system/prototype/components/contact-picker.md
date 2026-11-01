# ContactPicker · 新建会话联系人选择（迁移增量 3）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-30 · **Owner**: Client Platform / UI System
> **旧来源**：`components/chat/FindPeopleModal.tsx`、`ChatContactsPanel.tsx`、`CreateGroupModal.tsx`
> **前置**：增量 1/2、[SearchField](./search-field.md)

## 1. 产品边界

- **用于**：从联系人中选择一人开启 1:1 会话；已存在会话直接打开，新联系人则在会话轨头部插入并打开。
- **不用于（本轮延后）**：创建群（`CreateGroupModal` 多选/群名）、联邦联系人发现与好友请求流程、
  联系人详情页、邀请/二维码。群创建在后续「群组」增量单独训练。
- 本地 fixture；不接通讯录/联邦解析，不产生真实会话。

## 2. 旧设计审计（新方法论）

- 旧 FindPeople/Contacts 是自绘 antd Modal；新实现用 peers-ui **`Dialog`**（标题/描述/关闭/
  footer 取消）+ 已训练 SearchField + `Avatar` + `Empty`，不自画浮层。
- **关键架构点：令牌与焦点作用域必须覆盖 portal。** Dialog 经 `createPortal` 渲染在
  `UIProvider` 的 `.pt-overlay-host`（`.pt-ui-content` 的兄弟），不在 `.sk-shell` 内：
  1. 皮肤令牌上提到 `UIProvider` 根（`.sk-theme.sk-skin-*`，`--pt-*` 桥接经 `style` 传入，
     因其在内置 tokenVariables 之后合并），窗框与弹层同源；
  2. 内嵌搜索框的方形全局焦点框清零选择器必须写成 `.sk-theme .sf-field input:focus-visible`，
     用 `.sk-shell …` 会漏掉弹层导致黑方角框回归（本轮已实测并加门禁）。

## 3. 状态与交互

打开（「新建会话」）→ 列表（10 人：2 位新联系人标「新联系人」，8 位标「最近对话」）→
找人/建群入口在会话轨「＋」菜单；会话与联系人的搜索统一走外轨全局搜索（⌘K），轨内不再有内联搜索框（增量 29）。
弹窗每次打开清空搜索词；打开时底层内容 `inert`（peers-ui modal 合同）。

## 4. 门禁

`north-star.suite.json`：`picker-open`（Dialog role、10 行、头像方圆、新联系人在列）、
`picker-create`（选新联系人后弹窗关、轨 9 行、唯一选中、标题=阿砚）、
`picker-filter-empty`（无结果空态 + **弹层 input 无方形 outline**）、`picker-cancel`（取消不变）。

## 5. UNPROVEN

真实通讯录/联邦数据源、好友请求权限、群创建、联系人详情、虚拟长列表、
弹层在 390px 的布局、i18n、读屏模态语义实测、晋升 peers-ui 后的组件 API。
