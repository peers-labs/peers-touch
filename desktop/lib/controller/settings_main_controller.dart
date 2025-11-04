import 'package:get/get.dart';

class SettingsMainController extends GetxController {
  final _selectedSubIndex = 0.obs;
  int get selectedSubIndex => _selectedSubIndex.value;

  void selectSubIndex(int index) {
    _selectedSubIndex.value = index;
  }
}