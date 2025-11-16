import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';

class PeersIdUpdatePage extends StatelessWidget {
  PeersIdUpdatePage({super.key});

  final meController = ControllerManager.meController;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: _buildAppBar(context, l10n, colorScheme),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16.0), // 16px = 8px × 2 (follows 8px grid)
          child: Column(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 16), // 16px spacing (follows 8px grid)
                      
                      // Current PeersID display
                      SizedBox(
                        width: double.infinity,
                        child: _buildCurrentPeersIdDisplay(context, l10n, colorScheme),
                      ),
                      
                      const SizedBox(height: 24), // 24px spacing (follows 8px grid)
                      
                      // Read-only message
                      SizedBox(
                        width: double.infinity,
                        child: _buildReadOnlyMessage(context, l10n, colorScheme),
                      ),
                      
                      const SizedBox(height: 16), // 16px spacing (follows 8px grid)
                      
                      // Helper text
                      SizedBox(
                        width: double.infinity,
                        child: _buildHelperText(context, l10n, colorScheme),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return AppBar(
      backgroundColor: colorScheme.surface,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      leading: IconButton(
        icon: Icon(Icons.arrow_back_ios, color: colorScheme.onSurface, size: 20),
        onPressed: () => Get.back(),
      ),
      title: Text(
        l10n.peersIdUpdateTitle,
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 18,
          fontWeight: FontWeight.w600,
        ),
      ),
      centerTitle: true,
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(1.0),
        child: Container(
          color: colorScheme.onSurface.withValues(alpha: 0.1),
          height: 0.5,
        ),
      ),
    );
  }

  Widget _buildCurrentPeersIdDisplay(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return Container(
      padding: const EdgeInsets.all(16), // 16px padding (follows 8px grid)
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(12), // 12px radius (follows 4px grid)
        border: Border.all(
          color: colorScheme.outline.withValues(alpha: 0.2),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.current,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: colorScheme.onSurface.withValues(alpha: 0.7),
            ),
          ),
          const SizedBox(height: 8), // 8px spacing (follows 8px grid)
          Obx(() => Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16), // 12px vertical, 16px horizontal
            decoration: BoxDecoration(
              color: colorScheme.surface,
              borderRadius: BorderRadius.circular(8), // 8px radius (follows 4px grid)
              border: Border.all(
                color: colorScheme.outline.withValues(alpha: 0.3),
                width: 1,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.fingerprint_outlined,
                  color: colorScheme.onSurface.withValues(alpha: 0.6),
                  size: 20,
                ),
                const SizedBox(width: 12), // 12px spacing (follows 4px grid)
                Expanded(
                  child: Text(
                    meController.peersId.value,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w400,
                      color: colorScheme.onSurface,
                    ),
                  ),
                ),
              ],
            ),
          )),
        ],
      ),
    );
  }

  Widget _buildReadOnlyMessage(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return Container(
      padding: const EdgeInsets.all(16), // 16px padding (follows 8px grid)
      decoration: BoxDecoration(
        color: colorScheme.primaryContainer.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12), // 12px radius (follows 4px grid)
        border: Border.all(
          color: colorScheme.primary.withValues(alpha: 0.2),
          width: 1,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.info_outline,
            color: colorScheme.primary,
            size: 24,
          ),
          const SizedBox(width: 12), // 12px spacing (follows 4px grid)
          Expanded(
            child: Text(
              l10n.peersIdReadOnlyMessage,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w400,
                color: colorScheme.onSurface.withValues(alpha: 0.8),
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHelperText(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return Container(
      padding: const EdgeInsets.all(12), // 12px padding (follows 4px grid)
      child: Text(
        l10n.peersIdHelper,
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w400,
          color: colorScheme.onSurface.withValues(alpha: 0.6),
          height: 1.3,
        ),
      ),
    );
  }
}