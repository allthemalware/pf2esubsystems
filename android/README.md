# PF2e Subsystems for Android

The Android app includes **Run, Prep and Reference**. PF2e Primer is a separate
project and is not included. The encounter engine, rules and reference text are
bundled in the APK and work from the first launch without internet access.

Encounters are saved on the device. **Share** exports encounter prep through the
Android share sheet; paste the resulting code into **Import** on another device.
Shared codes work with the existing browser app too. Sharing does not include a
live run. Back closes Settings first, then returns to Run (or Prep for an empty
library); at the root Android handles leaving the app normally.
AndroidX's lifecycle-aware Back dispatcher handles both button and gesture
navigation, with interception enabled only while the app has a screen or dialog
to close.

## Before the session

Create encounters with forms: tap a chase length, enter participant names or
choose a numbered party, and select a saved party preset. **Settings → Party
presets** stores reusable groups; **Save as party preset** in an encounter's
Prep editor captures its existing participants. Preset edits do not change
encounters that already use those names.

**Pick from GM Core** opens searchable obstacle cards, with every matching
obstacle available by name, terrain or level.

## Backups and screen behavior

**Settings → Save backup file** uses Android's document picker. The JSON backup
includes all encounters, live progress, undo history, party presets and settings.
**Restore backup file** validates the entire file, shows its encounter count,
and asks before replacing the current library. Cancelling or choosing an invalid
file leaves the library unchanged. Files are limited to 5 MB. Browser builds
offer the same backup format through file download and upload.
Automatic cloud backups and device transfers are disabled. Use a backup file
to move your library to another device.

**Keep the screen awake on Run** is off by default. When enabled, it applies
only while an active encounter's Run board is visible. Opening Settings or a
setup dialog, switching tabs, or putting the app in the background releases it.
Browsers that support screen wake locks offer the same option.

Controls have 48-pixel minimum touch targets, explicit field and action names,
visible keyboard focus and reduced-motion support. Phone scoring buttons use
two columns, keyboard focus survives scoring, results are announced to screen
readers, and accent text/button colors adjust for readable contrast.

## Build a test APK

Requirements: Python 3, JDK 17 or 21, and the Android SDK with platform 36 and
build tools 35.0.0. Android Studio supplies a suitable JDK; set `JAVA_HOME` to it
if the system default is newer than Gradle supports. Set `ANDROID_HOME` to your
SDK, or put `sdk.dir=/absolute/path/to/Android/Sdk` in `android/local.properties`.

From the repository root:

```sh
npm run android:apk
# Equivalent, without Node/npm:
python3 tools/gradle.py assembleDebug
```

The first build downloads the official Gradle 8.13 wrapper and distribution,
verifies their pinned SHA-256 checksums, and downloads build dependencies.
It installs no system packages. Assets are rebuilt automatically by Gradle,
including when using Android Studio. After the first command has bootstrapped
the wrapper, open this `android/` directory in Android Studio to build and run.

Install `android/app/build/outputs/apk/debug/app-debug.apk` on a device:

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The **Build Android app** GitHub Actions workflow also tests, lints and builds a
debug APK and unsigned release bundle. Download the APK artifact to try it on a
phone. The workflow does not publish to Google Play.

## Release bundle

The application ID is `io.github.thewhytewolf.pf2esubsystems`, with minimum
Android 7.0 (API 24), target API 36 and initial version 0.1.0 (version code 1).

To sign a release, provide these environment variables outside the repository:

```text
PF2E_ANDROID_KEYSTORE=/absolute/path/to/upload-key.jks
PF2E_ANDROID_STORE_PASSWORD=…
PF2E_ANDROID_KEY_ALIAS=…
PF2E_ANDROID_KEY_PASSWORD=…
```

```sh
npm run android:bundle
# For subsequent releases, increase the version code:
python3 tools/gradle.py bundleRelease -PappVersionCode=2 -PappVersionName=0.1.1
```

The bundle is `android/app/build/outputs/bundle/release/app-release.aab`.
Without signing variables this is an unsigned build for inspection, not a
Google Play upload. Keep the upload key and passwords outside version control.

## GitHub prereleases for testers

The **Prepare Android prerelease** workflow is manual. It tests the app, lints
and builds a signed release APK, verifies its signature, and attaches the APK
and `SHA256SUMS.txt` to a **draft prerelease**. It does not publish the draft or
upload anything to Google Play. Push the repository changes to GitHub before
using the workflow.

First, create a signing key with Android Studio's **Build → Generate Signed App
Bundle / APK → APK** wizard and keep it outside this repository. Keep using the
same key for every GitHub APK, so testers can install updates over earlier
GitHub builds. Back up the key and its passwords.

In the repository's **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| --- | --- |
| `PF2E_ANDROID_KEYSTORE_BASE64` | Base64-encoded contents of the signing keystore |
| `PF2E_ANDROID_STORE_PASSWORD` | Keystore password |
| `PF2E_ANDROID_KEY_ALIAS` | Signing key alias |
| `PF2E_ANDROID_KEY_PASSWORD` | Signing key password |

On Linux, write the encoded file outside the repository and paste its contents
into the keystore secret:

```sh
umask 077
base64 -w 0 /absolute/path/to/signing-key.jks > /tmp/pf2e-keystore.base64
```

Remove the temporary encoded copy after adding the secret.

