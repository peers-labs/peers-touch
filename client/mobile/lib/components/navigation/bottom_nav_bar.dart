import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/utils/app_localizations_helper.dart';

class BottomNavBar extends StatelessWidget {
  final int currentIndex;
  final Function(int) onTap;
  final VoidCallback? onOutsideTap;

  const BottomNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.onOutsideTap,
  });

  @override
  Widget build(BuildContext context) {
    return BottomNavigationBar(
      currentIndex: currentIndex,
      onTap: (index) {
        // Call outside tap handler first to collapse floating action ball
        onOutsideTap?.call();
        // Then call the original onTap
        onTap(index);
      },
      type: BottomNavigationBarType.fixed,
      selectedItemColor: Colors.blue,
      unselectedItemColor: Colors.grey,
      backgroundColor: Colors.white,
      items: [
        BottomNavigationBarItem(
          icon: Icon(Icons.home),
          label: AppLocalizationsHelper.getLocalizedString(
            (l10n) => l10n.navHome,
            'Home',
          ),
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.chat),
          label: AppLocalizationsHelper.getLocalizedString(
            (l10n) => l10n.navChat,
            'Chat',
          ),
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.photo),
          label: AppLocalizationsHelper.getLocalizedString(
            (l10n) => l10n.navPhoto,
            'Photo',
          ),
        ),
        BottomNavigationBarItem(
          icon: Icon(Icons.person),
          label: AppLocalizationsHelper.getLocalizedString(
            (l10n) => l10n.navMe,
            'Me',
          ),
        ),
      ],
    );
  }
}
