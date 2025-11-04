import 'package:get/get.dart';

class AIChatSettingsController extends GetxController {
  final _autoComplete = true.obs;
  bool get autoComplete => _autoComplete.value;
  set autoComplete(bool value) => _autoComplete.value = value;

  final _saveHistory = true.obs;
  bool get saveHistory => _saveHistory.value;
  set saveHistory(bool value) => _saveHistory.value = value;

  final _sendOnEnter = false.obs;
  bool get sendOnEnter => _sendOnEnter.value;
  set sendOnEnter(bool value) => _sendOnEnter.value = value;

  final _responseSpeed = 'Balanced'.obs;
  String get responseSpeed => _responseSpeed.value;
  set responseSpeed(String value) => _responseSpeed.value = value;

  final _anonymousMode = false.obs;
  bool get anonymousMode => _anonymousMode.value;
  set anonymousMode(bool value) => _anonymousMode.value = value;

  final _autoDelete = false.obs;
  bool get autoDelete => _autoDelete.value;
  set autoDelete(bool value) => _autoDelete.value = value;
}