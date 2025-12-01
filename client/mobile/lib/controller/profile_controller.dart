import 'dart:io';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

class ProfileController extends GetxController {
  final RxBool isLoading = false.obs;
  final Rx<File?> profileImage = Rx<File?>(null);
  final RxBool hasProfileImage = false.obs;
  final RxInt imageVersion = 0.obs; // Add version counter for cache busting

  final ImagePicker _picker = ImagePicker();
  
  @override
  void onInit() {
    super.onInit();
    _loadProfileImage();
  }
  
  Future<void> _loadProfileImage() async {
    try {
      isLoading.value = true;
      
      final directory = await getApplicationDocumentsDirectory();
      final imagePath = '${directory.path}/profile_image.png';
      final imageFile = File(imagePath);
      
      final prefs = await SharedPreferences.getInstance();
      final hasImage = prefs.getBool('has_profile_image') ?? false;
      
      if (hasImage && await imageFile.exists()) {
        profileImage.value = imageFile;
        hasProfileImage.value = true;
        appLogger.info('Profile image loaded from local storage');
      } else {
        hasProfileImage.value = false;
        appLogger.info('No profile image found');
      }
    } catch (e) {
      appLogger.error('Error loading profile image: $e');
      hasProfileImage.value = false;
    } finally {
      isLoading.value = false;
    }
  }
  
  Future<void> _setProfileImage(File file) async {
    try {
      isLoading.value = true;
      appLogger.info('Setting profile image from file');
      
      final directory = await getApplicationDocumentsDirectory();
      final imagePath = '${directory.path}/profile_image.png';
      
      // Delete existing file first to ensure clean copy
      final existingFile = File(imagePath);
      if (await existingFile.exists()) {
        await existingFile.delete();
      }
      
      // Copy the picked image to our app directory
      final File newImage = await file.copy(imagePath);
      
      // Update state and increment version for cache busting
      profileImage.value = newImage;
      hasProfileImage.value = true;
      imageVersion.value++; // Increment to force UI refresh
      
      // Force evict the image from cache to ensure immediate refresh
      FileImage(newImage).evict();
      
      // Force UI update by triggering reactive variables
      profileImage.refresh();
      hasProfileImage.refresh();
      
      // Save preference
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('has_profile_image', true);
      
      appLogger.info('Profile image updated successfully');
    } catch (e) {
      appLogger.error('Error setting profile image: $e');
      rethrow;
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> takePhoto() async {
    try {
      isLoading.value = true;
      appLogger.info('Taking photo for profile image');
      
      final XFile? photo = await _picker.pickImage(source: ImageSource.camera);
      if (photo != null) {
        await _setProfileImage(File(photo.path));
      } else {
        appLogger.info('No photo taken');
      }
    } catch (e) {
      appLogger.error('Error taking photo: $e');
      Get.snackbar('Error', 'Failed to take photo: $e');
    } finally {
      isLoading.value = false;
    }
  }
  
  Future<void> chooseFromAlbum() async {
    try {
      isLoading.value = true;
      appLogger.info('Choosing image from album');
      
      final XFile? image = await _picker.pickImage(source: ImageSource.gallery);
      if (image != null) {
        await _setProfileImage(File(image.path));
      } else {
        appLogger.info('No image selected');
      }
    } catch (e) {
      appLogger.error('Error choosing from album: $e');
      Get.snackbar('Error', 'Failed to choose image: $e');
    } finally {
      isLoading.value = false;
    }
  }
  
  Future<void> saveCurrentImage() async {
    try {
      if (!hasProfileImage.value || profileImage.value == null) {
        throw Exception('No profile image to save');
      }
      
      appLogger.info('Current profile image is already saved');
      // The image is already saved when set, so we just confirm
      
    } catch (e) {
      appLogger.error('Error saving image: $e');
      rethrow;
    }
  }
}
