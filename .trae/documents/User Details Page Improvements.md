I have completed the tasks to improve the user details page.

**1. Modify Avatar/Header & Explain Distinction**

* **Difference**:

  * **Icon (Avatar)**: The small circular image representing the user in feeds and comments (like a profile picture).

  * **Header**: The large background banner image displayed at the top of the profile page (like a cover photo).

* **Implementation**:

  * Created `EditProfileDialog` which allows clicking on the avatar or header area to upload new images.

  * Implemented `uploadImage` in `ProfileController` to handle the upload to the server.

**2. Modify Details (Edit Profile)**

* **Implementation**:

  * Created `EditProfileDialog` (`client/desktop/lib/features/profile/view/edit_profile_dialog.dart`).

  * It allows editing **Display Name**, **Bio (Summary)**, **Region**, and **Timezone**.

  * It combines data from `touch_actor` (DisplayName, Summary, Avatar, Header) and `touch_actor_profile` (Region, Timezone).

  * Added `updateProfile` method in `ProfileController` to send changes to the backend.

**3. Display Information**

* **Implementation**:

  * Updated `ProfilePage` (`client/desktop/lib/features/profile/view/profile_page.dart`) to display the **Header Image** at the top of the profile card.

  * The page already displays Region, Timezone, and other extended info if available.

**4. Real Data Display**

* **Verification**: The backend logic (`GetWebProfile`) already calculates `StatusesCount`, `FollowingCount`, and `FollowersCount` from the database. The frontend `ProfilePage` is wired to display these values. If they are 0, it means the database has 0 records for them.

**5. Move Logout Button**

* **Implementation**:

  * Removed the "Account" section with the Logout button from `ProfilePage`.

  * Added the "Logout" button to the **Personal Settings** section in `ProfileModule` (`client/desktop/lib/features/profile/profile_module.dart`), which appears in the Settings page as requested.

**Files Modified/Created:**

* `client/desktop/lib/features/profile/view/profile_page.dart` (UI updates)

* `client/desktop/lib/features/profile/profile_module.dart` (Settings update)

* `client/desktop/lib/features/profile/controller/profile_controller.dart` (Logic update)

* `client/desktop/lib/features/profile/view/edit_profile_dialog.dart` (New file)

