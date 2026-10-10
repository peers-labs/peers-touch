#import <UIKit/UIKit.h>

#include "bindings/bindings.h"

@interface PeersOrientationCoordinator : NSObject
+ (void)install;
@end

@implementation PeersOrientationCoordinator

+ (void)install {
	dispatch_async(dispatch_get_main_queue(), ^{
		static PeersOrientationCoordinator *coordinator = nil;
		coordinator = [[PeersOrientationCoordinator alloc] init];
		[[UIDevice currentDevice] beginGeneratingDeviceOrientationNotifications];
		[[NSNotificationCenter defaultCenter]
			addObserver:coordinator
			selector:@selector(deviceOrientationDidChange:)
			name:UIDeviceOrientationDidChangeNotification
			object:nil];
		[coordinator applyCurrentOrientation];
	});
}

- (void)deviceOrientationDidChange:(NSNotification *)notification {
	[self applyCurrentOrientation];
}

- (void)applyCurrentOrientation {
	UIInterfaceOrientationMask mask;
	switch ([UIDevice currentDevice].orientation) {
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

int main(int argc, char * argv[]) {
	[PeersOrientationCoordinator install];
	ffi::start_app();
	return 0;
}
