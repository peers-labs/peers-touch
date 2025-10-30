import 'package:get/get.dart';

class MeController extends GetxController {
  // Observable variables for user information
  final userName = 'Little First'.obs;
  final peersId = 'peersId'.obs;
  final gender = 'Male'.obs;
  final region = 'Shenzhen, Guangdong'.obs;
  final email = 'user@example.com'.obs;
  final whatsUp = '让大家多多自由以仁，带领社会共同富裕。1000'.obs;
  final phone = '181*******80'.obs;
  
  // Navigation methods
  void navigateToProfile() {
    Get.toNamed('/me/profile');
  }
  
  void navigateToSettings() {
    // Navigation logic to settings page
  }
  
  // Method to update user information
  void updateUserInfo({
    String? name,
    String? peersId,
    String? gender,
    String? region,
    String? email,
    String? whatsUp,
    String? phone,
  }) {
    if (name != null) userName.value = name;
    if (peersId != null) this.peersId.value = peersId;
    if (gender != null) this.gender.value = gender;
    if (region != null) this.region.value = region;
    if (email != null) this.email.value = email;
    if (whatsUp != null) this.whatsUp.value = whatsUp;
    if (phone != null) this.phone.value = phone;
  }
  
  // Method to update user name specifically
  Future<void> updateUserName(String newName) async {
    try {
      // TODO: Add API call to update name on server
      // For now, just update locally
      userName.value = newName;
      
      // Here you would typically make an API call to update the name on the server
      // await apiService.updateUserName(newName);
      
    } catch (e) {
      // Re-throw the error to be handled by the UI
      rethrow;
    }
  }
  
  // Method to update user email specifically
  Future<void> updateUserEmail(String newEmail) async {
    try {
      // TODO: Add API call to update email on server
      // For now, just update locally
      email.value = newEmail;
      
      // Here you would typically make an API call to update the email on the server
      // await apiService.updateUserEmail(newEmail);
      
    } catch (e) {
      // Re-throw the error to be handled by the UI
      rethrow;
    }
  }
}