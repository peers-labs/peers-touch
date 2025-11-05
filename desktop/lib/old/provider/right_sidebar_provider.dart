import 'package:flutter/material.dart';

class RightSidebarProvider extends ChangeNotifier {
  bool _isOpen = false;

  bool get isOpen => _isOpen;

  void toggle() {
    _isOpen = !_isOpen;
    notifyListeners();
  }
}