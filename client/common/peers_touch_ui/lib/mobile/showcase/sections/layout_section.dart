import 'package:flutter/material.dart' hide AppBar, TabBar, Badge;
import 'package:peers_touch_ui/foundation/foundation.dart';
import 'package:peers_touch_ui/mobile/layout/layout.dart';
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
        _buildAppBarSection(),
        const SizedBox(height: AppSpacing.md),
        _buildBottomNavSection(),
        const SizedBox(height: AppSpacing.md),
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
          const Text('Basic AppBar:'),
          const SizedBox(height: AppSpacing.xs),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: AppRadius.mdBorder,
            ),
            child: AppBar(
              title: 'Page Title',
              showBackButton: false,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          const Text('With Actions:'),
          const SizedBox(height: AppSpacing.xs),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: AppRadius.mdBorder,
            ),
            child: AppBar(
              title: 'With Actions',
              showBackButton: true,
              actions: [
                IconButton(
                  icon: Icon(Icons.search, color: AppColors.textPrimary),
                  onPressed: () {},
                ),
                IconButton(
                  icon: Icon(Icons.more_vert, color: AppColors.textPrimary),
                  onPressed: () {},
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomNavSection() {
    return _SectionCard(
      title: 'BottomNav',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Bottom Navigation Bar:'),
          const SizedBox(height: AppSpacing.xs),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: AppRadius.mdBorder,
            ),
            child: ClipRRect(
              borderRadius: AppRadius.mdBorder,
              child: BottomNav(
                currentIndex: 0,
                items: const [
                  BottomNavItem(icon: Icons.home_outlined, activeIcon: Icons.home, label: 'Home'),
                  BottomNavItem(icon: Icons.chat_bubble_outline, activeIcon: Icons.chat_bubble, label: 'Chat'),
                  BottomNavItem(icon: Icons.person_outline, activeIcon: Icons.person, label: 'Me'),
                ],
                onTap: (index) {},
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          const Text('With Badge:'),
          const SizedBox(height: AppSpacing.xs),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border),
              borderRadius: AppRadius.mdBorder,
            ),
            child: ClipRRect(
              borderRadius: AppRadius.mdBorder,
              child: BottomNav(
                currentIndex: 1,
                items: [
                  const BottomNavItem(icon: Icons.home_outlined, activeIcon: Icons.home, label: 'Home'),
                  BottomNavItem(
                    icon: Icons.chat_bubble_outline,
                    activeIcon: Icons.chat_bubble,
                    label: 'Chat',
                    badge: Badge(variant: BadgeVariant.count, count: 5),
                  ),
                  const BottomNavItem(icon: Icons.person_outline, activeIcon: Icons.person, label: 'Me'),
                ],
                onTap: (index) {},
              ),
            ),
          ),
        ],
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
            child: ClipRRect(
              borderRadius: AppRadius.mdBorder,
              child: TabBar(
                tabs: const ['All', 'Active', 'Completed'],
                currentIndex: 0,
                onTap: (index) {},
              ),
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
