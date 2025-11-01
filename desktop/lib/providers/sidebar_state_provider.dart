import 'package:flutter/foundation.dart';

class SidebarStateProvider with ChangeNotifier {
  bool _isLeftSidebarOpen = true;
  bool _isMiddleColumnOpen = true;

  bool get isLeftSidebarOpen => _isLeftSidebarOpen;
  bool get isMiddleColumnOpen => _isMiddleColumnOpen;

  void toggleLeftSidebar() {
    _isLeftSidebarOpen = !_isLeftSidebarOpen;
    notifyListeners();
  }

  void toggleMiddleColumn() {
    _isMiddleColumnOpen = !_isMiddleColumnOpen;
    notifyListeners();
  }
}