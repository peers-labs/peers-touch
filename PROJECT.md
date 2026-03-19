# PROJECT

PeerTouch 项目结构

* [apps](./apps)
    * [desktop](./apps/desktop): 桌面端（TypeScript + Tauri）
    * [mobile/flutter](./apps/mobile/flutter): 移动端
    * [mobile/harmony](./apps/mobile/harmony): 鸿蒙占位
    * [station](./apps/station)
        * [app](./apps/station/app): 后端应用
        * [frame](./apps/station/frame): 后端框架
* [packages](./packages)
    * [model](./packages/model): 协议与代码生成中心
    * [sdk](./packages/sdk): 多语言 SDK（go/ts/dart）
    * [ui/desktop](./packages/ui/desktop): 桌面端 UI 包
* [station](./station): 历史目录（迁移后不再作为 app/frame 入口）
* [client](./client): 历史目录（迁移后不再作为 mobile 入口）
* [tooling](./tooling): 统一任务编排与工程工具链

每个目录中如果有md文件，即是该目录的说明文档或与其它模块有关联的设计备忘录。
