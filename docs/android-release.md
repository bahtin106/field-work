# Android release bundle

Google Play accepts updates for `com.monitorapp.monitor` only when the AAB is
signed with the registered upload certificate:

`SHA1 4E:69:4F:24:AA:19:F3:3B:B5:C3:74:10:7D:27:ED:5B:D2:6D:71:17`

## Local production build

1. Run `eas credentials -p android`.
2. Select the `production` profile.
3. Select `credentials.json: Upload/Download credentials between EAS servers and your local json`.
4. Select `Download credentials from EAS to credentials.json`.
5. Run `npm run build:android:aab`.

The credentials file and keystore are ignored by git. The build command checks
the keystore before Gradle starts, checks the finished AAB again, and refuses to
publish a bundle with any other certificate. A verified copy is written to
`releases/Monitor-<version>-vc<versionCode>-play.aab`.

Never create a new keystore for an existing Play application and never upload
local credentials back to EAS unless a deliberate key rotation is in progress.
