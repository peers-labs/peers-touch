import 'package:desktop/controller/provider_settings_controller.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class ProviderSettingsPage extends StatelessWidget {
  const ProviderSettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(ProviderSettingsController());

    return Row(
      children: [
        // 左侧 Provider 列表
        Expanded(
          flex: 2,
          child: Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(
                right: BorderSide(color: Color(0xFFE0E0E0)),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 列表标题
                const Padding(
                  padding: EdgeInsets.all(24.0),
                  child: Text(
                    'AI Providers',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                      color: Color(0xFF1A1A1A),
                    ),
                  ),
                ),
                // Provider 列表
                Expanded(
                  child: Obx(() => ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    itemCount: controller.providers.length,
                    itemBuilder: (context, index) {
                      final provider = controller.providers[index];
                      final isSelected = controller.selectedProviderId.value == provider.id;
                      
                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        decoration: BoxDecoration(
                          color: isSelected ? const Color(0xFFF0F7FF) : Colors.transparent,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: isSelected ? const Color(0xFF2196F3) : Colors.transparent,
                            width: 1,
                          ),
                        ),
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 8,
                          ),
                          leading: Container(
                            width: 40,
                            height: 40,
                            decoration: BoxDecoration(
                              color: const Color(0xFFF5F5F5),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Center(
                              child: Text(
                                provider.logo,
                                style: const TextStyle(fontSize: 20),
                              ),
                            ),
                          ),
                          title: Text(
                            provider.name,
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w500,
                              color: isSelected ? const Color(0xFF1976D2) : const Color(0xFF1A1A1A),
                            ),
                          ),
                          subtitle: Text(
                            provider.description,
                            style: TextStyle(
                              fontSize: 12,
                              color: isSelected ? const Color(0xFF1976D2).withOpacity(0.7) : const Color(0xFF666666),
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: Switch(
                            value: provider.enabled,
                            onChanged: (value) => controller.toggleProvider(provider.id, value),
                            activeColor: const Color(0xFF4CAF50),
                            inactiveThumbColor: const Color(0xFFBDBDBD),
                            inactiveTrackColor: const Color(0xFFE0E0E0),
                          ),
                          onTap: () => controller.selectProvider(provider.id),
                        ),
                      );
                    },
                  )),
                ),
              ],
            ),
          ),
        ),
        
        // 右侧 Provider 详情
        Expanded(
          flex: 3,
          child: Container(
            color: const Color(0xFFFAFAFA),
            child: Obx(() => controller.selectedProviderId.value != null
                ? _buildProviderDetails(controller.selectedProvider!)
                : _buildEmptyState()),
          ),
        ),
      ],
    );
  }

  Widget _buildProviderDetails(ProviderModel provider) {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Provider 标题区域
          Row(
            children: [
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.1),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Center(
                  child: Text(
                    provider.logo,
                    style: const TextStyle(fontSize: 28),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      provider.name,
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF1A1A1A),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      provider.description,
                      style: const TextStyle(
                        fontSize: 14,
                        color: Color(0xFF666666),
                      ),
                    ),
                  ],
                ),
              ),
              GetX<ProviderSettingsController>(
                builder: (controller) => Switch(
                  value: provider.enabled,
                  onChanged: (value) => controller.toggleProvider(provider.id, value),
                  activeColor: const Color(0xFF4CAF50),
                ),
              ),
            ],
          ),
          
          const SizedBox(height: 32),
          
          // 详情内容区域（暂时留白）
          Expanded(
            child: Container(
              width: double.infinity,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFE0E0E0)),
              ),
              child: const Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.settings_outlined,
                      size: 48,
                      color: Color(0xFFBDBDBD),
                    ),
                    SizedBox(height: 16),
                    Text(
                      'Provider 详细配置',
                      style: TextStyle(
                        fontSize: 16,
                        color: Color(0xFF666666),
                      ),
                    ),
                    SizedBox(height: 8),
                    Text(
                      '即将推出...',
                      style: TextStyle(
                        fontSize: 14,
                        color: Color(0xFFBDBDBD),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return const Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.touch_app_outlined,
            size: 64,
            color: Color(0xFFBDBDBD),
          ),
          SizedBox(height: 16),
          Text(
            '选择一个 Provider',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w500,
              color: Color(0xFF666666),
            ),
          ),
          SizedBox(height: 8),
          Text(
            '点击左侧列表中的 Provider 查看详细信息',
            style: TextStyle(
              fontSize: 14,
              color: Color(0xFFBDBDBD),
            ),
          ),
        ],
      ),
    );
  }
}