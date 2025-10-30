import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/utils/snackbar_utils.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';

class FieldEditController extends GetxController {
  late TextEditingController textController;
  final formKey = GlobalKey<FormState>();
  final RxBool isLoading = false.obs;
  
  void initializeController(String initialValue) {
    textController = TextEditingController(text: initialValue);
  }
  
  @override
  void onClose() {
    textController.dispose();
    super.onClose();
  }
  
  Future<void> handleUpdate(Future<void> Function(String value) onUpdate, String fieldLabel) async {
    if (!formKey.currentState!.validate()) return;
    
    isLoading.value = true;
    try {
      await onUpdate(textController.text.trim());
      
      // Dismiss keyboard
      FocusScope.of(Get.context!).unfocus();
      
      // Show success message
      SnackbarUtils.showSuccess(
        'Success',
        '$fieldLabel updated successfully',
      );
      
      // Close drawer with small delay
      await Future.delayed(const Duration(milliseconds: 100));
      Get.back();
    } catch (e) {
      SnackbarUtils.showError('Error', 'Failed to update: $e');
    } finally {
      isLoading.value = false;
    }
  }
}

class FieldEditDrawer extends StatelessWidget {
  final String title;
  final String initialValue;
  final String fieldLabel;
  final IconData fieldIcon;
  final String? Function(String?) validator;
  final Future<void> Function(String value) onUpdate;
  final TextInputType? keyboardType;
  final int? maxLines;
  final int? maxLength;

  const FieldEditDrawer({
    super.key,
    required this.title,
    required this.initialValue,
    required this.fieldLabel,
    required this.fieldIcon,
    required this.validator,
    required this.onUpdate,
    this.keyboardType,
    this.maxLines = 1,
    this.maxLength,
  });

@override
  Widget build(BuildContext context) {
    final controller = Get.put(FieldEditController());
    controller.initializeController(initialValue);
    
    final colorScheme = Theme.of(context).colorScheme;
    final l10n = AppLocalizations.of(context)!;
    final bottomPadding = MediaQuery.of(context).padding.bottom;
    
    return Container(
      height: (MediaQuery.of(context).size.height * 0.32) + bottomPadding,
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          // Handle bar
          Container(
            margin: const EdgeInsets.only(top: 8),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: colorScheme.onSurface.withValues(alpha: 0.3),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          
          // Header
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              title,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w600,
                color: colorScheme.onSurface,
              ),
            ),
          ),
          
          // Form
          Expanded(
            child: Form(
              key: controller.formKey,
              child: SingleChildScrollView(
                padding: EdgeInsets.only(
                  left: 16,
                  right: 16,
                  bottom: MediaQuery.of(context).viewInsets.bottom + 16,
                ),
                child: Column(
                  children: [
                    TextFormField(
                      controller: controller.textController,
                      decoration: InputDecoration(
                        labelText: fieldLabel,
                        prefixIcon: Icon(fieldIcon),
                        border: const OutlineInputBorder(),
                      ),
                      keyboardType: keyboardType,
                      maxLines: maxLines,
                      maxLength: maxLength,
                      validator: validator,
                      autofocus: true,
                    ),
                    const SizedBox(height: 24),
                    
                    Obx(() => SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: controller.isLoading.value
                             ? null
                             : () => controller.handleUpdate(onUpdate, fieldLabel),
                        child: controller.isLoading.value
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Text(l10n.update),
                      ),
                    )),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// Helper function to show the field edit drawer
void showFieldEditDrawer({
  required BuildContext context,
  required String title,
  required String initialValue,
  required String fieldLabel,
  required IconData fieldIcon,
  required String? Function(String?) validator,
  required Future<void> Function(String value) onUpdate,
  TextInputType? keyboardType,
  int? maxLines = 1,
  int? maxLength,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    useSafeArea: false,
    builder: (context) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: FieldEditDrawer(
        title: title,
        initialValue: initialValue,
        fieldLabel: fieldLabel,
        fieldIcon: fieldIcon,
        validator: validator,
        onUpdate: onUpdate,
        keyboardType: keyboardType,
        maxLines: maxLines,
        maxLength: maxLength,
      ),
    ),
  );
}