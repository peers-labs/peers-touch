import 'package:get/get.dart';
import 'bindings/home_binding.dart';
import 'pages/home_page.dart';

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
