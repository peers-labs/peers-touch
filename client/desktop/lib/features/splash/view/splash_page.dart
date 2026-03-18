import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/peers_touch_base.dart';
import 'package:peers_touch_desktop/features/splash/controller/splash_controller.dart';

class SplashPage extends StatelessWidget {
  const SplashPage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<SplashController>();
    
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Spacer(flex: 2),
            
            Obx(() {
              final avatar = controller.userAvatar.value;
              final handle = controller.userHandle.value;
              
              if (avatar != null && avatar.isNotEmpty) {
                return Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.1),
                        blurRadius: 20,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: ClipOval(
                    child: Avatar(
                      actorId: handle ?? '',
                      avatarUrl: avatar,
                      fallbackName: handle ?? 'User',
                      size: 100,
                    ),
                  ),
                );
              }
              
              return Container(
                width: 100,
                height: 100,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Colors.blue.shade400,
                      Colors.blue.shade600,
                    ],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.blue.withValues(alpha: 0.3),
                      blurRadius: 20,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.touch_app,
                  size: 50,
                  color: Colors.white,
                ),
              );
            }),
            
            const SizedBox(height: 32),
            
            Text(
              'Peers Touch',
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.bold,
                color: Colors.grey.shade800,
                letterSpacing: -0.5,
              ),
            ),
            
            const SizedBox(height: 8),
            
            Obx(() {
              final handle = controller.userHandle.value;
              if (handle != null) {
                return Text(
                  '@$handle',
                  style: TextStyle(
                    fontSize: 16,
                    color: Colors.grey.shade600,
                  ),
                );
              }
              return const SizedBox.shrink();
            }),
            
            const Spacer(flex: 1),
            
            Obx(() {
              if (controller.showButtons.value) {
                return Column(
                  children: [
                    ElevatedButton(
                      onPressed: controller.directLogin,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.blue.shade600,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        elevation: 2,
                      ),
                      child: const Text(
                        '直接登录',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: controller.gotoLogin,
                      style: TextButton.styleFrom(
                        foregroundColor: Colors.grey.shade600,
                        padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 12),
                      ),
                      child: const Text(
                        '其它',
                        style: TextStyle(
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ],
                );
              }
              
              if (controller.isLoading.value) {
                return Column(
                  children: [
                    SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.blue.shade400),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      controller.statusMessage.value,
                      style: TextStyle(
                        fontSize: 14,
                        color: Colors.grey.shade600,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: controller.cancelLoading,
                      style: TextButton.styleFrom(
                        foregroundColor: Colors.grey.shade600,
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                      ),
                      child: const Text(
                        '取消',
                        style: TextStyle(fontSize: 12),
                      ),
                    ),
                  ],
                );
              }
              
              return Text(
                controller.statusMessage.value,
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey.shade600,
                ),
              );
            }),
            
            const Spacer(flex: 2),
          ],
        ),
      ),
    );
  }
}
