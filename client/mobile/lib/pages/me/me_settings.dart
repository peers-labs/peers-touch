import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:peers_touch_mobile/pages/me/me_general_settings.dart';

class MeSettingsPage extends StatelessWidget {
  MeSettingsPage({super.key});

  // Get the MeController instance for user data
  final meController = ControllerManager.meController;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: AppBar(
        backgroundColor: colorScheme.surface,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        shadowColor: Colors.transparent,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios, color: colorScheme.onSurface, size: 20),
          onPressed: () => Get.back(),
        ),
        title: Text(
          l10n.settings,
          style: TextStyle(
            color: colorScheme.onSurface,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        centerTitle: true,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1.0),
          child: Container(color: colorScheme.onSurface.withValues(alpha: 0.1), height: 0.5),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            children: [
              const SizedBox(height: 8),
              _buildSettingsFields(context, l10n),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSettingsFields(BuildContext context, AppLocalizations l10n) {
    return Column(
      children: [
        // My Account item
        _buildSettingsField(
          context,
          l10n.myAccount,
          '',
          Icons.account_circle_outlined,
          onTap: () {
            // TODO: Navigate to My Account page
          },
        ),
        _buildDivider(context),
        
        // General item
        _buildSettingsField(
          context,
          l10n.general,
          '',
          Icons.settings_outlined,
          onTap: () {
            // Navigate to General settings page
            Get.to(() => MeGeneralSettingsPage());
          },
        ),
      ],
    );
  }

  Widget _buildSettingsField(
    BuildContext context,
    String label,
    String value,
    IconData icon, {
    bool showTrailing = true,
    VoidCallback? onTap,
  }) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    Widget trailingWidget = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Value on the right
        if (value.isNotEmpty)
          Container(
            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.5),
            child: Text(
              value,
              style: TextStyle(
                color: colorScheme.onSurface.withValues(alpha: 0.7),
                fontSize: 16,
                fontWeight: FontWeight.w400,
              ),
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          
        // Chevron icon
        if (showTrailing)
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Icon(
              Icons.chevron_right,
              color: colorScheme.onSurface.withValues(alpha: 0.54),
              size: 20,
            ),
          ),
      ],
    );

    // Use ListTile for consistent layout and alignment
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      title: Text(
        label,
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 16,
          fontWeight: FontWeight.w400,
        ),
      ),
      trailing: trailingWidget,
      onTap: showTrailing ? onTap : null,
    );
  }

  Widget _buildDivider(BuildContext context) {
    return Container(
      margin: EdgeInsets.zero,
      height: 0.5,
      color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.1),
    );
  }
}