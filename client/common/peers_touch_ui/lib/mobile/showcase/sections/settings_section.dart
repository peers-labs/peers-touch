import 'package:flutter/material.dart';
import 'package:peers_touch_ui/mobile/settings/settings.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class SettingsSection extends StatelessWidget {
  const SettingsSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '⚙️ Settings Components',
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: AppTypography.fontSizeXl,
            fontWeight: AppTypography.fontWeightSemibold,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        _buildSettingItemSection(),
        const SizedBox(height: AppSpacing.md),
        _buildSettingGroupSection(),
      ],
    );
  }

  Widget _buildSettingItemSection() {
    return _SectionCard(
      title: 'SettingItem',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SettingItem(
            icon: Icons.notifications_outlined,
            title: 'Notifications',
            subtitle: 'Manage your notification preferences',
            onTap: () {},
          ),
          SettingItem(
            icon: Icons.lock_outline,
            title: 'Privacy',
            onTap: () {},
          ),
          SettingItem(
            icon: Icons.palette_outlined,
            title: 'Appearance',
            subtitle: 'Dark mode, theme colors',
            trailing: Container(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.xxs),
              decoration: BoxDecoration(
                color: AppColors.backgroundSecondary,
                borderRadius: AppRadius.smBorder,
              ),
              child: Text(
                'Light',
                style: TextStyle(
                  fontFamily: AppTypography.fontFamily,
                  fontSize: AppTypography.fontSizeSm,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
            showArrow: false,
          ),
          SettingItem(
            icon: Icons.language,
            title: 'Language',
            trailing: Text(
              'English',
              style: TextStyle(
                fontFamily: AppTypography.fontFamily,
                fontSize: AppTypography.fontSizeSm,
                color: AppColors.textSecondary,
              ),
            ),
            onTap: () {},
          ),
        ],
      ),
    );
  }

  Widget _buildSettingGroupSection() {
    return _SectionCard(
      title: 'SettingGroup',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SettingGroup(
            title: 'ACCOUNT',
            children: [
              SettingItem(
                icon: Icons.person_outline,
                title: 'Profile',
                onTap: () {},
              ),
              SettingItem(
                icon: Icons.email_outlined,
                title: 'Email',
                subtitle: 'john.doe@example.com',
                onTap: () {},
              ),
              SettingItem(
                icon: Icons.phone_outlined,
                title: 'Phone',
                subtitle: '+1 234 567 8900',
                onTap: () {},
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          SettingGroup(
            title: 'PREFERENCES',
            children: [
              SettingItem(
                icon: Icons.dark_mode_outlined,
                title: 'Dark Mode',
                trailing: Switch(
                  value: false,
                  onChanged: (value) {},
                  activeColor: AppColors.primary,
                ),
                showArrow: false,
              ),
              SettingItem(
                icon: Icons.volume_up_outlined,
                title: 'Sound',
                trailing: Switch(
                  value: true,
                  onChanged: (value) {},
                  activeColor: AppColors.primary,
                ),
                showArrow: false,
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
