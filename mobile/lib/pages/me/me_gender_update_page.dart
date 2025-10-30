import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';

class GenderUpdatePage extends StatelessWidget {
  GenderUpdatePage({super.key});

  final _formKey = GlobalKey<FormState>();
  final RxBool _isLoading = false.obs;
  final RxString _selectedGender = ''.obs;
  final meController = ControllerManager.meController;

  @override
  Widget build(BuildContext context) {
    // Initialize selected gender with current value
    _selectedGender.value = meController.gender.value;
    
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
                          
                          // Current gender display
                          _buildCurrentGenderDisplay(context, l10n, colorScheme),
                          
                          const SizedBox(height: 24), // 24px spacing between sections
                          
                          // Gender selection field
                          _buildGenderSelectionField(context, l10n, colorScheme),
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
          '${l10n.update} ${l10n.gender}',
          style: TextStyle(
            color: colorScheme.onSurface,
            fontSize: 18, // Follows typography rules for page_titles
            fontWeight: FontWeight.w500, // Follows typography rules
          ),
        ),
        centerTitle: true,
        actions: [
          Obx(() => TextButton(
            onPressed: (_isLoading.value || _selectedGender.value == meController.gender.value)
                ? null
                : () => _updateGender(context, l10n),
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
                      color: (_selectedGender.value == meController.gender.value)
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

  Widget _buildCurrentGenderDisplay(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
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
               fontSize: 12, // Follows typography rules for label_text
               color: colorScheme.onSurface.withValues(alpha: 0.6),
               fontWeight: FontWeight.w400, // Follows typography rules
             ),
           ),
           const SizedBox(height: 8), // 8px spacing (follows 8px grid)
           Obx(() => Text(
             meController.gender.value,
             style: TextStyle(
               fontSize: 16, // Follows typography rules for body_text
               color: colorScheme.onSurface,
               fontWeight: FontWeight.w500, // Slightly bolder for current value
             ),
           )),
        ],
      ),
    );
  }

  Widget _buildGenderSelectionField(BuildContext context, AppLocalizations l10n, ColorScheme colorScheme) {
    return Container(
      padding: const EdgeInsets.all(16), // 16px = 8px × 2 (follows 8px grid)
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8), // 8px radius (follows 8px grid)
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.gender,
            style: TextStyle(
              fontSize: 14, // Follows typography rules for label_text
              color: colorScheme.onSurface.withValues(alpha: 0.8),
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 16), // 16px spacing (follows 8px grid)
          
          // Gender selection using RadioListTile
          Obx(() => Column(
            children: [
              // Male option
              RadioListTile<String>(
                title: Text(
                  l10n.male,
                  style: TextStyle(
                    fontSize: 15, // Follows typography rules for body_text
                    color: colorScheme.onSurface,
                    fontWeight: FontWeight.w400,
                  ),
                ),
                value: 'Male',
                groupValue: _selectedGender.value,
                onChanged: (String? value) {
                  if (value != null) {
                    _selectedGender.value = value;
                  }
                },
                fillColor: WidgetStateProperty.resolveWith<Color>(
                  (Set<WidgetState> states) {
                    if (states.contains(WidgetState.selected)) {
                      return colorScheme.primary;
                    }
                    return colorScheme.onSurface.withValues(alpha: 0.6);
                  },
                ),
                contentPadding: EdgeInsets.zero,
              ),
              
              // Female option
              RadioListTile<String>(
                title: Text(
                  l10n.female,
                  style: TextStyle(
                    fontSize: 15, // Follows typography rules for body_text
                    color: colorScheme.onSurface,
                    fontWeight: FontWeight.w400,
                  ),
                ),
                value: 'Female',
                groupValue: _selectedGender.value,
                onChanged: (String? value) {
                  if (value != null) {
                    _selectedGender.value = value;
                  }
                },
                fillColor: WidgetStateProperty.resolveWith<Color>(
                  (Set<WidgetState> states) {
                    if (states.contains(WidgetState.selected)) {
                      return colorScheme.primary;
                    }
                    return colorScheme.onSurface.withValues(alpha: 0.6);
                  },
                ),
                contentPadding: EdgeInsets.zero,
              ),
              
              // Prefer not to say option
              RadioListTile<String>(
                title: Text(
                  l10n.preferNotToSay,
                  style: TextStyle(
                    fontSize: 15, // Follows typography rules for body_text
                    color: colorScheme.onSurface,
                    fontWeight: FontWeight.w400,
                  ),
                ),
                value: 'Prefer not to say',
                groupValue: _selectedGender.value,
                onChanged: (String? value) {
                  if (value != null) {
                    _selectedGender.value = value;
                  }
                },
                fillColor: WidgetStateProperty.resolveWith<Color>(
                  (Set<WidgetState> states) {
                    if (states.contains(WidgetState.selected)) {
                      return colorScheme.primary;
                    }
                    return colorScheme.onSurface.withValues(alpha: 0.6);
                  },
                ),
                contentPadding: EdgeInsets.zero,
              ),
            ],
          )),
        ],
      ),
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
              'Your gender information helps personalize your experience and is visible to other users.',
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

  Future<void> _updateGender(BuildContext context, AppLocalizations l10n) async {
    _isLoading.value = true;

    try {
      // Update gender using the controller's updateUserInfo method
      meController.updateUserInfo(gender: _selectedGender.value);
      Get.back();
      
      Get.snackbar(
        l10n.success,
        l10n.nameUpdatedSuccessfully(l10n.gender),
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