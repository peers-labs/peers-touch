import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:jdenticon_dart/jdenticon_dart.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/controller/profile_controller.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:peers_touch_mobile/pages/me/avatar_change_page.dart';
import 'package:peers_touch_mobile/pages/me/me_email_update_page.dart';
import 'package:peers_touch_mobile/pages/me/me_gender_update_page.dart';
import 'package:peers_touch_mobile/pages/me/me_name_update_page.dart';
import 'package:peers_touch_mobile/pages/me/me_peersid_update_page.dart';
import 'package:peers_touch_mobile/pages/me/me_short_bio_update_page.dart';

class MeProfilePage extends StatelessWidget {
  MeProfilePage({super.key});

  // Get the ProfileController instance
  final profileController = Get.find<ProfileController>();

  // Get the MeController instance for user data
  final meController = ControllerManager.meController;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      backgroundColor: colorScheme.surface ,
      appBar: AppBar(
        backgroundColor: colorScheme.surface ,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        shadowColor: Colors.transparent,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios, color: colorScheme.onSurface, size: 20),
          onPressed: () => Get.back(),
        ),
        title: Text(
          l10n.meProfile,
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

              // Profile Fields with Profile Photo as first item
              _buildProfileFields(context, l10n),
            ],
          ),
        ),
      ),
    );
  }

  void _navigateToAvatarChange(BuildContext context) {
    Get.to(() => const AvatarChangePage());
  }

  Widget _buildProfileFields(BuildContext context, AppLocalizations l10n) {
    return Column(
      children: [
        // Profile Photo as first item - using consistent styling
        _buildProfileField(
          context,
          l10n.profilePhoto,
          '',
          Icons.account_circle_outlined,
          showAvatar: true,
        ),
        _buildDivider(context),
        Obx(
          () => _buildProfileField(
            context,
            l10n.name,
            meController.userName.value,
            Icons.person_outline,
          ),
        ),
        _buildDivider(context),
        Obx(
          () => _buildProfileField(
            context,
            l10n.gender,
            meController.gender.value,
            Icons.wc_outlined,
          ),
        ),
        _buildDivider(context),
        Obx(
          () => _buildProfileField(
            context,
            l10n.region,
            meController.region.value,
            Icons.location_on_outlined,
          ),
        ),
        _buildDivider(context),
        Obx(
          () => _buildProfileField(
            context,
            l10n.email,
            meController.email.value,
            Icons.email_outlined,
          ),
        ),
        _buildDivider(context),
        Obx(
          () => _buildProfileField(
            context,
            l10n.peersId,
            meController.peersId.value,
            Icons.fingerprint_outlined,
          ),
        ),
        _buildDivider(context),
        _buildProfileField(
          context,
          l10n.myQrCode,
          '',
          Icons.qr_code_outlined,
          showTrailing: true,
        ),
        _buildDivider(context),
        Obx(
          () => _buildProfileField(
            context,
            l10n.shortBio,
            meController.whatsUp.value,
            Icons.edit_outlined,
            isMultiline: true,
          ),
        ),
      ],
    );
  }

  Widget _buildProfileField(
    BuildContext context,
    String label,
    String value,
    IconData icon, {
    bool showTrailing = true, // Default to showing trailing chevron
    bool isMultiline = false,
    bool showAvatar = false,
  }) {
    // Determine if this is a field that needs special handling for long text
    final bool isLongTextField = label == AppLocalizations.of(context)!.region || 
                               label == AppLocalizations.of(context)!.email || 
                               label == AppLocalizations.of(context)!.shortBio;
    
    // Create the trailing widget with proper tap handling
    Widget trailingWidget = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Value on the right
        if (showAvatar)
          GestureDetector(
            onTap: () => _navigateToAvatarChange(context),
            child: CircleAvatar(
              radius: 20,
              backgroundColor: Colors.transparent,
              child: CircleAvatar(
                radius: 18,
                child: Obx(() {
                  // Check if profile image exists first
                  if (profileController.hasProfileImage.value &&
                      profileController.profileImage.value != null) {
                    return ClipOval(
                      child: Image.file(
                        profileController.profileImage.value!,
                        height: 36,
                        width: 36,
                        fit: BoxFit.cover,
                      ),
                    );
                  } else {
                    // Fallback to identicon
                    final deviceIdController =
                        ControllerManager.deviceIdController;
                    final identiconInput =
                        deviceIdController.getIdenticonInput();

                    return ClipOval(
                      child: SvgPicture.string(
                        Jdenticon.toSvg(identiconInput),
                        height: 36,
                        width: 36,
                        fit: BoxFit.cover,
                      ),
                    );
                  }
                }),
              ),
            ),
          )
        else if (value.isNotEmpty)
          Container(
            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.5),
            child: Text(
              value,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7),
                fontSize: 16,
                fontWeight: FontWeight.w400,
              ),
              textAlign: TextAlign.right,
              maxLines: isLongTextField ? (isMultiline ? 4 : 2) : 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          
        // Chevron icon
        if (showTrailing)
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Icon(
              Icons.chevron_right,
              color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.54),
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
          color: Theme.of(context).colorScheme.onSurface,
          fontSize: 16,
          fontWeight: FontWeight.w400,
        ),
      ),
      trailing: trailingWidget,
      onTap: showTrailing ? () {
        // Handle navigation based on field type
        if (label == AppLocalizations.of(context)!.profilePhoto) {
          _navigateToAvatarChange(context);
        } else if (label == AppLocalizations.of(context)!.name) {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => NameUpdatePage(),
            ),
          );
        } else if (label == AppLocalizations.of(context)!.gender) {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => GenderUpdatePage(),
            ),
          );
        } else if (label == AppLocalizations.of(context)!.email) {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => EmailUpdatePage(),
            ),
          );
        } else if (label == AppLocalizations.of(context)!.peersId) {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => PeersIdUpdatePage(),
            ),
          );
        } else if (label == AppLocalizations.of(context)!.myQrCode) {
          // Navigate to QR code page
          // TODO: Implement QR code navigation
        } else if (label == AppLocalizations.of(context)!.shortBio) {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => ShortBioUpdatePage(),
            ),
          );
        } else {
          // Navigate to edit page for this field
          // TODO: Implement field editing navigation
        }
      } : null,
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
