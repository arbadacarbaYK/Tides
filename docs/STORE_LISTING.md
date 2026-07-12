# Chrome Web Store Submission Kit

Everything needed to fill in the CWS developer dashboard for Tides. Copy-paste from here.

## Basics

- **Name:** Tides
- **Summary (max 132 chars):** Nostr messenger with end-to-end encrypted DMs, groups, lightning zaps (NWC), GIFs and rich media previews. Your keys stay local.
- **Category:** Social & Communication
- **Language:** English

## Description

```
Tides is a Nostr messenger that lives in your browser toolbar.

FEATURES
• End-to-end encrypted direct messages (NIP-04 / NIP-44) and group chats
• Lightning zaps — send Bitcoin tips, with optional Nostr Wallet Connect (NWC) for one-tap wallet payments
• Rich previews: Nostr notes and profiles, YouTube, Twitch, Twitter/X, images, videos and GIFs
• GIF search, emoji picker, QR codes, dark mode
• Contact management with network-wide follow/mute sync (NIP-51)
• Multiple relays with automatic fallback

PRIVACY FIRST
No Tides server, no account, no analytics. Your private key is stored AES-GCM encrypted on your device and never leaves it. Messages travel end-to-end encrypted over the Nostr relays you use.

LOGIN
Log in with your nsec (stored encrypted locally). NIP-46 remote signing support is planned.
```

## Permission justifications (CWS "Privacy practices" tab)

- **storage** — Stores the user's encrypted Nostr key, contacts, settings and message cache locally. No data leaves the device.
- **notifications** — Shows a desktop notification when a new encrypted message arrives.
- **Host permission `https://*/*`** — Required for Lightning zaps: a recipient's lightning address can be on any domain (`user@example.com` resolves to `https://example.com/.well-known/lnurlp/user`), so invoice requests must be able to reach arbitrary HTTPS hosts. Requests happen only on an explicit user zap action. The extension injects no content scripts and does not read or modify websites.
- **Remote code:** None. All JavaScript is bundled in the package; embedded players (YouTube/Twitch/Twitter) are sandboxed iframes allowed via CSP, which is compliant with MV3.

## Data-use disclosures (CWS questionnaire)

- Collects **no** user data for the developer: no PII, no health, no financial info collected by us, no location, no web history, no user activity, no site content harvesting.
- "Authentication information" (the user's Nostr key) is stored locally only, never transmitted to the developer. There is no developer server.
- Not selling data, not using data for unrelated purposes, not for creditworthiness — answer "no" to all.

## Assets checklist

- [x] Icon 128×128 in package (`icons/icon128.png`)
- [ ] Store icon 128×128 PNG upload (use `src/icons/icon128.png`)
- [ ] 1–5 screenshots, 1280×800 or 640×400 (chat view, zap modal, GIF picker, group chat, login)
- [ ] Optional promo tile 440×280
- [ ] Privacy policy URL: link to `PRIVACY.md` on GitHub (raw or rendered), e.g. `https://github.com/arbadacarbaYK/tides/blob/main/PRIVACY.md`

## Submission steps

1. `npm run build` → `dist/` contains the final extension.
2. Zip the **contents** of `dist/` (not the folder itself).
3. Register a Chrome Web Store developer account ($5 one-time) at https://chrome.google.com/webstore/devconsole
4. "New item" → upload zip → fill listing with the texts above → fill privacy tab with the justifications above.
5. Submit. Expect a longer review because of the broad host permission — the justification above addresses it.

## Review-risk notes

- The single broad grant left is `https://*/*`, needed for LNURL zaps to arbitrary lightning-address domains. Everything else was stripped in v1.3.0 (`webRequest`, `tabs`, `scripting`, `activeTab`, `web_accessible_resources` — all removed).
- If reviewers push back on `https://*/*`, the fallback is to drop it and rely on lightning-address providers sending CORS headers (most major ones do); zaps to non-CORS providers would then fail.
