
import 'package:get/get.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';

class MarketController extends GetxController {
  final RxList<AppletManifest> applets = <AppletManifest>[].obs;

  @override
  void onInit() {
    super.onInit();
    loadMockApplets();
  }

  void loadMockApplets() {
    // Mock data for MVP
    applets.value = [
      AppletManifest(
        appId: 'com.peers.demo',
        version: '1.0.0',
        name: 'Demo Applet',
        description: 'A simple demo showing WebF capabilities',
        icon: 'assets/icons/ai-chat/chat.svg', // Placeholder
        entryPoint: 'bundle.js',
        permissions: ['system', 'network'],
      ),
      AppletManifest(
        appId: 'com.peers.calculator',
        version: '0.1.0',
        name: 'Calculator',
        description: 'Simple calculator tool',
        icon: null,
        entryPoint: 'bundle.js',
        permissions: [],
      ),
    ];
  }

  void openApplet(AppletManifest applet) {
    // For MVP, we assume the bundle is at a specific test URL
    // In production, this would resolve to a local file path after download
    String bundleUrl = 'https://raw.githubusercontent.com/openwebf/webf/master/examples/vue/dist/bundle.js';
    
    Get.toNamed(
      '/applet/${applet.appId}',
      arguments: {
        'manifest': applet,
        'bundleUrl': bundleUrl,
      },
    );
  }
}
