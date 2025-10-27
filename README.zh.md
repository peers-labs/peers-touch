# [WIP] Peers-Touch-Go

Peers 是一个基于 ActivityPub 协议构建的去中心化社交网络与 AI 服务开发框架。在 Peers Touch 网络中，用户可创建独立账号、发布内容、与他人互动，而所有数据流转不经过中心化服务器；更能通过低代码工具像搭积木一样构建个性化移动应用，直接部署到自己的设备，并无缝集成自定义 AI 能力。核心价值在于：在不牺牲现代互联网便利性的前提下，让用户彻底掌控自己的社交数据与 AI 交互隐私，拒绝大厂对个人数据的强制分析与滥用。

## 为什么需要这个项目

我们生活在一个被大型科技公司主导的世界中，个人信息往往成为强制提交的内容。比如我们的社交平台浏览记录、聊天记录、兴趣数据等，都会被用于 AI 数据分析，进而吸引我们持续投入时间，或者向我们推送广告。

我们的愿景是建立一个没有强制性、霸权性 AI 和大数据的世界——一个以人为本、隐私至上的地方。

在这个理想的世界中，每个人都尊重他人的个人信息，没有隐藏的实体分析我们的数据，没有人侵犯我们的个人生活或追踪我们的私人活动。

这是对隐私回归的呼唤，强调个人边界应该被尊重和守护，倡导以自愿、非强制的方式使用 AI 与社交软件。

## 愿景

在构建一个免受侵入性、普遍性 AI 和大数据侵扰的世界时，我们的主要目标是满足人类的基本需求，特别是在个人隐私和个人自由方面。这个世界将致力于维护以下核心价值观：

* **自由**：确保每个人都可以自由表达和行动，而不被监控或分析
* **尊重**：在这个网络中，每个人的个人信息都得到尊重，未经许可不得访问或使用
* **安全**：保护个人免受数据泄露和隐私侵犯的威胁，确保个人信息的安全
* **归属感**：通过保护个人隐私和鼓励相互尊重，促进更健康、更有凝聚力的社交关系
* **目标**：让每个人在免受外部监控约束的环境中，自由追求个人意义和目标
* **成就**：在保障隐私和自由的环境中，支持个人追求成就和实现潜能
* **先进**：不失现代互联网便利性，提供去中心化的个性化功能扩展，不依靠大企业，也能实现个人app平台

通过这样一个注重隐私的网络，我们旨在创建一个尊重和保护个人权利的社会，让每个人都能在没有不必要的外部干扰下安全地实现潜能。这是对当前技术侵犯隐私的直接回应，也是对更加人性化社会的追求。

## 设计

### ActivityPub 协议

Peers 基于 ActivityPub 协议构建，这是一个去中心化的社交协议，允许用户在不同的社交网络之间进行互动。

### 记忆

Peers Touch 拥有多样化的数据存储能力，将AI使用的多模态数据保存起来，随时转化为AI Prompt，形成个人的AI智能体记忆。

### MVP Flow

## Features

## References

Thanks for those friend projects:  <br />
* [go-fed](https://github.com/go-fed/activity): I learn some implementation ideas from this project. <br />
  * [apcore](https://github.com/go-fed/apcore) 
* [go-ap](https://github.com/go-ap/activitypub): This has truly inspired me to design innovative models and has significantly streamlined my workflow, saving me an immense amount of time. <br />
* [go-micro](https://github.com/micro/go-micro): An excellent framework with powerful design. And earlier years, I was a maintainer of it. Reference to this design saves us a lot of time on How I Should Design The Network Interface. Actually, distributed terminals that running in cloud are also parts of a Cloud-Microservice system.  <br />
* [hertz](https://github.com/cloudwego/hertz) : A high-performance HTTP framework serves as our default federation HTTP server, optimized for efficient and robust handling of network traffic. <br />
* [taipei-torrent](https://github.com/jackpal/Taipei-Torrent): A Torrent client in golang. <br />
* [libp2p](https://github.com/libp2p/go-libp2p): A famous peer-to-peer networking stack. <br />
* [some-papers-docs](https://xorro-p2p.github.io/resources/): Some papers and docs. <br />

## Acknowledgements

