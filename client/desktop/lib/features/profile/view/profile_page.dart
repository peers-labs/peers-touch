import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/utils/image_utils.dart';
import 'package:peers_touch_desktop/features/profile/controller/profile_controller.dart';
import 'package:peers_touch_desktop/features/profile/view/edit_profile_dialog.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key, this.embedded = false});
  final bool embedded;

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
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      color: wx?.bgLevel1 ?? theme.colorScheme.surface,
                      borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
                      border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
                      boxShadow: UIKit.panelShadow(context),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Header Image
                        (() {
                          final p = imageProviderFor(d.coverUrl);
                          if (p != null) {
                            return SizedBox(
                              height: 150,
                              width: double.infinity,
                              child: Image(image: p, fit: BoxFit.cover),
                            );
                          }
                          return Container(
                            height: 100,
                            width: double.infinity,
                            color: theme.colorScheme.surfaceContainerHighest,
                          );
                        })(),
                        
                        Padding(
                          padding: EdgeInsets.all(UIKit.spaceLg(context)),
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
                                      color: wx?.bgLevel3 ?? theme.colorScheme.surfaceContainerHighest,
                                      child: (() {
                                        final p = imageProviderFor(d.avatarUrl);
                                        if (p != null) {
                                          return Image(image: p, fit: BoxFit.cover);
                                        }
                                        return Icon(Icons.person, size: UIKit.indicatorSizeSm, color: UIKit.textSecondary(context));
                                      })(),
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
                                            if (d.peersTouch?.networkId != null && d.peersTouch!.networkId.isNotEmpty)
                                              _InfoChip(label: 'PT ID: ${d.peersTouch!.networkId}'),
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
                              if (d.showCounts)
                                Padding(
                                  padding: EdgeInsets.symmetric(horizontal: UIKit.spaceLg(context)),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                                    children: [
                                      _StatItem(label: 'posts'.tr, count: d.statusesCount ?? 0),
                                      _StatItem(label: 'following'.tr, count: d.followingCount ?? 0),
                                      _StatItem(label: 'followers'.tr, count: d.followersCount ?? 0),
                                    ],
                                  ),
                                ),
                              SizedBox(height: UIKit.spaceLg(context)),
                              // Moments 预览
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
                                                    color: wx?.bgLevel3 ?? theme.colorScheme.surfaceContainerHighest,
                                                    child: (() {
                                                      final p = imageProviderFor(url);
                                                      if (p != null) {
                                                        return Image(image: p, fit: BoxFit.cover);
                                                      }
                                                      return const SizedBox();
                                                    })(),
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
                              Wrap(
                                spacing: UIKit.spaceSm(context),
                                runSpacing: UIKit.spaceSm(context),
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: () {},
                                    icon: const Icon(Icons.chat_bubble_outline),
                                    label: Text('messages'.tr),
                                  ),
                                  FilledButton(
                                    onPressed: controller.toggleFollowing,
                                    child: Text(controller.following.isTrue ? 'unfollow'.tr : 'follow'.tr),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed: () {
                                      Get.dialog(const EditProfileDialog());
                                    },
                                    icon: const Icon(Icons.edit),
                                    label: Text('edit_profile'.tr),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                  // Settings 区块删除
                ],
              );

      if (embedded) {
        return SingleChildScrollView(
          padding: EdgeInsets.all(UIKit.spaceMd(context)),
          child: content,
        );
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
  const _InfoChip({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: UIKit.spaceSm(context),
        vertical: UIKit.spaceXs(context),
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
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

class _StatItem extends StatelessWidget {
  const _StatItem({required this.label, required this.count});
  final String label;
  final int count;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Text(
          '$count',
          style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
        ),
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(color: UIKit.textSecondary(context)),
        ),
      ],
    );
  }
}
