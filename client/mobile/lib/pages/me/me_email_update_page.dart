import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';

class EmailUpdatePage extends StatelessWidget {
  EmailUpdatePage({super.key});

  final TextEditingController _textController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  final RxBool _isLoading = false.obs;
  final _currentText = ''.obs;
  final RxBool _allowEmailPublishing = false.obs;
  final RxBool _initialEmailPublishing = false.obs;
  final meController = ControllerManager.meController;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final colorScheme = Theme.of(context).colorScheme;
    
    // Initialize text controller with current email
    _textController.text = meController.email.value;
    _currentText.value = meController.email.value;
    
    // Initialize visibility state (assuming false for now, should be loaded from user preferences)
    _initialEmailPublishing.value = _allowEmailPublishing.value;
    
    // Add listener to update reactive variable
    _textController.addListener(() {
      _currentText.value = _textController.text;
    });

    return Scaffold(
      appBar: _buildAppBar(context, l10n, colorScheme),
      body: Form(
        key: _formKey,
        child: SafeArea(
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
                        
                        // Current email display
                        SizedBox(
                          width: double.infinity,
                          child: _buildCurrentEmailDisplay(context, l10n, colorScheme),
                        ),
                        
                        const SizedBox(height: 24), // 24px spacing between sections
                        
                        // Email input field
                        SizedBox(
                          width: double.infinity,
                          child: _buildEmailInputField(context, l10n, colorScheme),
                        ),
                        
                        const SizedBox(height: 24), // 24px spacing between sections
                        
                        // Email visibility option
                        SizedBox(
                          width: double.infinity,
                          child: _buildEmailVisibilityOption(context, l10n, colorScheme),
                        ),
                      ],
                    ),
                  ),
                ),
                
                // Helper text always at bottom
                Padding(
                  padding: const EdgeInsets.only(top: 16.0, bottom: 16.0),
                  child: SizedBox(
                    width: double.infinity,
                    child: _buildHelperText(context, l10n, colorScheme),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return AppBar(
        backgroundColor: colorScheme.surface,
        foregroundColor: colorScheme.onSurface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          l10n.email,
          style: const TextStyle(
            fontSize: 18, // Follows typography rules for page_titles
            fontWeight: FontWeight.w600, // Follows typography rules
          ),
        ),
        actions: [
          Obx(() => TextButton(
            onPressed: (_isLoading.value || 
                       (_currentText.value.trim() == meController.email.value && 
                        _allowEmailPublishing.value == _initialEmailPublishing.value) ||
                       _validateEmail(_currentText.value, l10n) != null)
                ? null
                : () => _updateEmail(context, l10n),
            child: _isLoading.value
                ? const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  )
                : Text(
                    l10n.update,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      color: ((_currentText.value.trim() == meController.email.value && 
                               _allowEmailPublishing.value == _initialEmailPublishing.value) ||
                              _validateEmail(_currentText.value, l10n) != null)
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

  Widget _buildCurrentEmailDisplay(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
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
          Obx(() => Text(
             meController.email.value,
             style: TextStyle(
               fontSize: 16, // Follows typography rules for module_titles
               color: colorScheme.onSurface,
               fontWeight: FontWeight.w500, // Follows typography rules
             ),
           )),
        ],
      ),
    );
  }

  Widget _buildEmailInputField(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return TextFormField(
      controller: _textController,
      decoration: InputDecoration(
        labelText: l10n.newLabel,
        prefixIcon: Icon(Icons.email_outlined, color: colorScheme.onSurface.withValues(alpha: 0.6)),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8), // 8px radius (follows 8px grid)
        ),
        counterText: '',
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
      keyboardType: TextInputType.emailAddress,
      validator: (value) => _validateEmail(value, l10n),
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
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(8), // 8px radius (follows 8px grid)
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.info_outline,
            size: 16,
            color: colorScheme.onSurface.withValues(alpha: 0.6),
          ),
          const SizedBox(width: 8), // 8px spacing (follows 8px grid)
          Expanded(
            child: Text(
              l10n.emailVisibilityHelper,
              style: TextStyle(
                fontSize: 13, // Follows typography rules for auxiliary_text
                color: colorScheme.onSurface.withValues(alpha: 0.7),
                fontWeight: FontWeight.w400, // Follows typography rules
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmailVisibilityOption(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
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
            l10n.emailVisibilityTitle,
            style: TextStyle(
              fontSize: 16, // Follows typography rules for module_titles
              color: colorScheme.onSurface,
              fontWeight: FontWeight.w500, // Follows typography rules
            ),
          ),
          const SizedBox(height: 12), // 12px spacing (follows 8px grid)
          Obx(() => SwitchListTile(
            value: _allowEmailPublishing.value,
            onChanged: (value) {
              _allowEmailPublishing.value = value;
            },
            title: Text(
              l10n.allowEmailPublishing,
              style: TextStyle(
                fontSize: 15, // Follows typography rules for body_text
                color: colorScheme.onSurface,
                fontWeight: FontWeight.w400, // Follows typography rules
              ),
            ),
            contentPadding: EdgeInsets.zero,
            activeTrackColor: colorScheme.primary,
          )),
          const SizedBox(height: 8), // 8px spacing (follows 8px grid)
          Text(
            l10n.emailPublishingHelper,
            style: TextStyle(
              fontSize: 13, // Follows typography rules for auxiliary_text
              color: colorScheme.onSurface.withValues(alpha: 0.7),
              fontWeight: FontWeight.w400, // Follows typography rules
            ),
          ),
        ],
      ),
    );
  }

  String? _validateEmail(String? value, AppLocalizations l10n) {
    if (value == null || value.trim().isEmpty) {
      return l10n.nameCannotBeEmpty(l10n.email);
    }
    
    // Email format validation - relaxed pattern
    final emailRegex = RegExp(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$');
    if (!emailRegex.hasMatch(value.trim())) {
      return l10n.emailValidationError;
    }
    
    return null;
  }

  Future<void> _updateEmail(BuildContext context, AppLocalizations l10n) async {
    if (!_formKey.currentState!.validate()) return;
    
    _isLoading.value = true;

    try {
      // Update email if it has changed
      if (_textController.text.trim() != meController.email.value) {
        await meController.updateUserEmail(_textController.text.trim());
      }
      
      // Update email visibility preference if it has changed
      if (_allowEmailPublishing.value != _initialEmailPublishing.value) {
        // TODO: Add method to update email visibility preference
        // await meController.updateEmailVisibility(_allowEmailPublishing.value);
        _initialEmailPublishing.value = _allowEmailPublishing.value;
      }
      
      Get.back();
      
      Get.snackbar(
        l10n.success,
        l10n.nameUpdatedSuccessfully(l10n.email),
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