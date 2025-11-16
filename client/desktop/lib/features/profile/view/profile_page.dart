import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';

import 'package:peers_touch_desktop/features/profile/controller/profile_controller.dart';

class ProfilePage extends StatelessWidget {
  final bool embedded;
  const ProfilePage({super.key, this.embedded = false});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<ProfileController>();
    final theme = Theme.of(context);
    final wx = theme.extension<WeChatTokens>();
    final body = Obx(() {
      final d = controller.detail.value;
      if (d == null) {
        return const Center(child: Text('No user'));
      }
      // 嵌入模式下直接返回内容，交由右侧面板统一滚动与外边距管理
      final content = Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
                  // 顶部个人卡片
                  Container(
                    padding: EdgeInsets.all(UIKit.spaceLg(context)),
                    decoration: BoxDecoration(
                      color: wx?.bgLevel1 ?? theme.colorScheme.surface,
                      borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
                      border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
                      boxShadow: UIKit.panelShadow(context),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // 顶部信息行（头像 + 基本信息）
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // 头像
                            ClipRRect(
                              borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
                              child: Container(
                                width: UIKit.avatarBlockHeight,
                                height: UIKit.avatarBlockHeight,
                                color: wx?.bgLevel3 ?? theme.colorScheme.surfaceVariant,
                                child: d.avatarUrl != null
                                    ? Image.network(d.avatarUrl!, fit: BoxFit.cover)
                                    : Icon(Icons.person, size: UIKit.indicatorSizeSm, color: UIKit.textSecondary(context)),
                              ),
                            ),
                            SizedBox(width: UIKit.spaceLg(context)),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    d.displayName,
                                    style: theme.textTheme.titleLarge,
                                  ),
                                  SizedBox(height: UIKit.spaceXs(context)),
                                  Text(
                                    '@${d.handle}',
                                    style: theme.textTheme.bodyMedium?.copyWith(color: UIKit.textSecondary(context)),
                                  ),
                                  SizedBox(height: UIKit.spaceSm(context)),
                                  Wrap(
                                    spacing: UIKit.spaceSm(context),
                                    runSpacing: UIKit.spaceSm(context),
                                    children: [
                                      if ((d.region ?? '').isNotEmpty)
                                        _InfoChip(label: d.region!),
                                      if ((d.timezone ?? '').isNotEmpty)
                                        _InfoChip(label: d.timezone!),
                                      if ((d.actorUrl ?? '').isNotEmpty)
                                        _InfoChip(label: d.actorUrl!),
                                      if ((d.keyFingerprint ?? '').isNotEmpty)
                                        _InfoChip(label: d.keyFingerprint!),
                                    ],
                                  ),
                                  SizedBox(height: UIKit.spaceMd(context)),
                                  if ((d.summary ?? '').isNotEmpty)
                                    Text(
                                      d.summary!,
                                      style: theme.textTheme.bodyMedium?.copyWith(color: UIKit.textSecondary(context)),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: UIKit.spaceLg(context)),
                        // Moments 预览（与头像左对齐，提升为卡片内平级）
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('moments'.tr, style: theme.textTheme.titleMedium),
                            SizedBox(height: UIKit.spaceSm(context)),
                            Divider(thickness: UIKit.dividerThickness, color: UIKit.dividerColor(context)),
                            SizedBox(height: UIKit.spaceSm(context)),
                            SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: Row(
                                children: d.moments
                                    .map((url) => Padding(
                                          padding: EdgeInsets.only(right: UIKit.spaceSm(context)),
                                          child: ClipRRect(
                                            borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                                            child: Container(
                                              width: UIKit.controlHeightMd,
                                              height: UIKit.controlHeightMd,
                                              color: wx?.bgLevel3 ?? theme.colorScheme.surfaceVariant,
                                              child: Image.network(url, fit: BoxFit.cover),
                                            ),
                                          ),
                                        ))
                                    .toList(),
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: UIKit.spaceLg(context)),
                        // 操作按钮
                        Row(
                          children: [
                            OutlinedButton.icon(
                              onPressed: () {},
                              icon: const Icon(Icons.chat_bubble_outline),
                              label: Text('messages'.tr),
                            ),
                            SizedBox(width: UIKit.spaceSm(context)),
                            FilledButton(
                              onPressed: controller.toggleFollowing,
                              child: Text(controller.following.isTrue ? 'unfollow'.tr : 'follow'.tr),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                  // Settings 区块删除
                ],
              );

      if (embedded) {
        return content;
      }

      return Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: UIKit.contentMaxWidth),
          child: Padding(
            padding: EdgeInsets.all(UIKit.spaceLg(context)),
            child: content,
          ),
        ),
      );
    });

    if (embedded) {
      return body;
    }
    // 非嵌入模式采用统一的三段式骨架（仅使用 center 区域）
    return ShellThreePane(
      centerBuilder: (context) => body,
      centerProps: const PaneProps(
        scrollPolicy: ScrollPolicy.auto,
        horizontalPolicy: ScrollPolicy.none,
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final String label;
  const _InfoChip({required this.label});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: UIKit.spaceSm(context),
        vertical: UIKit.spaceXs(context),
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceVariant,
        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
        border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
      ),
      child: Text(
        label,
        style: theme.textTheme.bodySmall?.copyWith(color: UIKit.textSecondary(context)),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  final String text;
  const _FieldLabel({required this.text});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: UIKit.spaceXs(context)),
      child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
    );
  }
}

class _VisibilitySelector extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;
  const _VisibilitySelector({required this.value, required this.onChanged});
  static const options = ['public', 'unlisted', 'followers', 'private'];
  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: UIKit.spaceSm(context),
      children: options
          .map((opt) => ChoiceChip(
                label: Text(opt),
                selected: value == opt,
                onSelected: (_) => onChanged(opt),
              ))
          .toList(),
    );
  }
}

class _MessagePermissionSelector extends StatelessWidget {
  final String value;
  final ValueChanged<String> onChanged;
  const _MessagePermissionSelector({required this.value, required this.onChanged});
  static const options = ['everyone', 'mutual', 'none'];
  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: UIKit.spaceSm(context),
      children: options
          .map((opt) => ChoiceChip(
                label: Text(opt),
                selected: value == opt,
                onSelected: (_) => onChanged(opt),
              ))
          .toList(),
    );
  }
}