import 'package:flutter/material.dart';
import 'package:peers_touch_ui/desktop/layout/layout.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class LayoutSection extends StatelessWidget {
  const LayoutSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '🏗️ Layout Components',
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
            SizedBox(width: 400, child: _buildAppBarSection()),
            SizedBox(width: 320, child: _buildSidebarSection()),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        _buildTabBarSection(),
      ],
    );
  }

  Widget _buildAppBarSection() {
    return _SectionCard(
      title: 'AppBar',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: AppRadius.mdBorder,
            ),
            child: const DesktopAppBar(
              title: 'Page Title',
              showBackButton: false,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: AppRadius.mdBorder,
            ),
            child: DesktopAppBar(
              title: 'With Actions',
              showBackButton: false,
              actions: [
                MouseRegion(
                  cursor: SystemMouseCursors.click,
                  child: GestureDetector(
                    onTap: () {},
                    child: Container(
                      padding: const EdgeInsets.all(AppSpacing.sm),
                      child: Icon(
                        Icons.search,
                        size: 20,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                ),
                MouseRegion(
                  cursor: SystemMouseCursors.click,
                  child: GestureDetector(
                    onTap: () {},
                    child: Container(
                      padding: const EdgeInsets.all(AppSpacing.sm),
                      child: Icon(
                        Icons.more_vert,
                        size: 20,
                        color: AppColors.textPrimary,
                      ),
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

  Widget _buildSidebarSection() {
    return _SectionCard(
      title: 'Sidebar',
      child: Container(
        height: 320,
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: AppRadius.mdBorder,
        ),
        child: Sidebar(
          currentIndex: 0,
          header: const SidebarHeader(
            title: 'John Doe',
            subtitle: 'Online',
            avatarName: 'John',
          ),
          items: [
            SidebarItem(
              icon: Icons.home_outlined,
              activeIcon: Icons.home,
              label: 'Home',
              onTap: () {},
            ),
            SidebarItem(
              icon: Icons.chat_bubble_outline,
              activeIcon: Icons.chat_bubble,
              label: 'Chat',
              onTap: () {},
              badgeCount: 5,
            ),
            SidebarItem(
              icon: Icons.person_outline,
              activeIcon: Icons.person,
              label: 'Profile',
              onTap: () {},
            ),
            SidebarItem(
              icon: Icons.settings_outlined,
              activeIcon: Icons.settings,
              label: 'Settings',
              onTap: () {},
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTabBarSection() {
    return _SectionCard(
      title: 'TabBar',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: AppRadius.mdBorder,
            ),
            child: DesktopTabBar(
              tabs: const ['All', 'Active', 'Completed', 'Archived'],
              currentIndex: 0,
              onTap: (index) {},
            ),
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
