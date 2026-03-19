import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';

class ShortBioUpdatePage extends StatelessWidget {
  ShortBioUpdatePage({super.key});

  final _formKey = GlobalKey<FormState>();
  final _textController = TextEditingController();
  final _isLoading = false.obs;
  final _currentText = ''.obs;

  // Get the MeController instance
  final meController = ControllerManager.meController;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    // Initialize with current short bio
    _textController.text = meController.whatsUp.value;
    _currentText.value = meController.whatsUp.value;

    // Listen to text changes
    _textController.addListener(() {
      _currentText.value = _textController.text;
    });

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: _buildAppBar(context, l10n, colorScheme),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16), // 16px = 8px × 2 (follows 8px grid)
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: 8), // 8px spacing (follows 8px grid)
                      
                      // Current short bio display
                      _buildCurrentShortBioDisplay(context, l10n, colorScheme),
                      
                      const SizedBox(height: 24), // 24px spacing between sections
                      
                      // Short bio input field
                      _buildShortBioInputField(context, l10n, colorScheme),
                    ],
                  ),
                ),
              ),
              
              // Helper text always at bottom
              Padding(
                padding: const EdgeInsets.only(top: 16.0, bottom: 16.0),
                child: _buildHelperText(context, l10n, colorScheme),
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
        l10n.shortBioUpdateTitle,
        style: TextStyle(
          color: colorScheme.onSurface,
          fontSize: 18, // Follows typography rules for page_titles
          fontWeight: FontWeight.w600, // Follows typography rules
        ),
      ),
      centerTitle: true,
      actions: [
        Obx(() => TextButton(
          onPressed: _isLoading.value
              ? null
              : () => _updateShortBio(context, l10n),
          child: _isLoading.value
              ? SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      colorScheme.primary,
                    ),
                  ),
                )
              : Text(
                  l10n.update,
                  style: TextStyle(
                    fontSize: 16, // Follows typography rules for module_titles
                    fontWeight: FontWeight.w500, // Follows typography rules
                    color: (_currentText.value.trim() == meController.whatsUp.value)
                        ? colorScheme.onSurface.withValues(alpha: 0.38)
                        : colorScheme.primary,
                  ),
                ),
        )),
        const SizedBox(width: 8),
      ],
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(1.0),
        child: Container(
          color: colorScheme.onSurface.withValues(alpha: 0.15), // Use proper theme opacity
          height: 0.5,
        ),
      ),
    );
  }

  Widget _buildCurrentShortBioDisplay(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return Container(
      padding: const EdgeInsets.all(16), // 16px = 8px × 2 (follows 8px grid)
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(8), // 8px radius (follows 8px grid)
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.current,
            style: TextStyle(
              fontSize: 13, // Follows typography rules for auxiliary_text
              color: colorScheme.onSurface.withValues(alpha: 0.7),
              fontWeight: FontWeight.w400, // Follows typography rules
            ),
          ),
          const SizedBox(height: 8), // 8px spacing (follows 8px grid)
          SizedBox(
            width: double.infinity,
            child: Obx(() => Text(
              meController.whatsUp.value.isEmpty ? l10n.shortBio : meController.whatsUp.value,
              style: TextStyle(
                fontSize: 16, // Follows typography rules for module_titles
                color: meController.whatsUp.value.isEmpty 
                    ? colorScheme.onSurface.withValues(alpha: 0.5)
                    : colorScheme.onSurface,
                fontWeight: FontWeight.w500, // Follows typography rules
                fontStyle: meController.whatsUp.value.isEmpty ? FontStyle.italic : FontStyle.normal,
              ),
            )),
          ),
        ],
      ),
    );
  }

  Widget _buildShortBioInputField(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return TextFormField(
      controller: _textController,
      decoration: InputDecoration(
        labelText: l10n.newLabel,
        prefixIcon: Icon(Icons.edit_outlined, color: colorScheme.onSurface.withValues(alpha: 0.6)),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8), // 8px radius (follows 8px grid)
        ),
        counterStyle: TextStyle(
          fontSize: 12, // Follows typography rules for label_text
          color: colorScheme.onSurface.withValues(alpha: 0.6),
        ),
      ),
      style: TextStyle(
        fontSize: 15, // Follows typography rules for body_text
        fontWeight: FontWeight.w400, // Follows typography rules
        color: colorScheme.onSurface,
      ),
      maxLength: 30,
      maxLines: 3,
      minLines: 1,
      validator: (value) => _validateShortBio(value, l10n),
      autofocus: false,
      onChanged: (value) {
        // Counter updates automatically with TextFormField
      },
    );
  }

  Widget _buildHelperText(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return Container(
      padding: const EdgeInsets.all(16), // 16px = 8px × 2 (follows 8px grid)
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(8), // 8px radius (follows 8px grid)
      ),
      child: Row(
        children: [
          Icon(
            Icons.info_outline,
            size: 16, // 16px = 8px × 2 (follows 8px grid)
            color: colorScheme.onSurface.withValues(alpha: 0.6),
          ),
          const SizedBox(width: 8), // 8px spacing (follows 8px grid)
          Expanded(
            child: Text(
              l10n.shortBioHelper,
              style: TextStyle(
                fontSize: 12, // Follows typography rules for label_text
                color: colorScheme.onSurface.withValues(alpha: 0.6),
                fontWeight: FontWeight.w400, // Follows typography rules
              ),
            ),
          ),
        ],
      ),
    );
  }

  String? _validateShortBio(String? value, AppLocalizations l10n) {
    if (value != null && value.length > 30) {
      return l10n.shortBioMaxLength;
    }
    return null;
  }

  Future<void> _updateShortBio(BuildContext context, AppLocalizations l10n) async {
    if (!_formKey.currentState!.validate()) return;
    
    _isLoading.value = true;

    try {
      meController.updateUserInfo(whatsUp: _textController.text.trim());
      Get.back();
      
      Get.snackbar(
        l10n.success,
        l10n.nameUpdatedSuccessfully(l10n.shortBio),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.green.withValues(alpha: 0.8), // Use proper opacity method
        colorText: Colors.white,
      );
    } catch (e) {
      Get.snackbar(
        l10n.error,
        l10n.unexpectedError(e.toString()),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.red.withValues(alpha: 0.8), // Use proper opacity method
        colorText: Colors.white,
      );
    } finally {
      _isLoading.value = false;
    }
  }
}