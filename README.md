# Digital Khata

Digital Khata is a React Native Android app backed by a separate Express and MongoDB service. Customer records, shop settings, ledger entries, activity history, and backup restores are stored in the API account rather than AsyncStorage. The mobile app keeps access credentials in Expo SecureStore.

## Run locally

1. Install MongoDB Community Edition and start it as a local service. On macOS with Homebrew:

   ```bash
   brew tap mongodb/brew
   brew install mongodb-community@8.0
   ```

   Edit the MongoDB config at `$(brew --prefix)/etc/mongod.conf` and add:

   ```yaml
   replication:
     replSetName: rs0
   ```

   Start MongoDB and initiate its single-node replica set (the API uses transactions, which require a replica set):

   ```bash
   brew services start mongodb-community@8.0
   mongosh --eval 'rs.initiate()'
   ```

2. In a separate terminal, configure and start the API:

   ```bash
   cp server/.env.example server/.env
   ```

   Keep `MONGODB_URI=mongodb://127.0.0.1:27017/digital_khata?replicaSet=rs0`. Replace `JWT_SECRET` with a private random value of at least 32 characters. The example enables a development-only OTP (`123456`); it is for local development only.

   ```bash
   npm --prefix server install
   npm --prefix server run indexes
   npm --prefix server run dev
   ```

   The API listens on port `4000`. Check it at `http://localhost:4000/api/v1/health`. Leave this terminal running.
3. Start the Android app:

   ```bash
   npm install
   npm start
   ```

   The default API URL is `http://10.0.2.2:4000/api/v1` for an Android emulator. For a physical phone, create a root `.env.local` with `EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_LAN_IP:4000/api/v1`, then rebuild/restart the development app. Keep this HTTP development setup on a trusted network. Production app builds disable cleartext traffic and must use HTTPS.
4. Because SecureStore and push notifications are native modules, use a development build for device testing:

   ```bash
   npx expo run:android
   ```

   In the local server setup, enter the development OTP shown on the verification screen. A production server never returns that code.

To stop local MongoDB, run `brew services stop mongodb-community@8.0`.

## Production configuration

Use a managed MongoDB replica set such as Atlas with a dedicated database user limited to the application database. Set `NODE_ENV=production`, `DEV_OTP_ENABLED=false`, a unique strong `JWT_SECRET`, `MONGODB_URI`, and `APP_ORIGINS`. Terminate TLS at a trusted proxy, set `TRUST_PROXY=true` only behind that proxy, restrict inbound network access, and run `npm run indexes` during deployment. Keep `.env` files and provider tokens out of source control and logs. The included request limiter uses in-process memory; multi-instance deployments should enforce shared limits at an API gateway/WAF or add a shared rate-limit store.

Real OTP needs Twilio Verify (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`). Scheduled SMS reminders need a Twilio Messaging Service as well. WhatsApp delivery needs a Meta WhatsApp Cloud API phone number, access token, and approved template (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_TEMPLATE_NAME`). The reminder worker stays off unless `REMINDER_WORKER_ENABLED=true`; it also respects each customer's reminder opt-out. Provider accounts, verified sending numbers, template approval, user consent, and applicable messaging rules must be configured by the service operator.

Push notifications require an EAS project (`EXPO_PUBLIC_EAS_PROJECT_ID` in the app build), Android Firebase/FCM credentials in EAS, and optionally an Expo access token on the server. Push registration is skipped until the project ID is configured. Expo Go is not a supported push target for this app's current SDK; use a development or production build.

Set the API URL at build time using `EXPO_PUBLIC_API_URL`. Android emulator uses `10.0.2.2`; a physical device needs a reachable HTTPS API URL for production. The app does not include service credentials.

## API capabilities

The versioned API is under `/api/v1`. It provides OTP start/verify and refresh-token rotation, authenticated bootstrap, shop settings, searchable and cursor-paginated customers, cursor-paginated ledger/activity, idempotent transaction creation, transaction edit/delete, notification inbox/read state, Expo device registration, WhatsApp message delivery, cloud backup restore, and account deletion. MongoDB records are scoped to the authenticated shop. Money is stored as integer paise. Index definitions cover tenant-scoped lookups, search, customer/date ledger history, audit ordering, session TTL, push-token uniqueness, and idempotency. Multi-record transaction edits, backup restore, and account deletion use MongoDB transactions, so MongoDB must run as a replica set.

The app keeps the existing statement share sheet behavior for user-reviewed messages. Automated reminders and API message delivery require configured providers; selecting a channel in the UI does not bypass provider setup or customer opt-out.

## Android build

```bash
npx expo prebuild --platform android
npx expo run:android
```

Use your own release signing credentials before publishing. Keep the generated native project and all credentials out of source control.

## Project files

- `App.tsx`: app screens and user actions.
- `src/api.ts`: authenticated mobile API client and secure token storage.
- `src/model.ts`: app data types, balances, statements, and backup validation.
- `server/src/index.js`: Express API, auth, validation, tenant checks, and routes.
- `server/src/models.js`: MongoDB models and indexes.
- `server/src/providers.js`: OTP, SMS, WhatsApp, and Expo push adapters.
- `server/src/reminders.js`: opt-in scheduled reminder worker.
- `docker-compose.yml`: optional local MongoDB replica set and API service.

No test cases or test suites were added or run, as requested.
