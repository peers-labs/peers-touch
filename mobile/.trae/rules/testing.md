# Testing Rules

## Web Testing Restriction

**NEVER use web to test this program**

This Flutter mobile application should be tested using:
- Physical Android/iOS devices
- Android/iOS simulators/emulators
- Flutter's built-in testing framework

Web testing is not suitable for this mobile application and should be avoided to ensure accurate testing of mobile-specific features and behaviors.

## Preferred Testing Methods

1. **Device Testing**: Use `flutter run -d <device_id>` for physical devices
2. **Simulator Testing**: Use iOS Simulator or Android Emulator
3. **Unit Testing**: Use `flutter test` for unit and widget tests
4. **Integration Testing**: Use `flutter drive` for integration tests

## Notes

- Web testing may not accurately reflect mobile UI/UX behavior
- Mobile-specific features (camera, sensors, etc.) cannot be properly tested on web
- Performance characteristics differ significantly between web and mobile platforms