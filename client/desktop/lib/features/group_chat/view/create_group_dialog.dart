import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/group_chat/controller/create_group_dialog_controller.dart';

/// 创建群组对话框
/// StatelessWidget per project convention (ADR-002)
class CreateGroupDialog extends StatelessWidget {
  const CreateGroupDialog({super.key});

  @override
  Widget build(BuildContext context) {
    // Create controller for this dialog
    final controller = Get.put(CreateGroupDialogController());
    final theme = Theme.of(context);

    return Dialog(
      backgroundColor: UIKit.chatAreaBg(context),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480, maxHeight: 640),
        child: Padding(
          padding: EdgeInsets.all(UIKit.spaceXl(context)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // 标题
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primaryContainer,
                      borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                    ),
                    child: Icon(
                      Icons.group_add,
                      color: theme.colorScheme.onPrimaryContainer,
                    ),
                  ),
                  SizedBox(width: UIKit.spaceMd(context)),
                  Text(
                    '创建群组',
                    style: theme.textTheme.titleLarge?.copyWith(
                      color: UIKit.textPrimary(context),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              SizedBox(height: UIKit.spaceXl(context)),

              // 群名称
              _buildSectionLabel(context, '群名称'),
              SizedBox(height: UIKit.spaceXs(context)),
              TextFormField(
                controller: controller.nameController,
                decoration: UIKit.inputDecoration(context).copyWith(
                  hintText: '输入群组名称',
                  prefixIcon: Icon(
                    Icons.edit,
                    color: UIKit.textSecondary(context),
                    size: 20,
                  ),
                ),
                autofocus: true,
              ),
              SizedBox(height: UIKit.spaceLg(context)),

              // 群类型
              _buildSectionLabel(context, '群类型'),
              SizedBox(height: UIKit.spaceXs(context)),
              _buildTypeSelector(context, controller),
              SizedBox(height: UIKit.spaceLg(context)),

              // 可见性
              _buildSectionLabel(context, '可见性'),
              SizedBox(height: UIKit.spaceXs(context)),
              _buildVisibilitySelector(context, controller),
              SizedBox(height: UIKit.spaceLg(context)),

              // 选择成员
              Row(
                children: [
                  _buildSectionLabel(context, '选择成员'),
                  const Spacer(),
                  Obx(() {
                    final count = controller.selectedMembers.length;
                    return Container(
                      padding: EdgeInsets.symmetric(
                        horizontal: UIKit.spaceSm(context),
                        vertical: UIKit.spaceXs(context) / 2,
                      ),
                      decoration: BoxDecoration(
                        color: count >= 2
                            ? theme.colorScheme.primaryContainer
                            : theme.colorScheme.errorContainer,
                        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                      ),
                      child: Text(
                        '已选 $count 人',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: count >= 2
                              ? theme.colorScheme.onPrimaryContainer
                              : theme.colorScheme.onErrorContainer,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    );
                  }),
                ],
              ),
              SizedBox(height: UIKit.spaceXs(context)),

              // 好友列表
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: UIKit.inputFillLight(context),
                    border: Border.all(color: UIKit.dividerColor(context)),
                    borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                  ),
                  child: _buildFriendList(context, controller),
                ),
              ),
              SizedBox(height: UIKit.spaceXl(context)),

              // 按钮
              _buildButtons(context, controller),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSectionLabel(BuildContext context, String label) {
    return Text(
      label,
      style: Theme.of(context).textTheme.titleSmall?.copyWith(
            color: UIKit.textPrimary(context),
            fontWeight: FontWeight.w500,
          ),
    );
  }

  Widget _buildTypeSelector(BuildContext context, CreateGroupDialogController controller) {
    return Obx(() => Row(
          children: [
            _buildTypeChip(context, controller, 1, '普通', Icons.chat_bubble_outline),
            SizedBox(width: UIKit.spaceSm(context)),
            _buildTypeChip(context, controller, 2, '公告', Icons.campaign_outlined),
            SizedBox(width: UIKit.spaceSm(context)),
            _buildTypeChip(context, controller, 3, '讨论', Icons.forum_outlined),
          ],
        ));
  }

  Widget _buildTypeChip(
    BuildContext context,
    CreateGroupDialogController controller,
    int value,
    String label,
    IconData icon,
  ) {
    final theme = Theme.of(context);
    final isSelected = controller.type.value == value;

    return Expanded(
      child: InkWell(
        onTap: () => controller.setType(value),
        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
        child: Container(
          padding: EdgeInsets.symmetric(
            vertical: UIKit.spaceSm(context),
          ),
          decoration: BoxDecoration(
            color: isSelected
                ? theme.colorScheme.primaryContainer
                : UIKit.inputFillLight(context),
            borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
            border: Border.all(
              color: isSelected ? theme.colorScheme.primary : UIKit.dividerColor(context),
            ),
          ),
          child: Column(
            children: [
              Icon(
                icon,
                size: 20,
                color: isSelected
                    ? theme.colorScheme.onPrimaryContainer
                    : UIKit.textSecondary(context),
              ),
              SizedBox(height: UIKit.spaceXs(context)),
              Text(
                label,
                style: theme.textTheme.labelMedium?.copyWith(
                  color: isSelected
                      ? theme.colorScheme.onPrimaryContainer
                      : UIKit.textSecondary(context),
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildVisibilitySelector(BuildContext context, CreateGroupDialogController controller) {
    return Obx(() => Row(
          children: [
            _buildVisibilityChip(context, controller, 1, '公开', Icons.public, '任何人可加入'),
            SizedBox(width: UIKit.spaceSm(context)),
            _buildVisibilityChip(context, controller, 2, '私密', Icons.lock_outline, '需要邀请'),
          ],
        ));
  }

  Widget _buildVisibilityChip(
    BuildContext context,
    CreateGroupDialogController controller,
    int value,
    String label,
    IconData icon,
    String description,
  ) {
    final theme = Theme.of(context);
    final isSelected = controller.visibility.value == value;

    return Expanded(
      child: InkWell(
        onTap: () => controller.setVisibility(value),
        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
        child: Container(
          padding: EdgeInsets.all(UIKit.spaceSm(context)),
          decoration: BoxDecoration(
            color: isSelected
                ? theme.colorScheme.primaryContainer
                : UIKit.inputFillLight(context),
            borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
            border: Border.all(
              color: isSelected ? theme.colorScheme.primary : UIKit.dividerColor(context),
            ),
          ),
          child: Row(
            children: [
              Icon(
                icon,
                size: 20,
                color: isSelected
                    ? theme.colorScheme.onPrimaryContainer
                    : UIKit.textSecondary(context),
              ),
              SizedBox(width: UIKit.spaceSm(context)),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: isSelected
                            ? theme.colorScheme.onPrimaryContainer
                            : UIKit.textPrimary(context),
                        fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                      ),
                    ),
                    Text(
                      description,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: isSelected
                            ? theme.colorScheme.onPrimaryContainer.withValues(alpha: 0.7)
                            : UIKit.textSecondary(context),
                      ),
                    ),
                  ],
                ),
              ),
              if (isSelected)
                Icon(
                  Icons.check_circle,
                  size: 18,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFriendList(BuildContext context, CreateGroupDialogController controller) {
    return Obx(() {
      if (controller.isLoadingFriends.value) {
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

      if (controller.friends.isEmpty) {
        return Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.people_outline,
                size: 48,
                color: UIKit.textSecondary(context),
              ),
              SizedBox(height: UIKit.spaceMd(context)),
              Text(
                '暂无好友',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: UIKit.textSecondary(context),
                    ),
              ),
              SizedBox(height: UIKit.spaceXs(context)),
              Text(
                '请先关注一些用户',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: UIKit.textSecondary(context),
                    ),
              ),
            ],
          ),
        );
      }

      return ListView.separated(
        padding: EdgeInsets.symmetric(vertical: UIKit.spaceXs(context)),
        itemCount: controller.friends.length,
        separatorBuilder: (_, __) => Divider(
          height: 1,
          thickness: UIKit.dividerThickness,
          color: UIKit.dividerColor(context),
          indent: UIKit.spaceLg(context) + 36 + UIKit.spaceSm(context),
        ),
        itemBuilder: (context, index) {
          final friend = controller.friends[index];
          return Obx(() {
            final isSelected = controller.selectedMembers.contains(friend.did);
            return InkWell(
              onTap: () => controller.toggleMember(friend.did),
              child: Padding(
                padding: EdgeInsets.symmetric(
                  horizontal: UIKit.spaceMd(context),
                  vertical: UIKit.spaceSm(context),
                ),
                child: Row(
                  children: [
                    Avatar(
                      actorId: friend.did,
                      avatarUrl: friend.avatarUrl,
                      fallbackName: friend.name,
                      size: 36,
                    ),
                    SizedBox(width: UIKit.spaceSm(context)),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            friend.name,
                            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  color: UIKit.textPrimary(context),
                                  fontWeight: FontWeight.w500,
                                ),
                          ),
                          Text(
                            '@${friend.username}',
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: UIKit.textSecondary(context),
                                ),
                          ),
                        ],
                      ),
                    ),
                    Checkbox(
                      value: isSelected,
                      onChanged: (_) => controller.toggleMember(friend.did),
                    ),
                  ],
                ),
              ),
            );
          });
        },
      );
    });
  }

  Widget _buildButtons(BuildContext context, CreateGroupDialogController controller) {
    final theme = Theme.of(context);
    
    return Obx(() {
      final count = controller.selectedMembers.length;
      final isCreating = controller.isCreating.value;
      
      return Row(
        children: [
          if (count < 2)
            Expanded(
              child: Text(
                '至少选择2人（加上你共3人）',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: UIKit.textSecondary(context),
                ),
              ),
            )
          else
            const Spacer(),
          TextButton(
            onPressed: isCreating ? null : () {
              Get.delete<CreateGroupDialogController>();
              Navigator.of(context).pop();
            },
            child: Text(
              '取消',
              style: TextStyle(color: UIKit.textSecondary(context)),
            ),
          ),
          SizedBox(width: UIKit.spaceMd(context)),
          FilledButton(
            onPressed: controller.canCreate
                ? () async {
                    final success = await controller.createGroup();
                    if (success && context.mounted) {
                      Get.delete<CreateGroupDialogController>();
                      Navigator.of(context).pop();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('群组「${controller.nameController.text}」创建成功'),
                          behavior: SnackBarBehavior.floating,
                        ),
                      );
                    }
                  }
                : null,
            style: UIKit.primaryButtonStyle(context),
            child: isCreating
                ? SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: theme.colorScheme.onPrimary,
                    ),
                  )
                : const Text('创建群组'),
          ),
        ],
      );
    });
  }
}
