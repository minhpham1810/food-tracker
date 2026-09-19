# Freshness Tracker mobile app

Expo SDK 57 with Expo Router. Follow the [root setup guide](../../README.md)
to start the API on port 8010 and configure `EXPO_PUBLIC_API_BASE_URL`.
Read the [versioned Expo documentation](https://docs.expo.dev/versions/v57.0.0/)
before changing SDK integrations.

## Screens

- Fridge: periodically refreshed inventory, telemetry, alerts, and manual add.
- Item details: rename, change category, mark opened, set color-label score, remove.
- Scan: up to five camera/library images of one package, Qwen vision extraction,
  editable fields and category, confirm inventory entry.
- Assistant: messages and tool-call results from the optional model server.

Profiles come from the backend. An unavailable gas baseline is displayed as
unavailable, not as evidence of freshness. Profile values are demo coefficients.

## Verify

```sh
npm ci
npx tsc --noEmit
npx expo export --platform all
```

On a phone, check manual add, item edits, mark opened, deletion, repeated camera capture,
multi-select from the library, photo removal, permission denial, scan correction and
confirmation, an unreachable backend, and assistant success/unavailability. Check empty
inventory and telemetry without a gas baseline. Start a scenario using the root guide and
check dashboard refresh.

## Current limitations

There is no automated mobile interaction suite. Successful export is a build
check, not a device test. Native camera/upload behavior requires an actual device
or suitable simulator and a compatible Expo runtime.

Web preview is useful for layout and inventory browsing. Native camera/library behavior
still requires a device or simulator, and the React Native
confirmation alert used for deletion does not implement web deletion. These
flows target iOS/Android in this MVP.

JSON API requests time out after 12 seconds. Multi-photo Qwen scans have a separate
130-second deadline. The current app
has no authentication or durable local inventory; the backend owns inventory and
loses it on restart.
