import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/middlewares/auth_middleware.dart';
import 'package:peers_touch_desktop/app/routes/app_routes.dart';
import 'package:peers_touch_desktop/features/auth/view/login_page.dart';
import 'package:peers_touch_desktop/features/auth/view/signup_page.dart';
import 'package:peers_touch_desktop/features/home/binding/home_binding.dart';
import 'package:peers_touch_desktop/features/home/view/home_page.dart';
import 'package:peers_touch_desktop/features/launch/binding/launch_binding.dart';
import 'package:peers_touch_desktop/features/launch/view/launch_page.dart';
import 'package:peers_touch_desktop/features/profile/binding/profile_binding.dart';
import 'package:peers_touch_desktop/features/profile/view/profile_page.dart';
import 'package:peers_touch_desktop/features/shell/binding/shell_binding.dart';
import 'package:peers_touch_desktop/features/shell/view/shell_page.dart';
import 'package:peers_touch_desktop/features/social/social_module.dart';
import 'package:peers_touch_desktop/features/splash/binding/splash_binding.dart';
import 'package:peers_touch_desktop/features/splash/view/splash_page.dart';

class AppPages {
  static final pages = <GetPage<dynamic>>[
    GetPage(
      name: AppRoutes.splash,
      page: () => const SplashPage(),
      binding: SplashBinding(),
    ),
    GetPage(
      name: AppRoutes.login,
      page: () => const LoginPage(),
      // AuthController is now permanent in InitialBinding
      // binding: AuthBinding(), 
    ),
    GetPage(
      name: AppRoutes.signup,
      page: () => const SignupPage(),
      // binding: AuthBinding(),
    ),
    GetPage(
      name: AppRoutes.shell,
      page: () => const ShellPage(),
      binding: ShellBinding(),
      middlewares: [AuthMiddleware()],
    ),
    GetPage(
      name: AppRoutes.home,
      page: () => const HomePage(),
      binding: HomeBinding(),
      middlewares: [AuthMiddleware()],
    ),
    GetPage(
      name: AppRoutes.profile,
      page: () => const ProfilePage(),
      binding: ProfileBinding(),
      middlewares: [AuthMiddleware()],
    ),
    GetPage(
      name: AppRoutes.launch,
      page: () => const LaunchPage(),
      binding: LaunchBinding(),
      middlewares: [AuthMiddleware()],
    ),
    GetPage(
      name: AppRoutes.timeline,
      page: () => const TimelinePage(),
      binding: SocialBinding(),
      middlewares: [AuthMiddleware()],
    ),
  ];
}
