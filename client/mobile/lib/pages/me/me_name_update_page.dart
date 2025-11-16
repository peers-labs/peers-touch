import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';

class NameUpdatePage extends StatelessWidget {
  NameUpdatePage({super.key});

  final TextEditingController _textController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  final RxBool _isLoading = false.obs;
  final _currentText = ''.obs;
  final meController = ControllerManager.meController;

  @override
  Widget build(BuildContext context) {
    // Initialize text controller with current name
    _textController.text = meController.userName.value;
    _currentText.value = meController.userName.value;
    
    // Add listener to trigger UI updates when text changes
    _textController.addListener(() {
      _currentText.value = _textController.text;
    });
    
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      backgroundColor: colorScheme.surface, // Use proper background color
      appBar: _buildAppBar(context, l10n, colorScheme),
      body: SafeArea(
        child: GestureDetector(
          onTap: () {
            // Dismiss keyboard when tapping outside input fields
            FocusScope.of(context).unfocus();
          },
          child: Padding(
            padding: const EdgeInsets.all(16.0), // 16px = 8px × 2 (follows 8px grid)
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const SizedBox(height: 24), // 24px = 8px × 3 (follows 8px grid)
                          
                          // Current name display
                          _buildCurrentNameDisplay(context, l10n, colorScheme),
                          
                          const SizedBox(height: 24), // 24px spacing between sections
                          
                          // Name input field
                          _buildNameInputField(context, l10n, colorScheme),
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
          '${l10n.update} ${l10n.name}',
          style: TextStyle(
            color: colorScheme.onSurface,
            fontSize: 18, // Follows typography rules for page_titles
            fontWeight: FontWeight.w500, // Follows typography rules
          ),
        ),
        centerTitle: true,
        actions: [
          Obx(() => TextButton(
            onPressed: (_isLoading.value || _currentText.value.trim() == meController.userName.value)
                ? null
                : () => _updateName(context, l10n),
            child: _isLoading.value
                ? const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  )
                : Text(
                    l10n.update,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      color: (_currentText.value.trim() == meController.userName.value)
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

  Widget _buildCurrentNameDisplay(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
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
             meController.userName.value,
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

  Widget _buildNameInputField(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return TextFormField(
      controller: _textController,
      decoration: InputDecoration(
        labelText: l10n.newLabel,
        prefixIcon: Icon(Icons.person_outline, color: colorScheme.onSurface.withValues(alpha: 0.6)),
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
      maxLength: 50,
      validator: (value) => _validateName(value, l10n),
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
              l10n.nameVisibilityHelper,
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

  String? _validateName(String? value, AppLocalizations l10n) {
    if (value == null || value.trim().isEmpty) {
      return l10n.nameCannotBeEmpty(l10n.name);
    }
    if (value.trim().length < 2) {
      return l10n.nameMinLength(l10n.name, 2);
    }
    if (value.trim().length > 50) {
      return l10n.nameMaxLength(l10n.name, 50);
    }
    return null;
  }

  Future<void> _updateName(BuildContext context, AppLocalizations l10n) async {
    if (!_formKey.currentState!.validate()) return;
    
    _isLoading.value = true;

    try {
      await meController.updateUserName(_textController.text.trim());
      Get.back();
      
      Get.snackbar(
        l10n.success,
        l10n.nameUpdatedSuccessfully(l10n.name),
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