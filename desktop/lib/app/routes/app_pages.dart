import 'package:get/get.dart';

import '../../features/home/home_binding.dart';
import '../../features/home/view/home_page.dart';
import '../../features/profile/profile_binding.dart';
import '../../features/profile/view/profile_page.dart';
import '../../features/shell/shell_binding.dart';
import '../../features/shell/view/shell_page.dart';
import 'app_routes.dart';

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