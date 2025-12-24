
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '../controller/market_controller.dart';
import '../../applet_launcher/view/applet_container.dart';
import 'package:peers_touch_base/applet/models/applet_manifest.dart';

class MarketPage extends StatelessWidget {
  const MarketPage({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(MarketController());

    return Scaffold(
      appBar: AppBar(
        title: const Text('Applet Market'),
      ),
      body: Obx(() {
        return GridView.builder(
          padding: const EdgeInsets.all(16),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 4, // Desktop layout
            childAspectRatio: 0.8,
            crossAxisSpacing: 16,
            mainAxisSpacing: 16,
          ),
          itemCount: controller.applets.length,
          itemBuilder: (context, index) {
            final applet = controller.applets[index];
            return _buildAppletCard(context, applet, controller);
          },
        );
      }),
    );
  }

  Widget _buildAppletCard(BuildContext context, AppletManifest applet, MarketController controller) {
    return Card(
      elevation: 2,
      child: InkWell(
        onTap: () {
            // Navigate to Applet Container
            // We use direct navigation here for simplicity, but ideally use Get.toNamed
            // and setup routes in main.dart
            
            // Mock URL for testing: Vue Hello World from WebF examples
            const mockUrl = 'https://raw.githubusercontent.com/openwebf/webf/master/examples/vue/dist/bundle.js';
            
            Get.to(
              () => AppletContainer(
                manifest: applet,
                bundleUrl: mockUrl,
              ),
            );
        },
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Icon
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: Colors.blue.shade50,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.extension, size: 32, color: Colors.blue),
              ),
              const SizedBox(height: 16),
              // Name
              Text(
                applet.name,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 8),
              // Description
              Expanded(
                child: Text(
                  applet.description ?? '',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Colors.grey[600],
                  ),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              // Version
              Text(
                'v${applet.version}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Colors.grey[400],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
