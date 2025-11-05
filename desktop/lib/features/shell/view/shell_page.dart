import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';

import 'package:peers_touch_desktop/features/shell/controller/shell_controller.dart';

class ShellPage extends StatelessWidget {
  const ShellPage({super.key});

  // 尺寸规范（取推荐范围中值）
  static const double minWidth = 1200;
  static const double maxWidth = 2560;
  static const double leftMin = 240;
  static const double leftMax = 320;
  static const double rightMin = 240;
  static const double rightMax = 320;
  static const double rightCollapsedWidth = 48;

  static const double leftTopH = 110;
  static const double leftBottomH = 90;
  static const double centerTopH = 60;
  static const double centerBottomH = 56;
  static const double rightTopH = 60;

  @override
  Widget build(BuildContext context) {
    final c = Get.find<ShellController>();
    return Scaffold(
      backgroundColor: const Color(0xFF1E1E1E),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final screenW = constraints.maxWidth;
          final screenH = constraints.maxHeight;
          final baseW = screenW.clamp(minWidth, maxWidth);

          // 计算左右宽度（按20%比例并在最小/最大内夹住）。右侧可折叠。
          final proposedSide = baseW * 0.20;
          final leftW = proposedSide.clamp(leftMin, leftMax);
          final rightExpandedW = proposedSide.clamp(rightMin, rightMax);

          return Center(
            child: SizedBox(
              width: baseW,
              height: screenH,
              child: Obx(() {
                final rightW = c.rightCollapsed.value ? rightCollapsedWidth : rightExpandedW;
                final centerW = baseW - leftW - rightW;
                return Row(
                  children: [
                    // 左侧栏
                    SizedBox(
                      key: const Key('left-column'),
                      width: leftW,
                      height: screenH,
                      child: Column(
                        children: [
                          _SectionContainer(height: leftTopH),
                          Expanded(
                            child: _ScrollableContainer(
                              child: _LeftEntries(selected: c.selected, onSelect: c.select),
                            ),
                          ),
                          _SectionContainer(height: leftBottomH),
                        ],
                      ),
                    ),
                    // 中间栏
                    SizedBox(
                      key: const Key('center-column'),
                      width: centerW,
                      height: screenH,
                      child: Column(
                        children: [
                          _SectionContainer(height: centerTopH),
                          Expanded(
                            child: Container(
                              color: const Color(0xFF202020),
                              child: Obx(() => IndexedStack(
                                    index: c.selected.value.index,
                                    children: ShellScene.values
                                        .map((_) => _CenterContent(count: c.count))
                                        .toList(),
                                  )),
                            ),
                          ),
                          // 底部栏：包含加号按钮（满足现有测试）
                          _SectionContainer(
                            height: centerBottomH,
                            child: Align(
                              alignment: Alignment.centerRight,
                              child: IconButton(
                                icon: const Icon(Icons.add, color: Colors.white),
                                onPressed: c.increment,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    // 右侧栏
                    SizedBox(
                      key: const Key('right-column'),
                      width: rightW,
                      height: screenH,
                      child: Column(
                        children: [
                          _SectionContainer(
                            height: rightTopH,
                            child: Align(
                              alignment: Alignment.centerRight,
                              child: IconButton(
                                icon: Obx(() => Icon(
                                      c.rightCollapsed.value ? Icons.chevron_right : Icons.chevron_left,
                                      color: Colors.white,
                                    )),
                                onPressed: c.toggleRight,
                              ),
                            ),
                          ),
                          Expanded(
                            child: _ScrollableContainer(),
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              }),
            ),
          );
        },
      ),
    );
  }
}

// 左侧条目（仅占位，不承载具体内容）
class _LeftEntries extends StatelessWidget {
  final Rx<ShellScene> selected;
  final void Function(ShellScene) onSelect;
  const _LeftEntries({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Obx(() => Column(
          children: ShellScene.values
              .map(
                (scene) => _EntryItem(
                  active: selected.value == scene,
                  onTap: () => onSelect(scene),
                ),
              )
              .toList(),
        ));
  }
}

class _EntryItem extends StatelessWidget {
  final bool active;
  final VoidCallback onTap;
  const _EntryItem({required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        height: 44,
        margin: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
        decoration: BoxDecoration(
          color: active ? const Color(0xFF2D2D2D) : const Color(0xFF262626),
          borderRadius: BorderRadius.circular(8),
        ),
      ),
    );
  }
}

// 中间内容占位：显示计数与占位骨架边框
class _CenterContent extends StatelessWidget {
  final RxInt count;
  const _CenterContent({required this.count});

  @override
  Widget build(BuildContext context) {
    final i18n = AppLocalizations.of(context);
    return Obx(() => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(i18n.general, style: const TextStyle(color: Colors.white, fontSize: 16)),
              Text(
                '${count.value}',
                style: const TextStyle(color: Colors.white, fontSize: 18),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    border: Border.all(color: const Color(0xFF3A3A3A)),
                    color: const Color(0xFF222222),
                  ),
                ),
              ),
            ],
          ),
        ));
  }
}

// 可滚动容器：细滚动条，默认隐藏（Flutter默认即可）
class _ScrollableContainer extends StatelessWidget {
  final Widget? child;
  const _ScrollableContainer({this.child});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return Container(
          color: const Color(0xFF202020),
          child: SingleChildScrollView(
            child: ConstrainedBox(
              constraints: BoxConstraints(minHeight: constraints.maxHeight),
              child: child ?? SizedBox(height: constraints.maxHeight),
            ),
          ),
        );
      },
    );
  }
}

// 区域容器：固定高度，纯结构占位
class _SectionContainer extends StatelessWidget {
  final double height;
  final Widget? child;
  const _SectionContainer({required this.height, this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      color: const Color(0xFF2D2D2D),
      child: child,
    );
  }
}