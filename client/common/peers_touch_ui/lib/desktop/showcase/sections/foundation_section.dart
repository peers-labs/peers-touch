import 'package:flutter/material.dart' hide Card, Badge;
import 'package:peers_touch_ui/foundation/foundation.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class FoundationSection extends StatelessWidget {
  const FoundationSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '📦 Foundation Components',
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeXl,
            fontWeight: AppTypography.fontWeightSemibold,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        Wrap(
          spacing: AppSpacing.lg,
          runSpacing: AppSpacing.lg,
          children: [
            SizedBox(width: 400, child: _buildButtonSection()),
            SizedBox(width: 400, child: _buildInputSection()),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        Wrap(
          spacing: AppSpacing.lg,
          runSpacing: AppSpacing.lg,
          children: [
            SizedBox(width: 400, child: _buildCardSection()),
            SizedBox(width: 400, child: _buildAvatarSection()),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        Wrap(
          spacing: AppSpacing.lg,
          runSpacing: AppSpacing.lg,
          children: [
            SizedBox(width: 400, child: _buildTagSection()),
            SizedBox(width: 400, child: _buildBadgeSection()),
          ],
        ),
      ],
    );
  }

  Widget _buildButtonSection() {
    return _SectionCard(
      title: 'Button',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Types:'),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              Button(text: 'Primary', type: ButtonType.primary, onPressed: () {}),
              Button(text: 'Secondary', type: ButtonType.secondary, onPressed: () {}),
              Button(text: 'Ghost', type: ButtonType.ghost, onPressed: () {}),
              Button(text: 'Text', type: ButtonType.text, onPressed: () {}),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          const Text('Sizes:'),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              Button(text: 'Small', size: ButtonSize.small, onPressed: () {}),
              Button(text: 'Medium', size: ButtonSize.medium, onPressed: () {}),
              Button(text: 'Large', size: ButtonSize.large, onPressed: () {}),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          const Text('States:'),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              Button(text: 'Normal', onPressed: () {}),
              Button(text: 'Disabled', onPressed: () {}, disabled: true),
              Button(text: 'Loading', onPressed: () {}, loading: true),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildInputSection() {
    return _SectionCard(
      title: 'Input',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Input(hintText: 'Default input'),
          const SizedBox(height: AppSpacing.sm),
          const Input(
            labelText: 'With Label',
            hintText: 'Enter your name',
          ),
          const SizedBox(height: AppSpacing.sm),
          const Input(
            hintText: 'With prefix icon',
            prefixIcon: Icons.search,
          ),
          const SizedBox(height: AppSpacing.sm),
          const Input(
            hintText: 'Error state',
            errorText: 'This field is required',
          ),
        ],
      ),
    );
  }

  Widget _buildCardSection() {
    return _SectionCard(
      title: 'Card',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Card(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Card Title',
                  style: TextStyle(
                    fontFamily: AppTypography.fontFamily,
                    fontSize: AppTypography.fontSizeMd,
                    fontWeight: AppTypography.fontWeightSemibold,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'This is a basic card with some content.',
                  style: TextStyle(
                    fontFamily: AppTypography.fontFamily,
                    fontSize: AppTypography.fontSizeSm,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Card(
            hoverable: true,
            onTap: () {},
            child: Row(
              children: [
                Icon(Icons.info, color: AppColors.primary),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    'Hoverable Card (hover over me)',
                    style: TextStyle(
                      fontFamily: AppTypography.fontFamily,
                      fontSize: AppTypography.fontSizeSm,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAvatarSection() {
    return _SectionCard(
      title: 'Avatar',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: AppSpacing.md,
            runSpacing: AppSpacing.sm,
            children: [
              Column(
                children: [
                  Avatar(name: 'John', size: AvatarSize.xxs),
                  const SizedBox(height: AppSpacing.xxs),
                  Text('XXS', style: TextStyle(fontSize: AppTypography.fontSizeXs, color: AppColors.textTertiary)),
                ],
              ),
              Column(
                children: [
                  Avatar(name: 'John', size: AvatarSize.xs),
                  const SizedBox(height: AppSpacing.xxs),
                  Text('XS', style: TextStyle(fontSize: AppTypography.fontSizeXs, color: AppColors.textTertiary)),
                ],
              ),
              Column(
                children: [
                  Avatar(name: 'John', size: AvatarSize.sm),
                  const SizedBox(height: AppSpacing.xxs),
                  Text('SM', style: TextStyle(fontSize: AppTypography.fontSizeXs, color: AppColors.textTertiary)),
                ],
              ),
              Column(
                children: [
                  Avatar(name: 'John', size: AvatarSize.md),
                  const SizedBox(height: AppSpacing.xxs),
                  Text('MD', style: TextStyle(fontSize: AppTypography.fontSizeXs, color: AppColors.textTertiary)),
                ],
              ),
              Column(
                children: [
                  Avatar(name: 'John', size: AvatarSize.lg),
                  const SizedBox(height: AppSpacing.xxs),
                  Text('LG', style: TextStyle(fontSize: AppTypography.fontSizeXs, color: AppColors.textTertiary)),
                ],
              ),
              Column(
                children: [
                  Avatar(name: 'John', size: AvatarSize.xl),
                  const SizedBox(height: AppSpacing.xxs),
                  Text('XL', style: TextStyle(fontSize: AppTypography.fontSizeXs, color: AppColors.textTertiary)),
                ],
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          const Text('With Online Status:'),
          const SizedBox(height: AppSpacing.xs),
          Row(
            children: [
              Avatar(name: 'Online', showOnlineStatus: true, isOnline: true),
              const SizedBox(width: AppSpacing.md),
              Avatar(name: 'Offline', showOnlineStatus: true, isOnline: false),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTagSection() {
    return _SectionCard(
      title: 'Tag',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: AppSpacing.xs,
            runSpacing: AppSpacing.xs,
            children: [
              Tag(text: 'Default'),
              Tag(text: 'Primary', variant: TagVariant.primary),
              Tag(text: 'Success', variant: TagVariant.success),
              Tag(text: 'Warning', variant: TagVariant.warning),
              Tag(text: 'Error', variant: TagVariant.error),
              Tag(text: 'Info', variant: TagVariant.info),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          const Text('With Close:'),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.xs,
            runSpacing: AppSpacing.xs,
            children: [
              Tag(text: 'Closable', onClose: () {}),
              Tag(text: 'Primary', variant: TagVariant.primary, onClose: () {}),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBadgeSection() {
    return _SectionCard(
      title: 'Badge',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: AppSpacing.lg,
            runSpacing: AppSpacing.md,
            children: [
              Badge(
                variant: BadgeVariant.dot,
                child: Icon(Icons.notifications, size: 24, color: AppColors.textSecondary),
              ),
              Badge(
                variant: BadgeVariant.count,
                count: 5,
                child: Icon(Icons.mail, size: 24, color: AppColors.textSecondary),
              ),
              Badge(
                variant: BadgeVariant.count,
                count: 99,
                child: Icon(Icons.chat, size: 24, color: AppColors.textSecondary),
              ),
              Badge(
                variant: BadgeVariant.text,
                text: 'NEW',
                child: Icon(Icons.info, size: 24, color: AppColors.textSecondary),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;

  const _SectionCard({
    required this.title,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(
          color: AppColors.border,
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              fontFamily: AppTypography.fontFamily,
              fontSize: AppTypography.fontSizeMd,
              fontWeight: AppTypography.fontWeightSemibold,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          child,
        ],
      ),
    );
  }
}
