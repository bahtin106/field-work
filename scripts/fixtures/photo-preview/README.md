# Native photo regression

This uses the real `OrderPhotosModal`, `PhotoGrid`, `CachedImage`, and native
`expo-image` on Android. Only the session provider and runtime API origin are
replaced in this separate Metro server. It never uses a real account or backend.
The application entry and production Metro configuration remain unchanged.

1. Start an Android emulator with Expo Go for SDK 57 installed.
2. Run `node scripts/test-photo-preview-native.cjs` from the repository root.
3. Run `adb reverse tcp:8087 tcp:8087`.
4. Open `exp://127.0.0.1:8087` in Expo Go, or run
   `adb shell am start -W -a android.intent.action.VIEW -d exp://127.0.0.1:8087 host.exp.exponent`.
5. Wait for `PASS` in the server output. Results are also at
   `http://127.0.0.1:8087/results`. Use a fresh server and app launch for each run.

The server verifies a transient HTTP failure recovers with exactly two requests,
a missing file and expired URL recover through a third source, a late fallback
recovers a failed view, an unrecoverable URL terminates retries, and a delayed
session header is attached after changing sources.

**Also verify the screen.** All four modal tiles must show the blue check-mark
fixture. `onLoad` and even `onDisplay` alone do not prove an image is visible:
the Android modal regression emitted both while its authenticated tile stayed
gray. Close/reopen the modal and use `TOGGLE ALL PROTECTED PHOTOS` to check four
distinct authenticated URLs. The third small control above the modal is
intentionally an error icon; it tests exhausted retries.

For employee profile previews, close the photo grid and select `EMPLOYEE AVATAR`
then `View photo`. This exercises an internal `yadisk://` identifier resolved to
an HTTP image and waits for the action sheet's dismissal before opening the
preview. Repeat with `LOCAL AVATAR` to verify an unsaved local image wins over
the saved URL. Both previews must remain visible after closing and reopening.

The same entry can be loaded in an Android debug build using Metro at port 8087.
The debug-only network-security resource permits the local fixture server;
release builds retain HTTPS-only configuration.
