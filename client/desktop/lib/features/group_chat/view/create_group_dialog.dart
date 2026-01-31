import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/network/social/social_api_service.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/group_chat/controller/group_chat_controller.dart';

/// 创建群组对话框
class CreateGroupDialog extends StatefulWidget {
  const CreateGroupDialog({super.key});

  @override
  State<CreateGroupDialog> createState() => _CreateGroupDialogState();
}

class _CreateGroupDialogState extends State<CreateGroupDialog> {
  final _nameController = TextEditingController();
  int _type = 1; // 1=普通群, 2=公告群, 3=讨论群
  int _visibility = 1; // 1=公开, 2=私密
  bool _isCreating = false;
  bool _isLoadingFriends = true;

  final _selectedMembers = <String>{};
  List<_FriendInfo> _friends = [];

  @override
  void initState() {
    super.initState();
    _loadFriends();
  }

  Future<void> _loadFriends() async {
    try {
      final socialApi = SocialApiService();
      final response = await socialApi.getFollowing();
      setState(() {
        _friends = response.following
            .map((f) => _FriendInfo(
                  did: f.actorId,
                  name: f.displayName.isNotEmpty ? f.displayName : f.username,
                  username: f.username,
                  avatarUrl: f.avatarUrl,
                ))
            .toList();
        _isLoadingFriends = false;
      });
    } catch (e) {
      setState(() => _isLoadingFriends = false);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
                controller: _nameController,
                decoration: UIKit.inputDecoration(context).copyWith(
                  hintText: '输入群组名称',
                  prefixIcon: Icon(
                    Icons.edit,
                    color: UIKit.textSecondary(context),
                    size: 20,
                  ),
                ),
                autofocus: true,
                onChanged: (_) => setState(() {}),
              ),
              SizedBox(height: UIKit.spaceLg(context)),

              // 群类型
              _buildSectionLabel(context, '群类型'),
              SizedBox(height: UIKit.spaceXs(context)),
              _buildTypeSelector(context),
              SizedBox(height: UIKit.spaceLg(context)),

              // 可见性
              _buildSectionLabel(context, '可见性'),
              SizedBox(height: UIKit.spaceXs(context)),
              _buildVisibilitySelector(context),
              SizedBox(height: UIKit.spaceLg(context)),

              // 选择成员
              Row(
                children: [
                  _buildSectionLabel(context, '选择成员'),
                  const Spacer(),
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: UIKit.spaceSm(context),
                      vertical: UIKit.spaceXs(context) / 2,
                    ),
                    decoration: BoxDecoration(
                      color: _selectedMembers.length >= 2
                          ? theme.colorScheme.primaryContainer
                          : theme.colorScheme.errorContainer,
                      borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                    ),
                    child: Text(
                      '已选 ${_selectedMembers.length} 人',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: _selectedMembers.length >= 2
                            ? theme.colorScheme.onPrimaryContainer
                            : theme.colorScheme.onErrorContainer,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
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
                  child: _buildFriendList(context),
                ),
              ),
              SizedBox(height: UIKit.spaceXl(context)),

              // 按钮
              Row(
                children: [
                  if (_selectedMembers.length < 2)
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
                    onPressed: _isCreating ? null : () => Navigator.of(context).pop(),
                    child: Text(
                      '取消',
                      style: TextStyle(color: UIKit.textSecondary(context)),
                    ),
                  ),
                  SizedBox(width: UIKit.spaceMd(context)),
                  FilledButton(
                    onPressed: _canCreate ? _createGroup : null,
                    style: UIKit.primaryButtonStyle(context),
                    child: _isCreating
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
              ),
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

  Widget _buildTypeSelector(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      children: [
        _buildTypeChip(context, 1, '普通', Icons.chat_bubble_outline),
        SizedBox(width: UIKit.spaceSm(context)),
        _buildTypeChip(context, 2, '公告', Icons.campaign_outlined),
        SizedBox(width: UIKit.spaceSm(context)),
        _buildTypeChip(context, 3, '讨论', Icons.forum_outlined),
      ],
    );
  }

  Widget _buildTypeChip(BuildContext context, int value, String label, IconData icon) {
    final theme = Theme.of(context);
    final isSelected = _type == value;

    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _type = value),
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

  Widget _buildVisibilitySelector(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      children: [
        _buildVisibilityChip(context, 1, '公开', Icons.public, '任何人可加入'),
        SizedBox(width: UIKit.spaceSm(context)),
        _buildVisibilityChip(context, 2, '私密', Icons.lock_outline, '需要邀请'),
      ],
    );
  }

  Widget _buildVisibilityChip(
    BuildContext context,
    int value,
    String label,
    IconData icon,
    String description,
  ) {
    final theme = Theme.of(context);
    final isSelected = _visibility == value;

    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _visibility = value),
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

  Widget _buildFriendList(BuildContext context) {
    if (_isLoadingFriends) {
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

    if (_friends.isEmpty) {
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
      itemCount: _friends.length,
      separatorBuilder: (_, __) => Divider(
        height: 1,
        thickness: UIKit.dividerThickness,
        color: UIKit.dividerColor(context),
        indent: UIKit.spaceLg(context) + 36 + UIKit.spaceSm(context),
      ),
      itemBuilder: (context, index) {
        final friend = _friends[index];
        final isSelected = _selectedMembers.contains(friend.did);

        return InkWell(
          onTap: () {
            setState(() {
              if (isSelected) {
                _selectedMembers.remove(friend.did);
              } else {
                _selectedMembers.add(friend.did);
              }
            });
          },
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
                  onChanged: (v) {
                    setState(() {
                      if (v == true) {
                        _selectedMembers.add(friend.did);
                      } else {
                        _selectedMembers.remove(friend.did);
                      }
                    });
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  bool get _canCreate =>
      !_isCreating && _nameController.text.trim().isNotEmpty && _selectedMembers.length >= 2;

  Future<void> _createGroup() async {
    if (!_canCreate) return;

    setState(() => _isCreating = true);

    try {
      final controller = Get.find<GroupChatController>();
      final group = await controller.createGroup(
        name: _nameController.text.trim(),
        type: _type,
        visibility: _visibility,
        initialMemberDids: _selectedMembers.toList(),
      );

      if (group != null && mounted) {
        Navigator.of(context).pop();
        controller.selectGroup(group);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('群组「${group.name}」创建成功'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isCreating = false);
      }
    }
  }
}

class _FriendInfo {
  final String did;
  final String name;
  final String username;
  final String? avatarUrl;

  _FriendInfo({
    required this.did,
    required this.name,
    required this.username,
    this.avatarUrl,
  });
}
