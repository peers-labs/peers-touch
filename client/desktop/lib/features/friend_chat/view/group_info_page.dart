import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/chat/group_chat.pb.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/friend_chat/controller/friend_chat_controller.dart';

/// 群信息页面
class GroupInfoPage extends StatelessWidget {
  const GroupInfoPage({
    super.key,
    required this.group,
  });

  final Group group;

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<FriendChatController>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('群聊信息'),
        centerTitle: true,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.more_vert),
            onPressed: () {
              _showMoreOptions(context);
            },
          ),
        ],
      ),
      body: SingleChildScrollView(
        child: Column(
          children: [
            _buildGroupHeader(context),
            const SizedBox(height: 16),
            _buildMembersSection(context, controller),
            const SizedBox(height: 16),
            _buildSettingsSection(context, controller),
            const SizedBox(height: 16),
            _buildActionsSection(context, controller),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _buildGroupHeader(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: EdgeInsets.all(UIKit.spaceLg(context)),
      color: theme.colorScheme.surface,
      child: Column(
        children: [
          // 群头像
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(
              Icons.group,
              size: 40,
              color: theme.colorScheme.onPrimaryContainer,
            ),
          ),
          SizedBox(height: UIKit.spaceMd(context)),

          // 群名称
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                group.name,
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              SizedBox(width: UIKit.spaceXs(context)),
              IconButton(
                icon: const Icon(Icons.edit, size: 18),
                onPressed: () {
                  _showEditNameDialog(context);
                },
                tooltip: '修改群名称',
              ),
            ],
          ),

          // 成员数
          Text(
            '${group.memberCount} 人',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: UIKit.textSecondary(context),
            ),
          ),

          if (group.description.isNotEmpty) ...[
            SizedBox(height: UIKit.spaceSm(context)),
            Text(
              group.description,
              style: theme.textTheme.bodySmall?.copyWith(
                color: UIKit.textSecondary(context),
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildMembersSection(BuildContext context, FriendChatController controller) {
    final theme = Theme.of(context);

    return Container(
      color: theme.colorScheme.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: EdgeInsets.all(UIKit.spaceMd(context)),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '群成员 (${group.memberCount})',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Row(
                  children: [
                    TextButton.icon(
                      icon: const Icon(Icons.search, size: 18),
                      label: const Text('搜索'),
                      onPressed: () {
                        _showMemberSearch(context);
                      },
                    ),
                    TextButton.icon(
                      icon: const Icon(Icons.person_add, size: 18),
                      label: const Text('邀请'),
                      onPressed: () {
                        _showInviteDialog(context);
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),

          // 成员列表预览
          SizedBox(
            height: 100,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              padding: EdgeInsets.symmetric(horizontal: UIKit.spaceMd(context)),
              itemCount: 10, // TODO: 从 controller 获取实际成员
              itemBuilder: (context, index) {
                return Padding(
                  padding: EdgeInsets.only(right: UIKit.spaceSm(context)),
                  child: Column(
                    children: [
                      Avatar(
                        actorId: 'member_$index',
                        fallbackName: '成员 $index',
                        size: 56,
                      ),
                      SizedBox(height: UIKit.spaceXs(context)),
                      SizedBox(
                        width: 60,
                        child: Text(
                          '成员 $index',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),

          // 查看全部
          InkWell(
            onTap: () {
              _showAllMembers(context);
            },
            child: Padding(
              padding: EdgeInsets.all(UIKit.spaceMd(context)),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    '查看全部成员',
                    style: TextStyle(color: theme.colorScheme.primary),
                  ),
                  Icon(
                    Icons.chevron_right,
                    size: 18,
                    color: theme.colorScheme.primary,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSettingsSection(BuildContext context, FriendChatController controller) {
    final theme = Theme.of(context);

    return Container(
      color: theme.colorScheme.surface,
      child: Column(
        children: [
          _buildSettingsTile(
            context,
            icon: Icons.person,
            title: '我的群昵称',
            subtitle: '未设置',
            onTap: () => _showEditNicknameDialog(context),
          ),
          _buildDivider(context),
          _buildSettingsTile(
            context,
            icon: Icons.campaign,
            title: '群公告',
            subtitle: '查看群公告',
            onTap: () => _showAnnouncements(context),
          ),
          _buildDivider(context),
          _buildSettingsTile(
            context,
            icon: Icons.search,
            title: '搜索聊天记录',
            onTap: () => _showChatSearch(context),
          ),
          _buildDivider(context),
          _buildSwitchTile(
            context,
            icon: Icons.notifications_off,
            title: '消息免打扰',
            value: group.muted,
            onChanged: (value) {
              // TODO: 更新静音状态
            },
          ),
          _buildDivider(context),
          _buildSwitchTile(
            context,
            icon: Icons.push_pin,
            title: '置顶聊天',
            value: false, // TODO: 从 session 获取
            onChanged: (value) {
              // TODO: 更新置顶状态
            },
          ),
        ],
      ),
    );
  }

  Widget _buildActionsSection(BuildContext context, FriendChatController controller) {
    final theme = Theme.of(context);

    return Container(
      color: theme.colorScheme.surface,
      child: Column(
        children: [
          _buildSettingsTile(
            context,
            icon: Icons.cleaning_services,
            title: '清空聊天记录',
            titleColor: theme.colorScheme.error,
            onTap: () => _showClearHistoryDialog(context),
          ),
          _buildDivider(context),
          _buildSettingsTile(
            context,
            icon: Icons.exit_to_app,
            title: '退出群聊',
            titleColor: theme.colorScheme.error,
            onTap: () => _showLeaveGroupDialog(context),
          ),
        ],
      ),
    );
  }

  Widget _buildSettingsTile(
    BuildContext context, {
    required IconData icon,
    required String title,
    String? subtitle,
    Color? titleColor,
    VoidCallback? onTap,
  }) {
    final theme = Theme.of(context);

    return ListTile(
      leading: Icon(icon, color: UIKit.textSecondary(context)),
      title: Text(
        title,
        style: TextStyle(color: titleColor),
      ),
      subtitle: subtitle != null
          ? Text(
              subtitle,
              style: TextStyle(color: UIKit.textSecondary(context)),
            )
          : null,
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }

  Widget _buildSwitchTile(
    BuildContext context, {
    required IconData icon,
    required String title,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return ListTile(
      leading: Icon(icon, color: UIKit.textSecondary(context)),
      title: Text(title),
      trailing: Switch(
        value: value,
        onChanged: onChanged,
      ),
    );
  }

  Widget _buildDivider(BuildContext context) {
    return Divider(
      height: 1,
      indent: 56,
      color: UIKit.dividerColor(context),
    );
  }

  void _showMoreOptions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.share),
                title: const Text('分享群二维码'),
                onTap: () {
                  Navigator.pop(context);
                  // TODO: 分享二维码
                },
              ),
              ListTile(
                leading: const Icon(Icons.report),
                title: const Text('举报'),
                onTap: () {
                  Navigator.pop(context);
                  // TODO: 举报
                },
              ),
            ],
          ),
        );
      },
    );
  }

  void _showEditNameDialog(BuildContext context) {
    final controller = TextEditingController(text: group.name);
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('修改群名称'),
          content: TextField(
            controller: controller,
            decoration: const InputDecoration(
              labelText: '群名称',
              border: OutlineInputBorder(),
            ),
            autofocus: true,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            ElevatedButton(
              onPressed: () {
                // TODO: 保存群名称
                Navigator.pop(context);
              },
              child: const Text('保存'),
            ),
          ],
        );
      },
    );
  }

  void _showEditNicknameDialog(BuildContext context) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('我的群昵称'),
          content: TextField(
            controller: controller,
            decoration: const InputDecoration(
              labelText: '群昵称',
              hintText: '在本群的昵称',
              border: OutlineInputBorder(),
            ),
            autofocus: true,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            ElevatedButton(
              onPressed: () {
                // TODO: 保存群昵称
                Navigator.pop(context);
              },
              child: const Text('保存'),
            ),
          ],
        );
      },
    );
  }

  void _showMemberSearch(BuildContext context) {
    // TODO: 实现成员搜索
    Get.snackbar('提示', '成员搜索功能开发中');
  }

  void _showInviteDialog(BuildContext context) {
    // TODO: 实现邀请成员
    Get.snackbar('提示', '邀请成员功能开发中');
  }

  void _showAllMembers(BuildContext context) {
    // TODO: 显示所有成员
    Get.snackbar('提示', '成员列表功能开发中');
  }

  void _showAnnouncements(BuildContext context) {
    // TODO: 显示群公告
    Get.snackbar('提示', '群公告功能开发中');
  }

  void _showChatSearch(BuildContext context) {
    // TODO: 搜索聊天记录
    Get.snackbar('提示', '搜索聊天记录功能开发中');
  }

  void _showClearHistoryDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('清空聊天记录'),
          content: const Text('确定要清空与该群的所有聊天记录吗？此操作不可恢复。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
                foregroundColor: Theme.of(context).colorScheme.onError,
              ),
              onPressed: () {
                // TODO: 清空聊天记录
                Navigator.pop(context);
              },
              child: const Text('清空'),
            ),
          ],
        );
      },
    );
  }

  void _showLeaveGroupDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('退出群聊'),
          content: const Text('确定要退出该群吗？退出后将不再接收该群消息。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
                foregroundColor: Theme.of(context).colorScheme.onError,
              ),
              onPressed: () {
                // TODO: 退出群聊
                Navigator.pop(context);
                Navigator.pop(context); // 关闭群信息页
              },
              child: const Text('退出'),
            ),
          ],
        );
      },
    );
  }
}
