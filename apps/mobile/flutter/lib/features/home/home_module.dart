import 'package:get/get.dart';
import 'package:peers_touch_mobile/features/home/bindings/home_binding.dart';
import 'package:peers_touch_mobile/features/home/pages/home_page.dart';

class HomeModule {
  static const String routeName = '/home';
  
  static final List<GetPage> pages = [
    GetPage(
      name: routeName,
      page: () => const HomePage(),
      binding: HomeBinding(),
    ),
  ];
}
