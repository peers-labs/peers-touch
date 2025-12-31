import 'package:flutter/widgets.dart';

/// DemoController 提供 UI 所需的最小状态，遵循 PROMPTs：
/// - 控制器持有状态（ValueNotifier/ChangeNotifier），视图不持状态
/// - 视图通过 ListenableBuilder 订阅，不直接修改业务
class DemoController extends ChangeNotifier {
  // 左侧图标栏选中索引
  final ValueNotifier<int> sidebarIndex = ValueNotifier<int>(0);
  // 进度卡 Tab 索引
  final ValueNotifier<int> progressTab = ValueNotifier<int>(0);
  // 折线图数据
  final ValueNotifier<List<double>> linePoints = ValueNotifier<List<double>>(<double>[1, 2, 1.8, 2.2, 1.9, 2.5, 2.3]);
  final ValueNotifier<List<List<int>>> heatmap = ValueNotifier<List<List<int>>>(List<List<int>>.generate(5, (r) => List<int>.generate(7, (c) => (r + c) % 4)));
  final ValueNotifier<bool> showGallery = ValueNotifier<bool>(true);
  final ValueNotifier<double> accentAlpha = ValueNotifier<double>(0.9);
  final ValueNotifier<String> accentName = ValueNotifier<String>('Lilac');
  final ValueNotifier<int> sampleCount = ValueNotifier<int>(12);
  final ValueNotifier<List<String>> galleryUrls = ValueNotifier<List<String>>(<String>[
    'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=600',
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=600',
    'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600',
  ]);

  void toggleGallery(bool v) => showGallery.value = v;
  void setAlpha(double v) => accentAlpha.value = v;
  void setAccent(String v) => accentName.value = v;
  void setSamples(num v) => sampleCount.value = v.toInt();
  void randomizeHeatmap() {
    final rows = heatmap.value.length;
    final cols = heatmap.value.first.length;
    heatmap.value = List<List<int>>.generate(rows, (r) => List<int>.generate(cols, (c) => (r * c + DateTime.now().millisecond + r + c) % 4));
  }

  void selectSidebar(int i) => sidebarIndex.value = i;
  void selectProgressTab(int i) => progressTab.value = i;
  void updateLine(List<double> pts) => linePoints.value = List<double>.from(pts);

  @override
  void dispose() {
    sidebarIndex.dispose();
    progressTab.dispose();
    linePoints.dispose();
    heatmap.dispose();
    showGallery.dispose();
    accentAlpha.dispose();
    accentName.dispose();
    sampleCount.dispose();
    galleryUrls.dispose();
    super.dispose();
  }
}

/// DemoScope 作为 InheritedWidget 暴露控制器，避免在视图层传递控制器引用，保持视图纯粹
class DemoScope extends InheritedWidget {
  final DemoController controller;
  const DemoScope({super.key, required this.controller, required super.child});

  static DemoController of(context) => (context.dependOnInheritedWidgetOfExactType<DemoScope>())!.controller;

  @override
  bool updateShouldNotify(covariant DemoScope oldWidget) => controller != oldWidget.controller;
}
