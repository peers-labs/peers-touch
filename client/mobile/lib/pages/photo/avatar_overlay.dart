import 'package:flutter/material.dart';
import 'package:jdenticon_dart/jdenticon_dart.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/controller.dart';

class AvatarOverlay extends StatelessWidget {
  const AvatarOverlay({super.key});

  @override
  Widget build(BuildContext context) {
    // Remove the outer Positioned widget here
    return LayoutBuilder(
      builder: (context, constraints) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            // Avatar positioned at top right
             Row(
               mainAxisAlignment: MainAxisAlignment.end,
               crossAxisAlignment: CrossAxisAlignment.end,
               children: [
                 Transform.translate(
                   offset: const Offset(0, 3), // Lower by 3 units vertically
                   child: Container(
                     width: 64,
                     height: 64,
                     decoration: BoxDecoration(
                       color: Colors.white,
                       borderRadius: BorderRadius.circular(8),
                     ),
                     child: ClipRRect(
                       borderRadius: BorderRadius.circular(8),
                       child: Obx(() {
                         final deviceIdController = ControllerManager.deviceIdController;
                         final identiconInput = deviceIdController.getIdenticonInput();
                         
                         return SvgPicture.string(
                           Jdenticon.toSvg(identiconInput), // Uses device ID for consistent avatar
                           height: 64,
                           width: 64,
                           fit: BoxFit.cover,
                         );
                       }),
                     ),
                   ),
                 ),
               ],
             ),
            const SizedBox(height: 14),
            // Bio text positioned below the header
            Padding(
              padding: const EdgeInsets.only(right: 0),
              child: Text(
                _processBioText(
                  'User Bio Ha Ha hah hasd hello hello hello hello hello, hi hi hi hi hi hi hi hi hi ',
                ),
                style: TextStyle(
                  color: Colors.black,
                  fontSize: 12,
                  height: 1,
                  shadows: [
                    Shadow(
                      color: Colors.black.withValues(alpha: 0.5),
                      blurRadius: 4,
                    ),
                  ],
                ),
                softWrap: true, // Allow text wrapping
                overflow: TextOverflow.visible, // Allow text overflow
                maxLines: 2, // Set maxLines to allow multiple lines
                textAlign: TextAlign.right,
              ),
            ),
          ],
        );
       },
     );
  }

  // Helper to add line break after 8th word
  String _processBioText(String bio) {
    final words = bio.split(' ');
    if (words.length > 8) {
      return '${words.sublist(0, 8).join(' ')}\n${words.sublist(8).join(' ')}';
    }
    return bio;
  }
}
