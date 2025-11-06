import 'package:get/get.dart';
import 'package:peers_touch_mobile/app/routes/app_routes.dart';
import 'package:peers_touch_mobile/features/home/view/home_page.dart';
import 'package:peers_touch_mobile/features/home/home_binding.dart';
import 'package:peers_touch_mobile/features/chat/view/chat_page.dart' as feature_chat;
import 'package:peers_touch_mobile/features/photo/view/photo_page.dart' as feature_photo;
import 'package:peers_touch_mobile/features/profile/view/profile_page.dart' as feature_profile;
import 'package:peers_touch_mobile/pages/actor/auth_page.dart';

class AppPages {
  static final List<GetPage<dynamic>> routes = <GetPage<dynamic>>[
    GetPage(
      name: AppRoutes.main,
      page: () => const HomePage(),
      binding: HomeBinding(),
    ),
    GetPage(
      name: AppRoutes.auth,
      page: () => const AuthPage(),
    ),
    GetPage(
      name: AppRoutes.chat,
      page: () => const feature_chat.ChatPage(),
    ),
    GetPage(
      name: AppRoutes.photo,
      page: () => feature_photo.PhotoPage(),
    ),
    GetPage(
      name: AppRoutes.profile,
      page: () => const feature_profile.ProfilePage(),
    ),
  ];
}