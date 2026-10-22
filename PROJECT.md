# PROJECT

PeerTouch 项目结构

* [apps](./apps)
    * [desktop](./apps/desktop): 桌面端（TypeScript + Tauri）
    * [mobile](./apps/mobile): 单一 Tauri Mobile 产品（React/TypeScript + Rust）
        * [shared presentation](./apps/mobile/src): Android/iOS 共享 Mobile UI 与 runtime projection
        * [Tauri runtime](./apps/mobile/src-tauri): 共享 Rust runtime、typed native plugins 与 generated hosts
        * [Android host](./apps/mobile/src-tauri/gen/android): Android 发布目标
        * [iOS host](./apps/mobile/src-tauri/gen/apple): iOS 发布目标
    * [mobile/harmony](./apps/mobile/harmony): 保留实验目录，不是当前 Client form 或发布目标
    * [station](./apps/station)
        * [app](./apps/station/app): 后端应用
        * [frame](./apps/station/frame): 后端框架
* [model](./model): Proto 契约真源
* [packages](./packages)
    * [model](./packages/model): 生成的 TypeScript Model package
    * [sdk](./packages/sdk): 当前共享 SDK
    * [client packages](./packages): Desktop/Mobile 共享 TypeScript 与 Rust capability packages
    * [ui/desktop](./packages/ui/desktop): 桌面端 UI 包
* [tooling](./tooling): 统一任务编排与工程工具链

每个目录中如果有md文件，即是该目录的说明文档或与其它模块有关联的设计备忘录。
