# iOS 1.1.1 release checklist

This is the release gate for the first App Store build of `com.monitorapp.monitor`. Do not submit a build until every mandatory item below has evidence attached to the release record.

## Build identity and reproducibility

- App version: `1.1.1`; first iOS build number: `1`.
- Increment `expo.ios.buildNumber` for every later TestFlight/App Store upload. The release validator accepts any positive integer but cannot verify App Store monotonicity.
- Production EAS Update channel and runtime version must both be `1.1.1`.
- Build from a clean, pushed commit with the `production` EAS profile. Never submit an old Android AAB or an iOS archive built from a different commit.
- Use the current SDK 54 EAS image with Xcode 26/iOS 26 SDK. Inspect the generated archive/IPA before submission.

Required automated gate:

```text
npm ci
npm run release:check
npx expo install --check
npx expo export --platform ios --output-dir dist-ci-ios
npx expo export --platform android --output-dir dist-ci-android
```

Cloud build after the final release commit:

```text
npx eas-cli build --platform ios --profile production
```

## App Store business model

The first iOS release is a free companion client for the web-based field-service account. The iOS binary must contain no purchase flow, external billing link, price, or call to action to buy/renew outside Apple. The subscription screen may display access status only. If consumer purchasing is later added to iOS, implement StoreKit/IAP before restoring any purchase CTA.

Suggested App Review note:

> Monitor is a free companion app for a web-based field-service account. Users may create or access an account. A newly registered solo account receives free, non-renewing 14-day access; it is not an auto-renewable subscription and no payment is collected in the iOS app. The iOS app contains no in-app purchase, price, buy or renew action, external billing link, or other call to action for purchase outside the app. The subscription page displays access status only. Cash and cashless fields in work requests only record payment for physical on-site field services consumed outside the app under Guideline 3.1.3(e); they do not sell digital content or services. A fully featured review account is provided below. Account deletion is available in Settings → Documents and data → Delete account and data and creates an authenticated whole-account deletion request directly in the app.

Provide a stable, fully featured review account and exact navigation instructions. Do not put credentials in Git.

## Account deletion gate

- Deploy `20260821220000_add_account_deletion_requests.sql` before distributing the build.
- Execute the disposable-account test in `docs/account-deletion-runbook.md`.
- Verify one authoritative queue row, one internal notification, the correct owner/employee deletion path, inability to sign in after completion and delivery of the completion email.
- Confirm the public privacy/deletion pages accurately describe the same process and retention period.

## Backend compatibility gate

The `1.1.1` client is compatible with the currently deployed Edge handlers. Do not perform a blanket `supabase functions deploy` for this release:

- deploy `admin-delete-company` before the account-deletion migration so both company- and user-scoped cleanup loops preserve the authoritative privacy queue;
- deploy `push-send` only in the same controlled window as an atomic `PUSH_WORKER_KEY` rotation and worker/runtime canary;
- install the tracked worker templates using the ownership, mode, rotation, canary and rollback procedure in `docs/push-worker-runbook.md`;
- canary Android delivery on both a legacy/unopened-upgrade client (safe missing-channel fallback) and `1.1.1` (`app-notify-private-v2` with PRIVATE lock-screen visibility);
- keep the hardened `media-thumbnail` handler staged until Android versions that fetch thumbnails without an `Authorization` header are retired;
- keep the hardened `request-password-reset` handler staged until legacy Android clients and the production web recovery UI support the OTP completion step;
- deploy media-upload handlers only after authenticated owner/admin/negative-role canaries against production-compatible test records.

Publishing the `1.1.1` binary must precede retiring either legacy Edge contract. Record active app-version counts and the web rollout evidence before removing compatibility.

## Privacy inventory for App Store Connect

The Account Holder/App Manager must verify this inventory against the production privacy policy and the archive privacy report, then publish the matching App Privacy answers. The app does not use advertising/tracking SDKs and `NSPrivacyTracking` is false.

Use `docs/app-privacy-inventory-1.1.1.md` as the one-to-one source for `PrivacyInfo.xcprivacy` and App Store Connect. Any product/data-flow change must update all three together.

Expected data families to review and declare where applicable:

- Contact information: name, email address, phone number and user-entered customer/worksite contact details.
- User content: request descriptions/comments, support messages, photos and uploaded files.
- Identifiers: account/user ID, company ID and push notification token/device identifier.
- Purchases/financial information: subscription entitlement, company finance entries, prices, expenses and payment-state records; card credentials are not collected by the mobile app.
- Usage data: account activity/last-seen and feature interaction needed for app operation and support.
- Diagnostics: crash/error details and limited technical context, with client-side secret/PII redaction.
- Contacts: only the single contact explicitly selected in the system picker; the full iOS address book is not requested or uploaded.
- Keep a localized `NSContactsUsageDescription` in every binary: Apple static analysis requires it because `expo-contacts` links protected Contacts APIs, even though the current iOS runtime uses the permission-free single-contact picker and never requests full address-book access.

For each declared type, verify: linked-to-user status, app-functionality/developer-communication purpose, retention and deletion. Do not declare tracking, advertising or data-broker use unless the product changes. Set the required privacy policy URL to `https://monitorapp.ru/privacy` and keep App Store Connect, `PrivacyInfo.xcprivacy` and the public policy consistent.

## Device/TestFlight matrix

- Fresh install, upgrade and cold start on current iOS plus the oldest supported version/device available.
- Publish a deliberately broken update to a disposable preview channel and verify that an early startup crash rolls back to the embedded update; never perform this test on the production channel.
- Login, registration, OTP password recovery and account deletion.
- Denied camera, denied photo-add, limited/no network, EDGE/high latency, airplane mode, offline launch and offline→online sync.
- Create/edit/view requests, comments, both payment-method configurations, finance recalculation and media upload/download.
- APNs registration/rotation, foreground/background/cold-start notification routing and lock-screen privacy.
- Yandex OAuth return, camera capture, system photo picker and permission-free single-contact picker.
- Background sync on a physical device; iOS background execution is not validated by Simulator alone.
- Large text, VoiceOver, dark mode, portrait and landscape because the app currently advertises all orientations.
- Account switching: no previous user's cached data or protected thumbnail may appear.

## App Store Connect metadata

- Complete localized name, subtitle, description, keywords, support URL and privacy URL.
- Upload current required iPhone screenshots with no test data or secrets.
- Complete age rating, content rights, export compliance and availability.
- Add TestFlight test information, support contact and detailed Review Notes.
- Verify the backend, review account, email OTP and push services remain available throughout review.
- Review the uploaded build's privacy report and any Apple required-reason warning before selecting it for submission.

Primary references: Apple App Review Guidelines, Apple account-deletion guidance, Apple App Privacy help, Apple export-compliance help and Expo privacy-manifest/EAS Update documentation.
