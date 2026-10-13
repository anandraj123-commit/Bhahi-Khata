# Digital Khata

React Native Android application built from `share-1791834534587-Digital-Khata.pdf`, using Expo, TypeScript, and native React Native controls. The supplied PDF remains unchanged.

## Run

```bash
npm install
npm start
```

Open the project in an Expo Go version compatible with Expo SDK 57 on an Android phone, or connect an Android device/emulator and run:

```bash
npm run android
```

On the welcome screen, choose **Explore demo shop** to load sample customers. Alternatively, enter a valid Indian mobile number and use demo OTP **123456**, then set up your shop. Once a shop exists, log in with that shop's number. Demo data cannot overwrite an existing shop.

## Implemented

- Splash/loading, welcome, mobile login, demo verification, and shop setup.
- Dashboard with ledger-derived balances, customer count, monthly udhari/collection, and recent transactions.
- Customer creation/editing, name/phone search, All/Due/Paid/Overdue filters, credit limits, and reminder opt-out.
- Udhari and payments with dates, notes, due dates, payment methods, validation, and duplicate-tap protection.
- Transaction details, edits, confirmed deletion, and local before/after activity history.
- Month-by-month khata: opening + udhari − payment = closing balance.
- Statements, editable WhatsApp/SMS messages, and Android's native share sheet. Opening an external app does not automatically send a message.
- Notifications with read state, six-month report bars, and customer balance distribution.
- Shop profile, saved reminder/default-payment preferences, searchable help, and subscription previews.
- CSV export, JSON backup, validated restore with replacement confirmation, logout, and confirmed local account deletion.
- English/Hindi labels for the main interface. Detailed help, validation alerts, and service-integration notices remain in English.

All records are persisted in AsyncStorage on the device. Export backups from **More → Settings → Save backup**. Restore from **More → Settings → Restore backup**. Payments greater than the outstanding amount are recorded as customer credit (a negative balance). Overdue means a customer has a positive balance and at least one past-due credit entry; payments are not allocated to individual invoices.

## Android builds

Generate the native project, if needed:

```bash
npx expo prebuild --platform android
```

Build an APK with an Android SDK and compatible JDK installed:

```bash
cd android
NODE_ENV=production ./gradlew assembleRelease
```

APK output: `android/app/build/outputs/apk/release/app-release.apk`.

The generated local release configuration uses the Android debug signing key for installation during development. Configure your own release signing before publishing to Google Play. The `eas.json` file also supplies preview APK and production app-bundle profiles for a configured Expo/EAS account.

## Service integration boundaries

This is a functional local application, not a deployed multi-user service. The PDF calls for backend capabilities that require an API and service configuration:

- Real OTP, authenticated accounts, PIN recovery, and cloud storage/sync.
- Server-side customer search, authorization, transaction idempotency, and immutable audit history.
- Scheduled reminders, delivery status, and automatic WhatsApp/SMS delivery.
- Billing, subscription enforcement, real support contact details, and cloud account deletion/retention.

The app explicitly labels demo/service-dependent features. Subscription buttons do not charge money, reminder settings do not schedule messages, and local login is not a security boundary. No support phone numbers or service credentials have been invented.

## Project files

- `App.tsx`: screen flows, navigation, persistence, and actions.
- `src/model.ts`: data types, sample data, balances, monthly statements, and backup validation.
- `src/ui.tsx`: reusable native controls and the PDF's green/orange design palette.
- `src/i18n.tsx`: main-interface English/Hindi labels.
- `app.json`: Android app identity and icon configuration.
- `eas.json`: APK/AAB build profiles.

## Validation

```bash
npm run typecheck
npm run export:android
```

No test cases or test suites were added, as requested. Android compilation does not run unit tests. See `BUILD_STATUS.md` for actual build results and environment limitations.

# Bhahi-Khata
