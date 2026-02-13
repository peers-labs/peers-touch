import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class TokensSection extends StatelessWidget {
  const TokensSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '🎨 Design Tokens',
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeXl,
            fontWeight: AppTypography.fontWeightSemibold,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        _buildColorPalette(),
        const SizedBox(height: AppSpacing.md),
        _buildSpacingScale(),
        const SizedBox(height: AppSpacing.md),
        _buildRadiusScale(),
      ],
    );
  }

  Widget _buildColorPalette() {
    return _SectionCard(
      title: 'Colors',
      child: Wrap(
        spacing: AppSpacing.lg,
        runSpacing: AppSpacing.md,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildColorRow('Primary', AppColors.primary),
              _buildColorRow('Primary Hover', AppColors.primaryHover),
              _buildColorRow('Primary Active', AppColors.primaryActive),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildColorRow('Success', AppColors.success),
              _buildColorRow('Warning', AppColors.warning),
              _buildColorRow('Error', AppColors.error),
              _buildColorRow('Info', AppColors.info),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildColorRow('Background', AppColors.background),
              _buildColorRow('Background Secondary', AppColors.backgroundSecondary),
              _buildColorRow('Border', AppColors.border),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildColorRow('Text Primary', AppColors.textPrimary),
              _buildColorRow('Text Secondary', AppColors.textSecondary),
              _buildColorRow('Text Tertiary', AppColors.textTertiary),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildColorRow(String name, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 24,
            height: 24,
            decoration: BoxDecoration(
              color: color,
              borderRadius: AppRadius.smBorder,
              border: Border.all(
                color: AppColors.border,
                width: 1,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            name,
            style: TextStyle(
              fontFamily: AppTypography.fontFamily,
              fontSize: AppTypography.fontSizeSm,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSpacingScale() {
    return _SectionCard(
      title: 'Spacing',
      child: Wrap(
        spacing: AppSpacing.lg,
        runSpacing: AppSpacing.sm,
        children: [
          _buildSpacingItem('XXS', AppSpacing.xxs),
          _buildSpacingItem('XS', AppSpacing.xs),
          _buildSpacingItem('SM', AppSpacing.sm),
          _buildSpacingItem('MD', AppSpacing.md),
          _buildSpacingItem('LG', AppSpacing.lg),
          _buildSpacingItem('XL', AppSpacing.xl),
          _buildSpacingItem('XXL', AppSpacing.xxl),
        ],
      ),
    );
  }

  Widget _buildSpacingItem(String name, double value) {
    return Column(
      children: [
        Container(
          width: value,
          height: value,
          color: AppColors.primary.withValues(alpha: 0.3),
        ),
        const SizedBox(height: AppSpacing.xxs),
        Text(
          '$name (${value.toInt()}px)',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeXs,
            color: AppColors.textTertiary,
          ),
        ),
      ],
    );
  }

  Widget _buildRadiusScale() {
    return _SectionCard(
      title: 'Radius',
      child: Wrap(
        spacing: AppSpacing.lg,
        runSpacing: AppSpacing.sm,
        children: [
          _buildRadiusItem('XS', AppRadius.xs),
          _buildRadiusItem('SM', AppRadius.sm),
          _buildRadiusItem('MD', AppRadius.md),
          _buildRadiusItem('LG', AppRadius.lg),
          _buildRadiusItem('XL', AppRadius.xl),
          _buildRadiusItem('XXL', AppRadius.xxl),
          _buildRadiusItem('Full', AppRadius.full),
        ],
      ),
    );
  }

  Widget _buildRadiusItem(String name, double value) {
    return Column(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.3),
            borderRadius: BorderRadius.circular(value),
          ),
        ),
        const SizedBox(height: AppSpacing.xxs),
        Text(
          '$name (${value == AppRadius.full ? '9999' : value.toInt()}px)',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeXs,
            color: AppColors.textTertiary,
          ),
        ),
      ],
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
