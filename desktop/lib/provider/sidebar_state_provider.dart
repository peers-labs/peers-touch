import 'package:flutter/material.dart';

class SidebarStateProvider extends ChangeNotifier {
  bool _isMiddleColumnOpen = true;

  bool get isMiddleColumnOpen => _isMiddleColumnOpen;

  void toggleMiddleColumn() {
    _isMiddleColumnOpen = !_isMiddleColumnOpen;
    notifyListeners();
  }
}