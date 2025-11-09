import 'package:get/get.dart';

import 'package:peers_touch_desktop/features/home/home_binding.dart';
import 'package:peers_touch_desktop/features/home/view/home_page.dart';
import 'package:peers_touch_desktop/features/profile/profile_binding.dart';
import 'package:peers_touch_desktop/features/profile/view/profile_page.dart';
import 'package:peers_touch_desktop/features/shell/shell_binding.dart';
import 'package:peers_touch_desktop/features/shell/view/shell_page.dart';
import 'package:peers_touch_desktop/app/routes/app_routes.dart';

class AppPages {
  static final pages = <GetPage<dynamic>>[
    GetPage(
      name: AppRoutes.shell,
      page: () => const ShellPage(),
      binding: ShellBinding(),
    ),
    GetPage(
      name: AppRoutes.home,
      page: () => const HomePage(),
      binding: HomeBinding(),
    ),
    GetPage(
      name: AppRoutes.profile,
      page: () => const ProfilePage(),
      binding: ProfileBinding(),
    ),
  ];
}