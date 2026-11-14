# Actor-Owned Moments：组件落地清单

采用已确认 glass 原型。来源钉版为 show worktree commit
`2e7bcc9e19a8f7e2df52e45b965df60f27bf0262`；本工作区基线
`fe4c68406c875bbc7dcd53f490e44dedfe7c3549`。两版 Moments 的差异为紧凑范围选择器和
排序浮层内缩，这两项已同步；公开正文编辑是本次 v1 合同的必要增量。
原型示例数据只留在 `packages/prototypes`。
`MomentsFeature.tsx` 只持有示例投影、草稿、导航和本地命令，排序滚动宿主显式传给
共享控件。其 `moments.css` 仅保留页面区域布局；控件的材质、几何、测量和动效统一由
`packages/ui/web/src/moments.css` 及上述共享组件持有，不保留第二套原型实现。

每项按展示、数据、命令、生命周期分别定主。入库表示源码归属，不能代替生产验收。

- **IdentityCard / IdentityTrigger**：入 `packages/ui/web/src/identity-card.tsx`。
  身份、关系、最近动态、文案由消费者提供；库管 popover、关闭和焦点。原型旧展示文件删除。
- **AuthorCard**：现成 IdentityCard 的领域数据组合；`AuthorCard.tsx` 只适配原型数据。
  生产消费 canonical actor profile，不复制名片 UI。
- **ImageGrid / Lightbox**：入 `packages/ui/web/src/image-grid.tsx`；同源的原型与生产消费者。
  库管 1–9 图几何、具名触发、索引、键盘和模态；OSS/native 解码仍归原 Resource Owner。
  生产 `MomentAttachments` 只适配资源与本地化；旧 ImageGrid/ImageLightbox/ImageThumbnail 删除。
- **FollowButton**：入 `identity-card.tsx`，受控关注状态及 execution。关系真值/命令留原 Store；
  `MomentRelationshipAction` 只绑定关系动作，旧 app FollowButton 删除。
- **UserProfileHeader**：入 `packages/ui/web/src/moment-card.tsx`；
  生产 canonical profile/计数及原型 ProfileView 共用展示，app 头部仅适配数据与命令。
- **MomentCard / MomentAuthor / MomentTrustMeta / MomentReactionBar**：入 `moment-card.tsx`；
  原型与生产共用正文、信任行、动作和评论槽，旧 card/动作条/信任行的展示删除。
  私密 Native 状态、签名写、评论/reaction 和投影继续归原 Runtime。
  生产作者名片通过 `MomentAuthorTrigger` 适配 canonical actor 与真实关系，打开时交 Runtime 读取。
  拉黑与取消拉黑已接原签名关系命令；仅接受匹配的 COMMITTED/DUPLICATE 结果，
  原 Social Runtime 负责启动/周期拉黑名单和关系状态。Feed 消费该名单，
  已打开个人页保留公共内容浏览。
- **FeedSortFloat**：入 `packages/ui/web/src/feed-sort-float.tsx`；
  原型和生产合并流共用。库管滚动/测量/变形，Store 管用户选择；`momentsTimeline.ts`
  合并原 HOME/Public 窗口、对象去重及确定性时间排序，两路游标不变。
- **MomentCommentRow / MomentCommentComposer**：入 `moment-comments.tsx`；
  原型与生产共用行、回复块、输入/状态组合。生产保留 IME/提及、失败草稿和 Native 私密状态，
  评论只按时间，身份名片和删除确认复用原 Owner。评论点赞协议仍须核实与闭合。
- **MomentScopeBar**：入 `moment-scope-bar.tsx`；原型与生产两范围及搜索/动作槽共用。
  原 Explore/UserSearch 页面及旧 SocialScopeBar/SocialComposer/SocialContentRail 删除。
- **ComposeDialog**：已有 Dialog/TextArea/Select/FilePicker 组合；草稿、媒体上传、受众校验和
  public/private 命令分流由 app 数据容器持有；展示已入 `moment-composer.tsx`，
  原型与生产共用 `MomentComposerSurface/MomentAudiencePicker`，旧预览展示删除。
- **StatGrid**：入 `moment-card.tsx`；原型消费已切换，真实统计投影仍由 Runtime 提供。
  生产本人统计已接原 `social_get_my_stats`，Runtime 周期刷新与 Actor 栅栏控制；
  个人简介取原 canonical profile，未取得的计数用 `—`。
- **ProfileView**：app 导航与数据容器；展示复用 UserProfileHeader 与 MomentCard。
- **CircleCreateDialog / CircleManageDialog**：展示已入 `moment-circles.tsx`，
  原型与生产共用 `MomentCircleEditor`；取消丢弃成员草稿，保存才调用原 Circles Store。
  既有批量增删与 rename 分别提交；失败保留草稿并读取实际结果，不冒充原子保存。
- **CirclesView**：app 数据容器；分组卡和头像聚合已入 `MomentCircleCard`。
  原 app 的 Card/List/Modal/即时成员选择展示删除。未取得完整成员时禁用管理，
  原 Station/Native 读 Owner 已支持完整有界分页，成员按加入时间与 PTID 排序；
  读失败保留上次完整数据并禁用管理，迟到结果不能覆盖已确认的成员变更。
  初始化成员与圈子创建同事务回滚，已有编辑保存仍遵循原独立命令合同。

AFL-08A/08B 当前仍为 PARTIAL。卡片、个人头部、评论行、范围栏和排序浮层已共用展示；
生产两范围、合并时间线、就近搜索与本人统计已接入，Runtime 持有评论可见范围生命周期。
发布器和圈友展示已共用并纳入 catalogue、ElementSamples 和原场景；圈友分页和
拉黑命令源码已接通。评论点赞、投票及这些动作的当前源码 Native 证明尚未闭合。
旧数据/Runtime 的删除以实际 Owner 替换为前提，不能删除在役 private E2EE 能力。
