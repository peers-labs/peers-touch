// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Peers Touch';

  @override
  String get homePageTitle => 'Home Page';

  @override
  String get navHome => 'Home';

  @override
  String get navChat => 'Chat';

  @override
  String get navPhoto => 'Photo';

  @override
  String get navProfile => 'Profile';

  @override
  String get deviceInformation => 'Device Information';

  @override
  String get installationStatus => 'Installation Status';

  @override
  String get firstLaunch => 'First Launch';

  @override
  String get returningUser => 'Returning User';

  @override
  String get deviceId => 'Device ID (DID)';

  @override
  String get installationId => 'Installation ID';

  @override
  String get generatedAvatar => 'Generated Avatar';

  @override
  String get avatarDescription =>
      'This avatar is generated based on your device ID and will remain consistent across app sessions:';

  @override
  String get resetDeviceId => 'Reset Device ID (Testing)';

  @override
  String get resetDeviceIdTitle => 'Reset Device ID?';

  @override
  String get resetDeviceIdMessage =>
      'This will generate a new device ID and installation ID. This action is typically only used for testing purposes.';

  @override
  String get cancel => 'Cancel';

  @override
  String get reset => 'Reset';

  @override
  String get resetComplete => 'Reset Complete';

  @override
  String get resetCompleteMessage => 'Device ID has been reset and regenerated';

  @override
  String get copied => 'Copied';

  @override
  String get copiedMessage => 'Content copied to clipboard';

  @override
  String get copyToClipboard => 'Copy to clipboard';

  @override
  String get syncPhotos => 'Sync Photos';

  @override
  String get takePhoto => 'Take Photo';

  @override
  String get uploadPhoto => 'Upload Photo';

  @override
  String get selectProfilePicture => 'Select Profile Picture';

  @override
  String get chooseFromGallery => 'Choose from Gallery';

  @override
  String get selectFromPhotos => 'Select from your photos';

  @override
  String get chooseFromPosts => 'Choose from Posts';

  @override
  String get comingSoon => 'Coming soon...';

  @override
  String get comingSoonTitle => 'Coming Soon';

  @override
  String get comingSoonMessage =>
      'This feature will be available in future updates';

  @override
  String get ok => 'OK';

  @override
  String get selectPhoto => 'Select Photo';

  @override
  String get noPhotosFound => 'No photos found';

  @override
  String get success => 'Success';

  @override
  String get profilePictureUpdated => 'Profile picture updated successfully';

  @override
  String get error => 'Error';

  @override
  String get permissionDenied => 'Permission Denied';

  @override
  String get needPhotoAccess =>
      'Photo access is needed to select a profile image';

  @override
  String get needMediaAccess => 'Media access is needed to load albums';

  @override
  String get photosSyncedSuccessfully => 'Photos synced successfully';

  @override
  String get failedToSyncPhotos => 'Failed to sync photos';

  @override
  String unexpectedError(String error) {
    return 'An unexpected error occurred: $error';
  }

  @override
  String syncSelectedPhotos(int count) {
    return 'Sync Selected Photos ($count)';
  }

  @override
  String get userName => 'User Name';

  @override
  String get userBio => 'This is a sample user biography.';

  @override
  String get photoAlbums => 'Photo Albums';

  @override
  String get albumSync => 'Album Sync';

  @override
  String get albumSyncMessage =>
      'Select albums to sync with your account. Synced albums will be available across all your devices.';

  @override
  String get syncSelectedAlbums => 'Sync Selected Albums';

  @override
  String get selectAll => 'Select All';

  @override
  String get deselectAll => 'Deselect All';

  @override
  String get noAlbumsSelected => 'No Albums Selected';

  @override
  String get selectAtLeastOneAlbum =>
      'Please select at least one album to sync';

  @override
  String get albumsSyncedSuccessfully => 'Albums synced successfully';

  @override
  String get syncFailed => 'Sync Failed';

  @override
  String get syncFailedMessage =>
      'Upload failed. Check:\n• Network connection\n• Server availability\n• Photo permissions\n• Storage space';

  @override
  String get networkConnectionFailed => 'Network connection failed';

  @override
  String get requestTimedOut => 'Request timed out';

  @override
  String get invalidServerResponse => 'Invalid server response';

  @override
  String get photoAccessDenied => 'Photo access permission denied';

  @override
  String syncSelectedAlbumsCount(int count) {
    return 'Sync Selected Albums ($count)';
  }

  @override
  String get loading => 'Loading...';

  @override
  String get errorLoadingCount => 'Error loading count';

  @override
  String itemsCount(int count) {
    return '$count items';
  }

  @override
  String get newGroup => 'New Group';

  @override
  String get addContact => 'Add Contact';

  @override
  String get uploadingPhotos => 'Uploading Photos';

  @override
  String get uploadError => 'Upload Error';

  @override
  String get storageError => 'Storage Error';

  @override
  String get notEnoughStorageSpace =>
      'Not enough storage space on the device to load photos. Please free up at least 100MB of space and try again.';

  @override
  String get settings => 'Settings';

  @override
  String get myAccount => 'My Account';

  @override
  String get general => 'General';

  @override
  String get language => 'Language';

  @override
  String get selectLanguage => 'Select Language';

  @override
  String get startingUpload => 'Starting upload...';

  @override
  String get cancellingUpload => 'Cancelling upload...';

  @override
  String get uploadCompletedSuccessfully => 'Upload completed successfully!';

  @override
  String loadingPhotosFrom(String albumName) {
    return 'Loading photos from $albumName...';
  }

  @override
  String get friendName => 'Friend Name';

  @override
  String get samplePostContent => 'This is a sample post content...';

  @override
  String get increment => 'Increment';

  @override
  String get youHavePushedButton =>
      'You have pushed the button this many times:';

  @override
  String get navMe => 'Me';

  @override
  String get meProfile => 'Profile';

  @override
  String get profilePhoto => 'Profile Photo';

  @override
  String get name => 'Name';

  @override
  String get gender => 'Gender';

  @override
  String get region => 'Region';

  @override
  String get email => 'Email';

  @override
  String get peersId => 'Peers ID';

  @override
  String get myQrCode => 'My QR Code';

  @override
  String get shortBio => 'Short Bio';

  @override
  String get whatsUp => 'What\'s Up';

  @override
  String get male => 'Male';

  @override
  String get female => 'Female';

  @override
  String get preferNotToSay => 'Prefer not to say';

  @override
  String get littleFirst => 'Little First';

  @override
  String get update => 'Update';

  @override
  String get newLabel => 'New';

  @override
  String get current => 'Current';

  @override
  String characterCount(int count, int max) {
    return '$count/$max';
  }

  @override
  String get nameVisibilityHelper =>
      'Your name will be visible to other users when you connect with them.';

  @override
  String nameCannotBeEmpty(String field) {
    return '$field cannot be empty';
  }

  @override
  String nameMinLength(String field, int min) {
    return '$field must be at least $min characters';
  }

  @override
  String nameMaxLength(String field, int max) {
    return '$field cannot exceed $max characters';
  }

  @override
  String nameUpdatedSuccessfully(String field) {
    return '$field updated successfully';
  }

  @override
  String get contactsTitle => 'Contacts';

  @override
  String get searchContacts => 'Search contacts';

  @override
  String get noContactsFound => 'No contacts found';

  @override
  String get viewProfile => 'View Profile';

  @override
  String get editRemark => 'Edit Remark';

  @override
  String get enterRemark => 'Enter remark';

  @override
  String get save => 'Save';

  @override
  String get mute => 'Mute';

  @override
  String get unmute => 'Unmute';

  @override
  String get deleteFriend => 'Delete Friend';

  @override
  String get deleteFriendConfirmation =>
      'Are you sure you want to delete this contact? This action cannot be undone.';

  @override
  String get delete => 'Delete';

  @override
  String get online => 'Online';

  @override
  String lastSeen(String time) {
    return 'Last seen: $time';
  }

  @override
  String get justNow => 'Just now';

  @override
  String minutesAgo(int minutes) {
    return '$minutes minutes ago';
  }

  @override
  String hoursAgo(int hours) {
    return '$hours hours ago';
  }

  @override
  String daysAgo(int days) {
    return '$days days ago';
  }

  @override
  String get today => 'Today';

  @override
  String get yesterday => 'Yesterday';

  @override
  String get monday => 'Monday';

  @override
  String get tuesday => 'Tuesday';

  @override
  String get wednesday => 'Wednesday';

  @override
  String get thursday => 'Thursday';

  @override
  String get friday => 'Friday';

  @override
  String get saturday => 'Saturday';

  @override
  String get sunday => 'Sunday';

  @override
  String get noMessages => 'No messages yet';

  @override
  String get typeMessage => 'Type a message...';

  @override
  String get send => 'Send';

  @override
  String get copy => 'Copy';

  @override
  String get forward => 'Forward';

  @override
  String get deleteMessage => 'Delete Message';

  @override
  String get deleteMessageConfirmation =>
      'Are you sure you want to delete this message?';

  @override
  String get photo => 'Photo';

  @override
  String get file => 'File';

  @override
  String get location => 'Location';

  @override
  String get voice => 'Voice';

  @override
  String get video => 'Video';

  @override
  String get contact => 'Contact';

  @override
  String get allFriends => 'All Friends';

  @override
  String get conversations => 'Conversations';

  @override
  String get friends => 'Friends';

  @override
  String get onlineFriends => 'Online Friends';

  @override
  String get offlineFriends => 'Offline Friends';

  @override
  String get addFriend => 'Add Friend';

  @override
  String get sendMessage => 'Send Message';

  @override
  String get removeFriend => 'Remove Friend';

  @override
  String get blockFriend => 'Block Friend';

  @override
  String get emailValidationError => 'Please enter a valid email address';

  @override
  String get emailVisibilityHelper =>
      'Your email will be used for account recovery and important notifications.';

  @override
  String get emailVisibilityTitle => 'Email Visibility';

  @override
  String get allowEmailPublishing => 'Allow others to find me by email';

  @override
  String get emailPublishingHelper =>
      'When enabled, other users can find and connect with you using your email address.';

  @override
  String get peersIdUpdateTitle => 'Peers ID';

  @override
  String get peersIdReadOnlyMessage =>
      'Your Peers ID is automatically generated by the network and cannot be changed manually. This unique identifier helps other users find and connect with you on the Peers Touch network.';

  @override
  String get peersIdHelper =>
      'This ID is unique to your device and network connection. It remains consistent as long as you\'re connected to the same network.';

  @override
  String get shortBioUpdateTitle => 'Short Bio';

  @override
  String get shortBioHelper =>
      'Share a brief description about yourself. This will be visible to other users when they view your profile.';

  @override
  String get shortBioMaxLength => 'Short bio cannot exceed 30 characters';

  @override
  String get login => 'Login';

  @override
  String get register => 'Register';

  @override
  String get username => 'Username';

  @override
  String get password => 'Password';

  @override
  String get confirmPassword => 'Confirm Password';

  @override
  String get serverAddress => 'Server Address';

  @override
  String get serverAddressHint =>
      'Enter server root address (e.g., https://api.example.com)';

  @override
  String get usernameRequired => 'Username is required';

  @override
  String get passwordRequired => 'Password is required';

  @override
  String get serverAddressRequired => 'Server address is required';

  @override
  String get invalidServerAddress => 'Please enter a valid server address';

  @override
  String get passwordMismatch => 'Passwords do not match';

  @override
  String passwordMinLength(int min) {
    return 'Password must be at least $min characters';
  }

  @override
  String get loginSuccess => 'Login successful';

  @override
  String get registerSuccess => 'Registration successful';

  @override
  String get loginFailed => 'Login failed';

  @override
  String get registerFailed => 'Registration failed';

  @override
  String get switchToRegister => 'Don\'t have an account? Register';

  @override
  String get switchToLogin => 'Already have an account? Login';
}
