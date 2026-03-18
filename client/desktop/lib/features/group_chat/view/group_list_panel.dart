import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/network/group_chat/group_chat_api_service.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/group_chat/controller/group_chat_controller.dart';

/// Panel displaying the list of groups the user belongs to
class GroupListPanel extends StatelessWidget {
  const GroupListPanel({super.key});

  @override
  Widget build(BuildContext context) {
    // Get or create the controller
    final controller = Get.put(GroupChatController());

    return Obx(() {
      if (controller.isLoading.value) {
        return Center(
          child: SizedBox(
            width: UIKit.indicatorSizeSm,
            height: UIKit.indicatorSizeSm,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Theme.of(context).colorScheme.primary,
            ),
          ),
        );
      }

      final groupList = controller.groups.toList();

      if (groupList.isEmpty) {
        return _buildEmptyState(context, controller);
      }

      final currentGroupId = controller.currentGroup.value?.ulid;
      return ListView.separated(
        padding: EdgeInsets.symmetric(vertical: UIKit.spaceXs(context)),
        itemCount: groupList.length,
        separatorBuilder: (_, index) => Divider(
          height: 1,
          thickness: UIKit.dividerThickness,
          color: UIKit.dividerColor(context),
          indent: UIKit.spaceLg(context) + 40 + UIKit.spaceSm(context), // avatar offset
        ),
        itemBuilder: (context, index) {
          final group = groupList[index];
          final isSelected = group.ulid == currentGroupId;
          return _GroupListItem(
            group: group,
            isSelected: isSelected,
            onTap: () => controller.selectGroup(group),
          );
        },
      );
    });
  }

  Widget _buildEmptyState(BuildContext context, GroupChatController controller) {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(UIKit.spaceLg(context)),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
              ),
              child: Icon(
                Icons.group_outlined,
                size: 32,
                color: UIKit.textSecondary(context),
              ),
            ),
            SizedBox(height: UIKit.spaceLg(context)),
            Text(
              '暂无群组',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: UIKit.textPrimary(context),
                  ),
            ),
            SizedBox(height: UIKit.spaceXs(context)),
            Text(
              '创建一个群组开始聊天',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: UIKit.textSecondary(context),
                  ),
            ),
            SizedBox(height: UIKit.spaceLg(context)),
            FilledButton.icon(
              onPressed: controller.refreshGroups,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('刷新'),
              style: UIKit.primaryButtonStyle(context),
            ),
          ],
        ),
      ),
    );
  }
}

class _GroupListItem extends StatelessWidget {
  final GroupInfo group;
  final bool isSelected;
  final VoidCallback onTap;

  const _GroupListItem({
    required this.group,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Material(
      color: isSelected
          ? theme.colorScheme.primaryContainer.withValues(alpha: 0.3)
          : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: UIKit.spaceLg(context),
            vertical: UIKit.spaceSm(context),
          ),
          child: Row(
            children: [
              _buildGroupAvatar(context),
              SizedBox(width: UIKit.spaceSm(context)),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      group.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: UIKit.textPrimary(context),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    SizedBox(height: UIKit.spaceXs(context) / 2),
                    Row(
                      children: [
                        Icon(
                          Icons.people_outline,
                          size: 14,
                          color: UIKit.textSecondary(context),
                        ),
                        SizedBox(width: UIKit.spaceXs(context)),
                        Text(
                          '${group.memberCount} 人',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: UIKit.textSecondary(context),
                          ),
                        ),
                        if (group.type == 2) ...[
                          SizedBox(width: UIKit.spaceSm(context)),
                          Container(
                            padding: EdgeInsets.symmetric(
                              horizontal: UIKit.spaceXs(context),
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.tertiaryContainer,
                              borderRadius: BorderRadius.circular(UIKit.radiusSm(context) / 2),
                            ),
                            child: Text(
                              '公告',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onTertiaryContainer,
                                fontSize: 10,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              if (group.visibility == 2)
                Icon(
                  Icons.lock_outline,
                  size: 16,
                  color: UIKit.textSecondary(context),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildGroupAvatar(BuildContext context) {
    // Generate a consistent color based on group name
    final colorIndex = group.name.hashCode.abs() % Colors.primaries.length;
    final bgColor = Colors.primaries[colorIndex].withValues(alpha: 0.2);
    final fgColor = Colors.primaries[colorIndex];

    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
      ),
      child: (group.avatarCid ?? '').isNotEmpty
          ? ClipRRect(
              borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
              child: Avatar(
                actorId: group.ulid,
                avatarUrl: group.avatarCid,
                fallbackName: group.name,
                size: 40,
              ),
            )
          : Center(
              child: Icon(
                Icons.group,
                color: fgColor,
                size: 22,
              ),
            ),
    );
  }
}
