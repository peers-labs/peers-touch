#import <UIKit/UIKit.h>

#include "bindings/bindings.h"

@interface PeersOrientationCoordinator : NSObject
+ (void)install;
@end

@implementation PeersOrientationCoordinator

static PeersOrientationCoordinator *peersOrientationCoordinator = nil;

+ (void)install {
	dispatch_async(dispatch_get_main_queue(), ^{
		peersOrientationCoordinator =
			[[PeersOrientationCoordinator alloc] init];
		[[UIDevice currentDevice] beginGeneratingDeviceOrientationNotifications];
		[[NSNotificationCenter defaultCenter]
			addObserver:peersOrientationCoordinator
			selector:@selector(deviceOrientationDidChange:)
			name:UIDeviceOrientationDidChangeNotification
			object:nil];
		[peersOrientationCoordinator applyCurrentOrientation];
	});
}

- (void)deviceOrientationDidChange:(NSNotification *)notification {
	[self applyCurrentOrientation];
}

- (void)applyCurrentOrientation {
	UIDeviceOrientation orientation = [UIDevice currentDevice].orientation;
	UIInterfaceOrientationMask mask;
	switch (orientation) {
		case UIDeviceOrientationPortrait:
			mask = UIInterfaceOrientationMaskPortrait;
			break;
		case UIDeviceOrientationLandscapeLeft:
			mask = UIInterfaceOrientationMaskLandscapeRight;
			break;
		case UIDeviceOrientationLandscapeRight:
			mask = UIInterfaceOrientationMaskLandscapeLeft;
			break;
		default:
			return;
	}
	[self applyInterfaceOrientationMask:mask];
}

- (void)applyInterfaceOrientationMask:(UIInterfaceOrientationMask)mask {
	for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
		if (![scene isKindOfClass:[UIWindowScene class]]) {
			continue;
		}

		UIWindowScene *windowScene = (UIWindowScene *)scene;
		if (@available(iOS 16.0, *)) {
			for (UIWindow *window in windowScene.windows) {
				if (window.rootViewController != nil) {
					[window.rootViewController
						setNeedsUpdateOfSupportedInterfaceOrientations];
				}
			}
			UIWindowSceneGeometryPreferencesIOS *preferences =
				[[UIWindowSceneGeometryPreferencesIOS alloc]
					initWithInterfaceOrientations:mask];
			[windowScene
				requestGeometryUpdateWithPreferences:preferences
				errorHandler:^(NSError *error) {
					NSLog(@"Peers orientation update failed: %@", error);
				}];
		} else {
			[UIViewController attemptRotationToDeviceOrientation];
		}
	}
}

@end

extern "C" bool peers_acceptance_request_interface_orientation(
	uint32_t orientation
) {
	UIInterfaceOrientationMask mask;
	switch (orientation) {
		case 1:
			mask = UIInterfaceOrientationMaskPortrait;
			break;
		case 2:
			mask = UIInterfaceOrientationMaskLandscapeRight;
			break;
		default:
			return false;
	}

	dispatch_async(dispatch_get_main_queue(), ^{
		if (peersOrientationCoordinator == nil) {
			peersOrientationCoordinator =
				[[PeersOrientationCoordinator alloc] init];
		}
		[peersOrientationCoordinator applyInterfaceOrientationMask:mask];
	});
	return true;
}

int main(int argc, char * argv[]) {
	[PeersOrientationCoordinator install];
	ffi::start_app();
	return 0;
}
