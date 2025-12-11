# 各平台发帖功能对比（ActivityPub、Mastodon、微信、QQ、Facebook、Twitter/X、微博）

| 平台/协议 | 发布入口 / API | 文本限制 | 富文本与格式 | 媒体类型 / 上限 | 话题/提及/链接预览 | 可见性 / 隐私 | 内容预警 / 敏感 | 转发 / 引用 | 编辑 / 删除 | 投票 / 其他 |
|---|---|---|---|---|---|---|---|---|---|---|
| ActivityPub | Outbox 发送 `Create`，对象常用 `Note`；HTTP 签名 | 协议不限制，由实例策略控制 | `content` 支持 HTML；`summary` 可作 CW；`tag` 中 `Mention`/`Hashtag` | `attachment`: Image/Video/Audio/Document，上限由服务器策略 | `tag` 结构化提及与标签；链接预览由实例实现 | 通过 `to`/`cc`/`audience` 控制（如 `Public`、关注者等） | `summary` + 实例自定义 `sensitive` 标记 | `Announce`（转发/Boost）；`inReplyTo`（回复）；引用通常以链接实现 | `Delete` 删除；`Update` 可用于编辑（兼容性依实例） | `Question` 原生投票对象 |
| Mastodon | REST：`POST /api/v1/statuses` | 典型默认约 500 字符（实例可调） | 轻量 HTML；`spoiler_text`（CW）；`sensitive` 媒体 | 图片最多 4；视频/GIFV 1；自带 alt 文本 | `#` 话题、`@user@domain` 提及；链接卡片 | `visibility`: public/unlisted/private/direct | 原生 CW；敏感媒体需标记 | `reblog`（boost）；支持引用转发（版本依赖） | 支持编辑并保留历史；支持删除 | `poll`（最多 4 选项，限时） |
| 微信（朋友圈） | 客户端；无公开 API | 文本较长，超长折叠显示 | 基本文字+表情；文章富文本在公众号 | 图片最多 9；视频 1；位置可选 | @提及（通讯录）；链接预览受限 | 公开/私密/部分可见/不给谁看 | 无 CW；敏感依平台规则 | 转发到聊天/收藏等；无公开转发到朋友圈 | 不支持编辑；支持删除 | 无原生投票（小程序可扩展） |
| QQ（空间“说说”） | 客户端；公开 API 极少 | 文本较长，超长折叠 | 基本文字+表情 | 图片/视频（常见上限与朋友圈类似） | 话题与@提及；链接预览 | 公开/好友/分组/私密 | 无 CW；敏感依平台规则 | 转发到空间/聊天 | 通常不支持编辑；支持删除 | 投票不常见（活动型为主） |
| Facebook | Graph API（页/应用）：`/{page-id}/feed` 等 | 文本很长（级别万字）；产品页与用户略有差异 | 富文本有限；链接卡片；@提及 | 多图/视频/直播等；大尺寸 | `#` 话题、@提及、丰富链接预览 | Public/Friends/Specific/Custom | 无原生 CW；敏感与审核策略 | Share、Quote（附加评论） | 支持编辑（显示“已编辑”）；支持删除 | 群组原生投票；活动、直播等丰富 |
| Twitter / X | v2 `POST /tweets` | 标准约 280；付费账号可长文 | 轻量格式；链接卡片；@提及、`#` | 图片最多 4；视频/GIF 1 | 话题与@提及；链接预览 | 默认公开；Circle/Communities 可选 | 无 CW；敏感媒体需标记 | Retweet、Quote Tweet | 付费账号支持编辑；支持删除 | 原生投票（时长与选项限制） |
| 微博 | 开放平台：`statuses/update` | 典型上限约 2000（长微博以卡片展现） | 富文本有限；`#话题#`；@提及 | 多图/视频；大图支持 | `#话题#`、@提及、链接卡片 | 公开/仅自己可见/粉丝等 | 无原生 CW；敏感依审核策略 | 转发并可附评论；评论线程 | 通常不支持编辑；支持删除 | 活动型投票、超话等扩展 |

## 关键差异与设计要点
- 协议 vs 平台：ActivityPub/Mastodon 是开放协议/联邦平台，字段可映射；微信/QQ/微博/Facebook/Twitter 为各自平台规则与私有 API。
- 可见性模型：ActivityPub 以 `to/cc` 精细控制；Mastodon 四级可见性；微信/QQ 强隐私分组；Facebook 支持自定义受众；Twitter 默认公开；微博简化为公开/仅自己可见等。
- CW 与敏感：Mastodon/ActivityPub 原生支持 CW/敏感；其余平台主要依平台审查与敏感标记，无统一 CW 字段。
- 媒体上限：联邦平台和 Twitter/Mastodon 普遍“4 图 / 1 视频”模型；微信/QQ/微博更偏“9 图 + 1 视频”。
- 引用/转发语义：ActivityPub 是 `Announce`；Mastodon为 boost/引用；Twitter 为 Retweet/Quote；Facebook 为 Share；微博为转发+评论。
- 编辑能力：Mastodon 支持编辑留痕；Twitter 为付费编辑；Facebook可编辑；微信/QQ/微博通常不支持编辑但允许删除。
- 投票：ActivityPub 有 `Question`；Mastodon/Twitter 原生投票；Facebook群组投票；微信/QQ/微博多以活动或小程序形式间接实现。

## 我们的发帖字段建议（面向跨平台/联邦兼容）
- 用户提交字段：`text`（正文）、`attachments[]`（媒体）、`altText`、`cw`（内容预警开关与文案）、`sensitive`、`tags[]`（话题/提及）、`replyTo`、`visibility`、`audience[]`、`location`、`poll`。
- 联邦映射：`Create(Note)`、`content`、`summary(cw)`、`attachment[]`、`tag[]`、`inReplyTo`、`to/cc`、`Question`。
- 平台降级策略：当平台不支持 CW/编辑/投票/富文本时，自动降级为安全的可用表现（例如 CW 变首行提示、编辑改“追加修订”、投票改文本+链接、富文本转为纯文本）。
