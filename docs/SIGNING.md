# Signing the installers

Releases are unsigned for now:

- The macOS app has an ad-hoc signature (`identity: "-"` in
  `electron-builder.yml`), so Apple Silicon Macs open it after the user clicks
  **Open Anyway**.
- The Windows installer has no signature, so SmartScreen warns the user.

The README tells users how to get past both. To remove the warnings, add real
signatures as described below. Nothing else in the build has to change.

## macOS: Developer ID signature and notarization

You need:

- A paid Apple Developer Program membership ($99/year).
- A **Developer ID Application** certificate, created in Xcode or at
  developer.apple.com > Certificates. Export it from Keychain Access as a
  `.p12` file with a password.
- An app-specific password for your Apple Account (account.apple.com >
  Sign-In and Security > App-Specific Passwords), and your Team ID from
  developer.apple.com > Membership.

Steps:

1. Add these repository secrets (Settings > Secrets and variables > Actions):

   | Secret | Value |
   |---|---|
   | `MAC_CERT_P12_BASE64` | `base64 -i cert.p12` output |
   | `MAC_CERT_PASSWORD` | the .p12 password |
   | `APPLE_ID` | your Apple Account email |
   | `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | your 10-character Team ID |

2. In `electron-builder.yml`, under `mac:`:
   - Remove `identity: "-"` (electron-builder then picks the Developer ID
     certificate).
   - Set `hardenedRuntime: true`.
   - Add `notarize: true`.
   - Add `entitlements: build/entitlements.mac.plist` and
     `entitlementsInherit: build/entitlements.mac.plist`.

3. Create `build/entitlements.mac.plist`. Electron needs JIT, and the app
   starts Playwright's installer with Electron as Node:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>com.apple.security.cs.allow-jit</key><true/>
     <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
     <key>com.apple.security.cs.disable-library-validation</key><true/>
     <key>com.apple.security.network.client</key><true/>
   </dict></plist>
   ```

4. In `.github/workflows/release.yml`, give the macOS build step the secrets:

   ```yaml
   - name: Build the macOS .dmg (universal)
     if: runner.os == 'macOS'
     env:
       CSC_LINK: ${{ secrets.MAC_CERT_P12_BASE64 }}
       CSC_KEY_PASSWORD: ${{ secrets.MAC_CERT_PASSWORD }}
       APPLE_ID: ${{ secrets.APPLE_ID }}
       APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
       APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
     run: npm run dist:mac
   ```

   electron-builder signs the app, uploads it to Apple's notary service,
   waits, and staples the ticket to the app and the .dmg.

5. Check the result on a Mac: `spctl -a -vv "/Applications/Job Autopilot.app"`
   should say `source=Notarized Developer ID`.

Once the app is signed, the macOS Keychain stops asking again after each
update, because the signature stays the same. The app's own updater
(`main/updater.js`) keeps working unchanged: it swaps the `.app` bundle
itself. If you'd rather switch to Apple's Squirrel updater through
`electron-updater`, that also needs the signature.

## Windows: code signing

Since 2023, new code-signing certificates have to live on a hardware token or
in a cloud HSM, so the simplest path from GitHub Actions is a cloud signing
service. Two common choices:

- **Azure Trusted Signing** (about $10/month; individuals in the US and Canada
  with three years of verifiable history, or organizations). Create a Trusted
  Signing account and certificate profile, plus an app registration with the
  "Trusted Signing Certificate Profile Signer" role. Add
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` as secrets.
  Then in `electron-builder.yml`:

  ```yaml
  win:
    azureSignOptions:
      publisherName: "Your Name"
      endpoint: https://eus.codesigning.azure.net/
      codeSigningAccountName: your-account
      certificateProfileName: your-profile
  ```

  and pass the three `AZURE_*` secrets as `env:` on the Windows build step.

- **An OV/EV certificate from a CA with cloud signing** (SSL.com eSigner,
  DigiCert KeyLocker, and others). Follow the CA's GitHub Actions guide,
  usually a `signtoolOptions.sign` hook or a step that signs `dist/*.exe`
  after the build.

A signed installer still builds SmartScreen reputation over time. EV
certificates used to skip that wait, but since 2024 they're treated like OV.
For the first weeks after the first signed release, users may still see
"More info > Run anyway".
