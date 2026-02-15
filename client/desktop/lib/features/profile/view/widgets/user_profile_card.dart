import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/profile/model/user_detail.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

class UserProfileCard extends StatelessWidget {
  const UserProfileCard({
    super.key,
    required this.detail,
    this.embedded = false,
    this.isCurrentUser = false,
    this.showEditProfile = false,
    this.showFollow = true,
    this.showMessages = true,
    this.onEditProfile,
    this.onFollow,
    this.onMessage,
    this.isFollowing = false,
  });

  final UserDetail detail;
  final bool embedded;
  final bool isCurrentUser;
  final bool showEditProfile;
  final bool showFollow;
  final bool showMessages;
  final VoidCallback? onEditProfile;
  final VoidCallback? onFollow;
  final VoidCallback? onMessage;
  final bool isFollowing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final wx = theme.extension<WeChatTokens>();

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header Image
        SizedBox(
          height: detail.coverUrl != null && detail.coverUrl!.trim().isNotEmpty ? 150 : 100,
          width: double.infinity,
          child: Stack(
            children: [
              Positioned.fill(
                child: Container(color: theme.colorScheme.surfaceContainerHighest),
              ),
              Positioned.fill(
                child: PeersImage(
                  src: detail.coverUrl,
                  fit: BoxFit.cover,
                ),
              ),
            ],
          ),
        ),

        Padding(
          padding: EdgeInsets.only(
            left: UIKit.spaceSm(context), // 减少左侧间距
            right: UIKit.spaceLg(context),
            top: UIKit.spaceLg(context),
            bottom: UIKit.spaceLg(context),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 顶部信息行（头像 + 基本信息）
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 头像
                  Avatar(
                    actorId: detail.id,
                    avatarUrl: detail.avatarUrl,
                    fallbackName: detail.handle,
                    size: UIKit.avatarBlockHeight,
                  ),
                  SizedBox(width: UIKit.spaceLg(context)),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          detail.displayName,
                          style: theme.textTheme.titleLarge,
                        ),
                        SizedBox(height: UIKit.spaceXs(context)),
                        Text(
                          '@${detail.handle}',
                          style: theme.textTheme.bodyMedium?.copyWith(color: UIKit.textSecondary(context)),
                        ),
                        SizedBox(height: UIKit.spaceSm(context)),
                        Wrap(
                          spacing: UIKit.spaceSm(context),
                          runSpacing: UIKit.spaceSm(context),
                          children: [
                            if (detail.peersTouch?.networkId != null && detail.peersTouch!.networkId.isNotEmpty)
                              _InfoChip(label: 'PT ID: ${detail.peersTouch!.networkId}'),
                            if ((detail.region ?? '').isNotEmpty) _InfoChip(label: detail.region!),
                            if ((detail.timezone ?? '').isNotEmpty) _InfoChip(label: detail.timezone!),
                            if ((detail.actorUrl ?? '').isNotEmpty) _InfoChip(label: detail.actorUrl!),
                            if ((detail.keyFingerprint ?? '').isNotEmpty)
                              _InfoChip(label: detail.keyFingerprint!),
                          ],
                        ),
                        SizedBox(height: UIKit.spaceMd(context)),
                        if ((detail.summary ?? '').isNotEmpty)
                          Text(
                            detail.summary!,
                            style: theme.textTheme.bodyMedium?.copyWith(color: UIKit.textSecondary(context)),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              SizedBox(height: UIKit.spaceLg(context)),
              if (detail.showCounts)
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: UIKit.spaceLg(context)),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _StatItem(label: 'posts'.tr, count: detail.statusesCount ?? 0),
                      _StatItem(label: 'following'.tr, count: detail.followingCount ?? 0),
                      _StatItem(label: 'followers'.tr, count: detail.followersCount ?? 0),
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
                      children: detail.moments
                          .map((url) => Padding(
                                padding: EdgeInsets.only(right: UIKit.spaceSm(context)),
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
                                  child: Container(
                                    width: UIKit.controlHeightMd,
                                    height: UIKit.controlHeightMd,
                                    color: wx?.bgLevel3 ?? theme.colorScheme.surfaceContainerHighest,
                                    child: PeersImage(src: url, fit: BoxFit.cover),
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
                  if (showMessages)
                    OutlinedButton.icon(
                      onPressed: onMessage,
                      icon: const Icon(Icons.chat_bubble_outline),
                      label: Text('messages'.tr),
                    ),
                  if (showFollow)
                    FilledButton(
                      onPressed: onFollow,
                      child: Text(isFollowing ? 'unfollow'.tr : 'follow'.tr),
                    ),
                  if (showEditProfile)
                    OutlinedButton.icon(
                      onPressed: onEditProfile,
                      icon: const Icon(Icons.edit),
                      label: Text('edit_profile'.tr),
                    ),
                ],
              ),
            ],
          ),
        ),
      ],
    );

    if (embedded) {
      // In embedded mode, return the content directly without card decoration
      // so it fills the panel.
      return Container(
        color: wx?.bgLevel1 ?? theme.colorScheme.surface,
        child: SingleChildScrollView(
          padding: EdgeInsets.zero,
          child: content,
        ),
      );
    }

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: wx?.bgLevel1 ?? theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(UIKit.radiusLg(context)),
        border: Border.all(color: UIKit.dividerColor(context), width: UIKit.dividerThickness),
        boxShadow: UIKit.panelShadow(context),
      ),
      child: content,
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
