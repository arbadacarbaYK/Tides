## 1.3.0

Store-readiness release: permission audit and NIP-07 removal.

- Permissions cut to the minimum: `storage` + `notifications` and a single `https://*/*` host grant (needed only for LNURL zap invoice requests, which can target any lightning-address domain). Removed `webRequest` (was never used), `tabs`, `scripting`, `activeTab`, the `wss://` host entries and the `web_accessible_resources` block.
- Removed NIP-07 entirely — login and every signing/encryption branch (DMs, groups, follow/mute lists, zap receipts): signer extensions (Alby, nos2x) never inject `window.nostr` into another extension's popup, so none of these paths could ever run. All signing now uses the encrypted locally stored nsec; NIP-46 remote signing is the planned replacement. Stored NIP-07 sessions are cleared on next open with a clear message.
- Proper 16/48/128 px icons generated from the logo (manifest previously pointed all sizes at one 555 px PNG).
- Added `PRIVACY.md` (required for store listing) and `docs/STORE_LISTING.md` with copy-paste store texts and permission justifications.
- Aligned the root dev `manifest.json` with the shipped `src/manifest.json` (they had drifted apart).

## 1.2.1

- Strip boilerplate captions like "Less secure DM with Gif/Image" from display only
- Remove inline `onerror` handlers to satisfy extension CSP; replace with JS listeners
- Improve NWC error-state feedback in zap modals
- Immediate UI removal after leaving a group; correct selector
- Safer credential logs (no decrypted data)
- Minor search fixes and metadata name resolution in lists

## 1.2.0

- Group creation/leave reliability improvements; wait for relay ack
- Ensure shared pool/relay instances across modules
- Various bug fixes and performance improvements

