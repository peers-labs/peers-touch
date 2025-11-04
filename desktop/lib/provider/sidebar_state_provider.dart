import 'package:flutter/foundation.dart';

class SidebarStateProvider extends ChangeNotifier {
  bool _isCollapsed = false;
  bool _isMiddleColumnOpen = false;
  bool _isLeftSidebarOpen = true; // 添加左侧边栏状态
  
  bool get isCollapsed => _isCollapsed;
  bool get isMiddleColumnOpen => _isMiddleColumnOpen;
  bool get isLeftSidebarOpen => _isLeftSidebarOpen; // 添加getter
  
  void toggle() {
    _isCollapsed = !_isCollapsed;
    notifyListeners();
  }
  
  void collapse() {
    if (!_isCollapsed) {
      _isCollapsed = true;
      notifyListeners();
    }
  }
  
  void expand() {
    if (_isCollapsed) {
      _isCollapsed = false;
      notifyListeners();
    }
  }
  
  void toggleMiddleColumn() {
    _isMiddleColumnOpen = !_isMiddleColumnOpen;
    notifyListeners();
  }
  
  void openMiddleColumn() {
    if (!_isMiddleColumnOpen) {
      _isMiddleColumnOpen = true;
      notifyListeners();
    }
  }
  
  void closeMiddleColumn() {
    if (_isMiddleColumnOpen) {
      _isMiddleColumnOpen = false;
      notifyListeners();
    }
  }
  
  // 添加toggleLeftSidebar方法
  void toggleLeftSidebar() {
    _isLeftSidebarOpen = !_isLeftSidebarOpen;
    notifyListeners();
  }
}