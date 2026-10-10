#import <UIKit/UIKit.h>
#import <TargetConditionals.h>

#include "bindings/bindings.h"

@interface PeersOrientationCoordinator : NSObject {
	UIDeviceOrientation _lastRequestedOrientation;
}
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
#if TARGET_OS_SIMULATOR
		[NSTimer
			scheduledTimerWithTimeInterval:0.25
			target:coordinator
			selector:@selector(simulatorOrientationTick:)
			userInfo:nil
			repeats:YES];
#endif
		[coordinator applyCurrentOrientation];
	});
}

- (void)deviceOrientationDidChange:(NSNotification *)notification {
	[self applyCurrentOrientation];
}

- (void)simulatorOrientationTick:(NSTimer *)timer {
	[self applyCurrentOrientation];
}

- (void)applyCurrentOrientation {
	UIDeviceOrientation orientation = [UIDevice currentDevice].orientation;
	if (orientation == _lastRequestedOrientation) {
		return;
	}

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

	for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
		if (![scene isKindOfClass:[UIWindowScene class]]) {
			continue;
		}

		UIWindowScene *windowScene = (UIWindowScene *)scene;
		if (@available(iOS 16.0, *)) {
			_lastRequestedOrientation = orientation;
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
					self->_lastRequestedOrientation =
						UIDeviceOrientationUnknown;
					NSLog(@"Peers orientation update failed: %@", error);
				}];
		} else {
			_lastRequestedOrientation = orientation;
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