Then open **Actions → Prepare Android prerelease → Run workflow**. Select the
branch containing the tested changes and enter a new tag such as
`v0.1.0-beta.1` and a positive Android version code. Increase the version code
for every distributed build. The tag determines the version name; it must use
`vMAJOR.MINOR.PATCH-alpha.N`, `-beta.N`, or `-rc.N`. Existing tags are rejected
so each draft corresponds to the source commit actually built.

Once the workflow succeeds, open **Releases**, review the draft's notes and
attachments, then publish the prerelease. Share its link with testers. They
download the APK on their phone, open it from Downloads, and follow Android's
installation prompts. Publish a new prerelease for updates. Testers can report
bugs through [GitHub Issues](https://github.com/TheWhyteWolf/pf2esubsystems/issues),
including the downloaded app version, Android version, encounter type and steps
to reproduce. On a public repository, published prereleases are public;
private repositories require testers to have repository read access.

Debug APKs, GitHub APKs and Google Play installs can have different signing
certificates. Before changing distribution sources, testers should save a
library backup; if Android requires an uninstall, they can restore that file
after installing the other build. A Play upload key and the key Google uses to
sign distributed apps are separate concepts.

GitHub downloads do not count toward Google Play's closed-testing requirements.
Move testers to Play Console's closed testing track when preparing the store
release. Google Play tips need the billing setup and license testing described
below, including when installing from GitHub.

See [GitHub release management](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository),
[Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
and [Android app signing](https://developer.android.com/studio/publish/app-signing).

## Google Play tips

**Settings → Leave a tip through Google Play** offers optional, one-time tips.
All features remain free, and tips do not unlock content. The browser version
has no checkout. The native chooser fetches current localized prices from Play,
then opens Google's purchase confirmation. No price, payment information or
purchase token is passed to the WebView or saved in encounter backups.

Before payments are available, configure the app in Play Console:

1. Link a Google payments profile and upload a signed bundle with billing to an
   internal testing track, using package `io.github.thewhytewolf.pf2esubsystems`.
2. Under **Monetize with Play → Products → One-time products**, create these
   products. For each, create a **Buy** purchase option with ID **`tip`**, set
   your prices and regions, and activate both the product and purchase option.
   Use a regular purchase option without discount offers, rentals, preorders or
   multi-quantity checkout. These are consumed in code, allowing repeat tips.

   | Product ID | Suggested product name | Buy purchase option ID |
   | --- | --- | --- |
   | `tip_small` | Small tip | `tip` |
   | `tip_medium` | Medium tip | `tip` |
   | `tip_large` | Large tip | `tip` |

3. Add a **license tester**, opt that account into internal testing, and install
   the app from the test track. Use Play's test payment methods to verify tips
   without a real charge. A test track alone does not make purchases free.

The chooser displays only available, eligible products with their actual Play
prices. Missing products or a device without billing support show an unavailable
message. No subscriptions or external payment links are used.

Completed purchases are consumed through Play, which also acknowledges them and
allows another purchase of the same tip. The app thanks the user only after a
successful consume response. Pending payments are left pending; purchases are
queried on every foreground entry so completed payments and interrupted
confirmation attempts can finish after reopening. Duplicate callbacks do not
consume the same token twice concurrently. This uses Play's client-only flow;
there is no backend, paid entitlement, purchase history export, or locally stored
"supporter" status. Play Console remains the source of sales/refund records.

See Google's [billing setup guide](https://developer.android.com/google/play/billing/getting-ready),
[consumable purchase integration](https://developer.android.com/google/play/billing/integrate#process),
and [license testing guide](https://developer.android.com/google/play/billing/test).

## Validation

```sh
npm ci
npm run check
python3 tools/test_billing.py
python3 tools/gradle.py lintDebug assembleDebug bundleRelease
```

`npm run test:android` also runs without npm dependencies: it builds both asset
variants and checks native sharing, Back navigation, file validation, complete
backup restoration, party presets, wake-lock state and contrast in a document
fixture. `npm run test:mobile` exercises actual form controls and accessibility
labels with jsdom. These checks do not replace browser layout or device testing.
`tools/test_billing.py` uses a plain JDK to check pending/completed payments,
duplicate callbacks, repeat tips, failed confirmation retries, restart recovery,
and rejection of unrelated products or malformed receipts. It does not execute
the Play Store checkout; the internal testing track is needed for that.

On a phone, check first launch in airplane mode, each subsystem's scoring and
undo, Share → Import, Settings → Back, rotation, reopening after stopping the
app, light/dark themes, large text, and keyboard/system-bar spacing. Save and
restore a full backup (including undo); cancel both file pickers and the restore
confirmation; try invalid and oversized files; and check the keep-awake switch
on Run, Prep, Reference and while backgrounded. Tips additionally need a
Google Play account and connectivity. Test successful, declined, cancelled and
pending payments, reopening after a pending payment completes, retrying after
a failed consume, and buying each tip a second time. Confirm acknowledgement
in Play Console; license-test purchases are refunded quickly if unacknowledged.

The app declares Google Play Billing permission. Billing's dependencies may add
normal permissions to the merged manifest; inspect it when reviewing a release.
Encounter play stays offline and the WebView blocks remote requests. No storage
or notification permission prompt is needed. External web links open in the
device's browser. Application and rules licenses are available offline in
Settings; Android library notices are included there too.
