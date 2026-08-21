# App privacy inventory 1.1.1

This is the audited source of truth for the app-level `PrivacyInfo.xcprivacy` declarations and the matching App Store Connect App Privacy answers. Every listed type is linked to the account or company, is used only for app functionality, and is not used for tracking, advertising, or data-broker purposes.

| Apple collected data type | Product data covered |
| --- | --- |
| Name | User, employee, client and support names |
| Email Address | Authentication, account, client and support email addresses |
| Phone Number | User-entered employee/client phone numbers and the single contact explicitly selected with the system picker |
| Physical Address | Customer and worksite/object addresses |
| Other User Contact Info | Optional support/contact handles entered by a user |
| Other Financial Info | Request prices, expenses, company finance entries and payment-state records; no full card or bank credentials |
| Photos or Videos | Profile, request, object, finance and support images/files selected by a user |
| Customer Support | Support requests and account-deletion operational messages |
| Other User Content | Requests, comments, files, company configuration and other user-entered work data |
| User ID | Account, company and tenant-scoping identifiers |
| Device ID | Push token/device identifier used to deliver notifications |
| Purchase History | Subscription entitlement, paid period and billing status obtained from the service backend |
| Product Interaction | Last-seen, audit/activity events and feature interactions required to operate and secure the service |
| Crash Data | Caught and fatal client errors with a redacted stack/context |
| Other Diagnostic Data | Redacted technical context used to diagnose reliability and support issues |
| Other Data Types | Optional employee birth date configured and entered by a company administrator |

Not declared because the app does not currently collect them: advertising data, tracking domains/identifiers, full address-book contacts, microphone/audio, health/fitness, gender, sensitive/biometric information, browsing history, search history, precise/coarse device location, credit information or full payment credentials. Coordinates stored for a customer object or worksite are supplied explicitly by a user and describe that business location; the app does not request or derive the current location of the user or device.

Release owner gate: compare this file with the uploaded archive privacy report, `https://monitorapp.ru/privacy`, the actual production processors and the App Store Connect questionnaire. Stop submission on any mismatch; do not silently broaden a declaration or under-report collection.
