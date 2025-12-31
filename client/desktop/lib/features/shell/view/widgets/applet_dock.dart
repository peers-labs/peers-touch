
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/features/shell/controller/widgets/applet_dock_controller.dart';

class PinnedAppletsDock extends StatelessWidget {

  const PinnedAppletsDock({
    super.key,
    required this.pinnedApplets,
    required this.onAppletTap,
    required this.onReorder,
  });
  final List<AppletManifest> pinnedApplets;
  final Function(AppletManifest) onAppletTap;
  final Function(int oldIndex, int newIndex) onReorder;

  @override
  Widget build(BuildContext context) {
    // Inject controller with a unique tag to avoid conflicts if multiple docks exist
    final controller = Get.put(AppletDockController(), tag: 'pinned_dock');
    final theme = Theme.of(context);
    final tokens = theme.extension<WeChatTokens>()!;

    // Max visible items without scrolling: 4
    const double itemHeight = 64.0;
    const double maxVisibleHeight = itemHeight * 4;
    
    // Calculate actual height based on items, capped at max
    final double actualHeight = (pinnedApplets.length * itemHeight).clamp(0.0, maxVisibleHeight);

    return MouseRegion(
      onEnter: (_) => controller.onHover(true),
      onExit: (_) => controller.onHover(false),
      child: AnimatedBuilder(
        animation: controller.breathingAnimation,
        builder: (context, child) {
          return Obx(() {
            final isHovering = controller.isHovering.value;
            return Container(
              margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: isHovering 
                    ? tokens.bgLevel3.withValues(alpha: 0.3) 
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: isHovering
                      ? tokens.brandAccent.withValues(alpha: controller.breathingAnimation.value * 0.5)
                      : Colors.transparent,
                  width: 1.5,
                ),
              ),
              child: SizedBox(
                height: actualHeight,
                child: ScrollConfiguration(
                  behavior: ScrollConfiguration.of(context).copyWith(scrollbars: false),
                  child: ReorderableListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
                    padding: EdgeInsets.zero,
                    buildDefaultDragHandles: false,
                    itemCount: pinnedApplets.length,
                    onReorder: onReorder,
                    proxyDecorator: (child, index, animation) {
                      return Material(
                        color: Colors.transparent,
                        child: Container(
                          decoration: BoxDecoration(
                            color: tokens.bgLevel3,
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.1),
                                blurRadius: 8,
                                offset: const Offset(0, 4),
                              )
                            ],
                          ),
                          child: child,
                        ),
                      );
                    },
                    itemBuilder: (context, index) {
                      final applet = pinnedApplets[index];
                      return ReorderableDragStartListener(
                        key: ValueKey(applet.appId),
                        index: index,
                        child: _buildAppletItem(context, applet, tokens),
                      );
                    },
                  ),
                ),
              ),
            );
          });
        },
      ),
    );
  }

  Widget _buildAppletItem(BuildContext context, AppletManifest applet, WeChatTokens tokens) {
    return Container(
      height: 64, // Fixed height per item
      margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 4),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => onAppletTap(applet),
          borderRadius: BorderRadius.circular(12),
          hoverColor: tokens.brandAccent.withValues(alpha: 0.1),
          child: Center(
            child: Tooltip(
              message: applet.name,
              child: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: tokens.bgLevel2, 
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: tokens.divider.withValues(alpha: 0.5)),
                ),
                child: Icon(Icons.extension, size: 24, color: tokens.textPrimary),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
