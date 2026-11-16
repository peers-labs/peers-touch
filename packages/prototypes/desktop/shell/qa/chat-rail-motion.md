# 抽屉集：应力与全集交互候选

状态：`drafting`，可操作 kinetic wireflow；数值、抽屉例外与配色等待整体评审。
所属原型：`docs/architecture/engineering/prototypes/desktop-shell/README.md`。
正式哲学：`docs/architecture/platform/client/ui-system/prototype/drawer-assembly.md`。
Frontend Eles「设计理念」有同源可读说明。

`chat-rail-motion.tsx`只挂载真实`DesignDirections`窗框，没有第二套目录、
会话、写作台或尺寸分配器。通过已有`make run-prototype`服务访问：

- `/?site=frontend-eles&eles=desktop&drawer=assembly`，点击「全屏查看」。
- `&theme=dark`为现有north-star暗色角色适配，不是第二个几何模型。
- `&eles=philosophy`查看完整受力设计；总账继续`drafting`。

全集范围是一级固定底座、二级有限目录、三级工作抽屉及详情/线程内叶，
连同标题、工具、消息状态与Retry、附件、输入、批量操作、焦点和阅读位置。
主动作有三个不同的施力入口：窗口Pull/Push改变约束，分隔线改变用户偏好，
选择会话/详情改变任务深度。偏好和暂时显露量分开。

候选：P=64或160..360内任一连续宽度（默认300），64..160为无稳定位的间隙，
释放时按末段方向吸附到64或160；工作阅读软预算480。框架放大时先恢复
工作湾，再显露目录到P，其余空间继续给工作湾。收窄按相反顺序；E+W=S，
不把目录临时放大成整个舞台。内叶W<800占满，否则320停靠；父层先到位，
返回先收内叶。统一420ms导航导轨曲线单调到位，无越界回弹；手拖直接跟手，
最后1px反向也决定松手方向；取消/窗口变更回滚未提交手势。

宽高从同一父舞台读取，Portal/Gallery/Provider传递有界高度。短高时写作
行数收紧、附件区独立滚动，窄湾把写作工具整组换行；按钮保持完整。
会话桶保存文本、未提交编辑、回复、附件、已录音、光标、线程草稿与阅读
锚点；同一时刻只有当前会话DOM。菜单先处理Esc，再到内叶、主抽屉、Portal。

当前证据包：`/tmp/pt-drawer-admission/`。模型连续36000样本在
`/tmp/pt-drawer-model-evidence.json`；实际canonical窗框的宽高、拖拽、
草稿、附件重试、批量、内叶、焦点、英文/暗色/reduced-motion与Portal检查
在`browser-evidence.json`，截图须实际打开才计入视觉证据。
`review.md`是此前独立评审，最终复审以当前source绑定的包为准。
旧`deliverables/chat-rail-motion-*-20261115`属于已撤除单点候选，不再证明本模型。

真实OS resize、真实麦克风、屏幕阅读器实机、长列表性能与高刷新率体感
保持`UNPROVEN`。浏览器结果不证明生产Tauri已完成；360/480/320、
取消策略与整面抽屉例外没有自动变成已接受生产合同。
