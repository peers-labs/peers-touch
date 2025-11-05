import 'package:get/get.dart';

class GeneralSettingsController extends GetxController {
  final _selectedLanguage = 'English'.obs;
  String get selectedLanguage => _selectedLanguage.value;
  set selectedLanguage(String value) => _selectedLanguage.value = value;

  final _selectedTheme = 'System default'.obs;
  String get selectedTheme => _selectedTheme.value;
  set selectedTheme(String value) => _selectedTheme.value = value;

  final _notifications = true.obs;
  bool get notifications => _notifications.value;
  set notifications(bool value) => _notifications.value = value;

  final _startOnStartup = false.obs;
  bool get startOnStartup => _startOnStartup.value;
  set startOnStartup(bool value) => _startOnStartup.value = value;
}