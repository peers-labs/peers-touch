import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:jdenticon_dart/jdenticon_dart.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'dart:ui';

class AvatarChangePage extends StatefulWidget {
  const AvatarChangePage({super.key});

  @override
  State<AvatarChangePage> createState() => _AvatarChangePageState();
}

class _AvatarChangePageState extends State<AvatarChangePage> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  bool _showOptions = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    _animation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOut,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _toggleOptions() {
    setState(() {
      _showOptions = !_showOptions;
      if (_showOptions) {
        _controller.forward();
      } else {
        _controller.reverse();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final isDarkMode = theme.brightness == Brightness.dark;
    
    // Determine colors based on theme
    final backgroundColor = isDarkMode ? Colors.black : Colors.white;
    final textColor = isDarkMode ? Colors.white : Colors.black;
    final iconColor = isDarkMode ? Colors.white : Colors.black87;
    
    return Scaffold(
      backgroundColor: backgroundColor,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: Icon(
            Icons.arrow_back_ios,
            color: iconColor,
            size: 20,
          ),
          onPressed: () => Get.back(),
        ),
        title: Text(
          l10n.navPhoto, // Using l10n for "Photo" text
          style: TextStyle(
            color: textColor,
            fontSize: 18,
            fontWeight: FontWeight.w500,
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(
              Icons.more_horiz,
              color: iconColor,
              size: 24,
            ),
            onPressed: _toggleOptions,
          ),
        ],
        centerTitle: true,
      ),
      body: GestureDetector(
        // Add GestureDetector to handle taps outside the drawer
        onTap: () {
          if (_showOptions) {
            _toggleOptions(); // Close the drawer when tapping outside
          }
        },
        child: Stack(
          children: [
            // Full screen photo
            Center(
              child: InteractiveViewer(
                minScale: 0.5,
                maxScale: 3.0,
                child: Obx(() {
                  final profileController = ControllerManager.profileController;
                  
                  if (profileController.hasProfileImage.value && profileController.profileImage.value != null) {
                    return Image.file(
                      profileController.profileImage.value!,
                      fit: BoxFit.contain,
                      width: double.infinity,
                      height: double.infinity,
                    );
                  } else {
                    final deviceIdController = ControllerManager.deviceIdController;
                    final identiconInput = deviceIdController.getIdenticonInput();
                    
                    return SvgPicture.string(
                      Jdenticon.toSvg(identiconInput),
                      fit: BoxFit.contain,
                      width: MediaQuery.of(context).size.width * 0.8,
                      height: MediaQuery.of(context).size.width * 0.8,
                    );
                  }
                }),
              ),
            ),
            
            // Blur overlay when options are shown
            if (_showOptions)
              AnimatedOpacity(
                opacity: _animation.value,
                duration: const Duration(milliseconds: 300),
                child: Stack(
                  children: [
                    // Blur effect
                    BackdropFilter(
                      filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20), // Increased blur intensity
                      child: Container(
                        color: isDarkMode 
                          ? Colors.black.withValues(red: 0, green: 0, blue: 0, alpha: 0.7) // Darker overlay for dark mode
                          : Colors.white.withValues(red: 255, green: 255, blue: 255, alpha: 0.6), // Lighter overlay for light mode
                        width: double.infinity,
                        height: double.infinity,
                      ),
                    ),
                    // Visual indicator that the background is blurred
                    Center(
                      child: Container(
                        width: 60,
                        height: 60,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isDarkMode 
                            ? Colors.white.withValues(alpha: 0.1)
                            : Colors.black.withValues(alpha: 0.1),
                          boxShadow: [
                            BoxShadow(
                              color: isDarkMode 
                                ? Colors.white.withValues(alpha: 0.1)
                                : Colors.black.withValues(alpha: 0.1),
                              blurRadius: 20,
                              spreadRadius: 5,
                            ),
                          ],
                        ),
                        child: Icon(
                          Icons.photo,
                          size: 30,
                          color: isDarkMode ? Colors.white.withValues(red: 255, green: 255, blue: 255, alpha: 0.5) : Colors.black.withValues(red: 0, green: 0, blue: 0, alpha: 0.5),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            
            // Bottom options sheet
            AnimatedBuilder(
              animation: _animation,
              builder: (context, child) {
                return Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  child: _showOptions ? _buildOptionsSheet(context) : const SizedBox.shrink(),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOptionsSheet(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final isDarkMode = theme.brightness == Brightness.dark;
    
    // Determine colors based on theme
    final sheetBackgroundColor = isDarkMode 
        ? Colors.black.withValues(red: 0, green: 0, blue: 0, alpha: 0.8) 
        : Colors.white.withValues(red: 255, green: 255, blue: 255, alpha: 0.9);
    final textColor = isDarkMode ? Colors.white : Colors.black87;
    final dividerColor = isDarkMode 
        ? Colors.white.withValues(red: 255, green: 255, blue: 255, alpha: 0.2) 
        : Colors.black.withValues(red: 0, green: 0, blue: 0, alpha: 0.1);
    final cancelButtonColor = isDarkMode 
        ? Colors.black.withValues(red: 0, green: 0, blue: 0, alpha: 0.6) 
        : Colors.grey.withValues(red: 128, green: 128, blue: 128, alpha: 0.2);
    
    return SlideTransition(
      position: Tween<Offset>(
        begin: const Offset(0, 1),
        end: Offset.zero,
      ).animate(_animation),
      child: GestureDetector(
        // Prevent taps on the sheet from closing it
        onTap: () {}, 
        child: Container(
          decoration: BoxDecoration(
            color: sheetBackgroundColor,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(16),
              topRight: Radius.circular(16),
            ),
          ),
          child: ClipRRect(
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(16),
              topRight: Radius.circular(16),
            ),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20), // Increased blur intensity for better effect
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildOptionItem(l10n.takePhoto, () => _takePhoto(context), textColor),
                  _buildDivider(dividerColor),
                  _buildOptionItem(l10n.chooseFromGallery, () => _chooseFromAlbum(context), textColor),
                  _buildDivider(dividerColor),
                  _buildOptionItem('View Previous Profile Photo', () => _viewPreviousPhoto(context), textColor),
                  _buildDivider(dividerColor),
                  _buildOptionItem('Save Photo', () => _savePhoto(context), textColor),
                  const SizedBox(height: 8),
                  _buildCancelButton(l10n.cancel, textColor, cancelButtonColor),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildOptionItem(String text, VoidCallback onTap, Color textColor) {
    return InkWell(
      onTap: () {
        _toggleOptions(); // Close the options sheet
        onTap();
      },
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 16),
        alignment: Alignment.center,
        child: Text(
          text,
          style: TextStyle(
            color: textColor,
            fontSize: 16,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _buildDivider(Color dividerColor) {
    return Container(
      height: 0.5,
      color: dividerColor,
      margin: const EdgeInsets.symmetric(horizontal: 16),
    );
  }

  Widget _buildCancelButton(String cancelText, Color textColor, Color backgroundColor) {
    return InkWell(
      onTap: _toggleOptions,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 16),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: backgroundColor,
        ),
        alignment: Alignment.center,
        child: Text(
          cancelText,
          style: TextStyle(
            color: textColor,
            fontSize: 16,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }

  void _takePhoto(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final profileController = ControllerManager.profileController;
    try {
      await profileController.takePhoto();
    } catch (e) {
      Get.snackbar(
        l10n.error,
        l10n.unexpectedError(e.toString()),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.red.withValues(red: 255, green: 0, blue: 0, alpha: 0.8),
        colorText: Colors.white,
      );
    }
  }

  void _chooseFromAlbum(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final profileController = ControllerManager.profileController;
    try {
      await profileController.chooseFromAlbum();
    } catch (e) {
      Get.snackbar(
        l10n.error,
        l10n.unexpectedError(e.toString()),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.red.withValues(red: 255, green: 0, blue: 0, alpha: 0.8),
        colorText: Colors.white,
      );
    }
  }

  void _viewPreviousPhoto(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    // TODO: Implement view previous photo functionality
    Get.snackbar(
      l10n.comingSoonTitle,
      l10n.comingSoonMessage,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: Colors.grey.withValues(red: 128, green: 128, blue: 128, alpha: 0.8),
      colorText: Colors.white,
    );
  }

  void _savePhoto(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final profileController = ControllerManager.profileController;
    try {
      await profileController.saveCurrentImage();
      Get.snackbar(
        l10n.success,
        l10n.photosSyncedSuccessfully,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.green.withValues(red: 0, green: 128, blue: 0, alpha: 0.8),
        colorText: Colors.white,
      );
    } catch (e) {
      Get.snackbar(
        l10n.error,
        l10n.unexpectedError(e.toString()),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.red.withValues(red: 255, green: 0, blue: 0, alpha: 0.8),
        colorText: Colors.white,
      );
    }
  }
}