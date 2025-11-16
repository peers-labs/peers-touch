import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class FullscreenImageViewer extends StatefulWidget {
  final ImageProvider imageProvider;
  final String? heroTag;
  final VoidCallback? onEdit;

  const FullscreenImageViewer({
    super.key,
    required this.imageProvider,
    this.heroTag,
    this.onEdit,
  });

  @override
  State<FullscreenImageViewer> createState() => _FullscreenImageViewerState();
}

class _FullscreenImageViewerState extends State<FullscreenImageViewer> {
  @override
  void initState() {
    super.initState();

    // Hide status bar for fullscreen experience
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersive);
  }

  @override
  void dispose() {
    // Restore status bar
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  void _closeViewer() {
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        onTap: _closeViewer,
        child: Stack(
          children: [
            // Background blurred image
            Positioned.fill(
              child: Image(image: widget.imageProvider, fit: BoxFit.cover),
            ),

            // Blur overlay for top area
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: MediaQuery.of(context).size.height * 0.15,
              child: ClipRect(
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.black.withValues(alpha: 0.6),
                          Colors.black.withValues(alpha: 0.3),
                          Colors.transparent,
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),

            // Blur overlay for bottom area
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              height: MediaQuery.of(context).size.height * 0.15,
              child: ClipRect(
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.bottomCenter,
                        end: Alignment.topCenter,
                        colors: [
                          Colors.black.withValues(alpha: 0.6),
                          Colors.black.withValues(alpha: 0.3),
                          Colors.transparent,
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),

            // Center image with Hero animation and rounded bottom border
            Positioned.fill(
              child: Container(
                margin: const EdgeInsets.only(bottom: 60),
                child: ClipRRect(
                  borderRadius: const BorderRadius.only(
                    bottomLeft: Radius.circular(20),
                    bottomRight: Radius.circular(20),
                  ),
                  child:
                      widget.heroTag != null
                          ? Hero(
                            tag: widget.heroTag!,
                            child: Image(
                              image: widget.imageProvider,
                              fit: BoxFit.cover,
                              width: double.infinity,
                              height: double.infinity,
                            ),
                          )
                          : Image(
                            image: widget.imageProvider,
                            fit: BoxFit.cover,
                            width: double.infinity,
                            height: double.infinity,
                          ),
                ),
              ),
            ),

            // Close button
            Positioned(
              top: MediaQuery.of(context).padding.top + 16,
              right: 16,
              child: GestureDetector(
                onTap: _closeViewer,
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.5),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.close, color: Colors.white, size: 24),
                ),
              ),
            ),

            // Edit button (only shown when onEdit callback is provided)
            if (widget.onEdit != null)
              Positioned(
                bottom: MediaQuery.of(context).size.height * 0.15 + 10,
                right: 20,
                child: FloatingActionButton(
                  mini: true,
                  heroTag: "fullscreen_edit_button",
                  backgroundColor: Colors.white,
                  foregroundColor: Colors.black,
                  onPressed: () {
                    _closeViewer();
                    widget.onEdit!();
                  },
                  child: const Icon(Icons.edit, size: 20),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class FullscreenImageViewerHelper {
  static void show(
    BuildContext context,
    ImageProvider imageProvider, {
    String? heroTag,
    VoidCallback? onEdit,
  }) {
    Navigator.of(context).push(
      PageRouteBuilder(
        opaque: false,
        barrierColor: Colors.black54,
        pageBuilder: (context, animation, secondaryAnimation) {
          return FullscreenImageViewer(
            imageProvider: imageProvider,
            heroTag: heroTag,
            onEdit: onEdit,
          );
        },
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          return FadeTransition(opacity: animation, child: child);
        },
        transitionDuration: const Duration(milliseconds: 100),
        reverseTransitionDuration: const Duration(milliseconds: 100),
      ),
    );
  }
}
