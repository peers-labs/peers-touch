# PROJECT

PeerTouch 项目结构

* [station](./station): 后端领域（golang）
    * [frame](./station/frame): 框架
    * [app](./station/app): 业务服务
* [desktop](./desktop): 桌面端领域（Tauri + TypeScript + CSS）
* [mobile](./mobile): 移动端领域（Flutter + 鸿蒙占位）
    * 当前 Flutter 实现在 [client/mobile](./client/mobile)
* [model](./model): 跨端领域模型与协议
* [tooling](./tooling): 统一任务编排与工程工具链

每个目录中如果有md文件，即是该目录的说明文档或与其它模块有关联的设计备忘录。
