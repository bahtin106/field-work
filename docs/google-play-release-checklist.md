# Google Play release checklist

## Data Safety declaration

Use the production behavior of version 1.0.3 when completing Play Console. The app processes:

- Account and personal information: name, email, phone number, profile photo, role and company membership.
- User content: orders, comments, client/object information and uploaded photos.
- Location-related content: addresses and coordinates entered for clients, objects and orders.
- Financial information: order income, expense, discount and payment-status records. The app does not store full bank-card numbers.
- App activity and diagnostics: authenticated error reports, app version, platform and technical context.
- Device identifiers: push-notification token and platform information.

Primary purposes are app functionality, account management, communication/notifications, security, diagnostics and customer support. Data is transferred over encrypted connections. Service providers used to operate the product must be reflected in the declaration and privacy policy.

Public privacy policy: https://monitorapp.ru/privacy

Account/data deletion: https://monitorapp.ru/data-deletion

Support contact: support@monitorapp.ru

## Required pre-rollout checks

- Apply all Supabase migrations, including the `error_logs` RLS and retention migration.
- Confirm the Data Safety form matches the production SDKs and server-side processing.
- Upload the AAB only after `npm run release:check` passes.
- Test login/logout with two accounts on the same device; confirm no pending finance or photo operation appears in the other account.
- Test photo upload with Wi-Fi disabled, app backgrounded, app removed from Android recents, network restored and app reopened.
- Test photo deletion and finance create/update/delete under interrupted connectivity.
- Test account-deletion and privacy links from Application Settings while authenticated as both company and solo accounts.
- Start with an internal/closed track, then a staged production rollout while watching authenticated error logs.
