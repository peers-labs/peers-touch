import 'package:flutter/material.dart';
import 'package:peers_touch_ui/foundation/foundation.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class PlaygroundSection extends StatefulWidget {
  const PlaygroundSection({super.key});

  @override
  State<PlaygroundSection> createState() => _PlaygroundSectionState();
}

class _PlaygroundSectionState extends State<PlaygroundSection> {
  bool _isDarkMode = false;
  Color _primaryColor = AppColors.primary;
  int _selectedColorIndex = 0;

  final List<Color> _colorOptions = [
    AppColors.primary,
    AppColors.info,
    AppColors.success,
    AppColors.warning,
    AppColors.error,
  ];

  final List<String> _colorNames = [
    'Purple',
    'Blue',
    'Green',
    'Orange',
    'Red',
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '🎭 Interactive Playground',
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeXl,
            fontWeight: AppTypography.fontWeightSemibold,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        _SectionCard(
          title: 'Theme Controls',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildThemeSwitch(),
              const SizedBox(height: AppSpacing.md),
              _buildColorPicker(),
              const SizedBox(height: AppSpacing.lg),
              _buildPreview(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildThemeSwitch() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Theme Mode:',
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeSm,
            fontWeight: AppTypography.fontWeightMedium,
            color: AppColors.textSecondary,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Row(
          children: [
            _buildThemeButton('Light', false),
            const SizedBox(width: AppSpacing.xs),
            _buildThemeButton('Dark', true),
          ],
        ),
      ],
    );
  }

  Widget _buildThemeButton(String label, bool isDark) {
    final isSelected = _isDarkMode == isDark;
    return GestureDetector(
      onTap: () => setState(() => _isDarkMode = isDark),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary : AppColors.backgroundSecondary,
          borderRadius: AppRadius.mdBorder,
          border: Border.all(
            color: isSelected ? AppColors.primary : AppColors.border,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeSm,
            fontWeight: AppTypography.fontWeightMedium,
            color: isSelected ? AppColors.white : AppColors.textPrimary,
          ),
        ),
      ),
    );
  }

  Widget _buildColorPicker() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Primary Color:',
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeSm,
            fontWeight: AppTypography.fontWeightMedium,
            color: AppColors.textSecondary,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Row(
          children: List.generate(_colorOptions.length, (index) {
            final isSelected = _selectedColorIndex == index;
            return Padding(
              padding: const EdgeInsets.only(right: AppSpacing.sm),
              child: GestureDetector(
                onTap: () {
                  setState(() {
                    _selectedColorIndex = index;
                    _primaryColor = _colorOptions[index];
                  });
                },
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: _colorOptions[index],
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: isSelected ? AppColors.textPrimary : Colors.transparent,
                      width: 3,
                    ),
                    boxShadow: isSelected ? AppShadows.md : [],
                  ),
                  child: isSelected
                      ? Icon(
                          Icons.check,
                          color: AppColors.white,
                          size: 20,
                        )
                      : null,
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Selected: ${_colorNames[_selectedColorIndex]}',
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeXs,
            color: AppColors.textTertiary,
          ),
        ),
      ],
    );
  }

  Widget _buildPreview() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: _isDarkMode ? AppDarkColors.background : AppColors.backgroundSecondary,
        borderRadius: AppRadius.lgBorder,
        border: Border.all(
          color: _isDarkMode ? AppDarkColors.border : AppColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Preview',
            style: TextStyle(
              fontFamily: AppTypography.fontFamily,
              fontSize: AppTypography.fontSizeMd,
              fontWeight: AppTypography.fontWeightSemibold,
              color: _isDarkMode ? AppDarkColors.textPrimary : AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              Button(
                text: 'Primary',
                onPressed: () {},
              ),
              Button(
                text: 'Secondary',
                type: ButtonType.secondary,
                onPressed: () {},
              ),
              Button(
                text: 'Ghost',
                type: ButtonType.ghost,
                onPressed: () {},
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
