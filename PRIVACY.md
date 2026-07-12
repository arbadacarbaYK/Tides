# Tides Privacy Policy

_Last updated: July 2026_

Tides is a Nostr messenger that runs entirely in your browser. There is no Tides server: no account, no analytics, no telemetry, no tracking of any kind.

## What Tides stores, and where

All data stays on your device in the browser's extension storage:

- **Your Nostr private key (nsec)** — stored AES-GCM-encrypted in local extension storage. It is used only to sign and encrypt/decrypt your Nostr events locally. It is never transmitted anywhere.
- **Your Nostr Wallet Connect (NWC) connection string** — if you connect a wallet for zaps, the pairing string is stored locally and used only to talk to the wallet service you configured.
- **Message cache, contacts, and settings** — cached locally so the app opens fast.

Uninstalling the extension deletes all of this.

## What leaves your device

Tides only makes the network connections needed to function as a Nostr client:

- **Nostr relays (WebSocket)** — to send and receive your messages, contact lists, and profiles. Messages are end-to-end encrypted (NIP-04/NIP-44); relays only see ciphertext and routing metadata inherent to the Nostr protocol.
- **Lightning/LNURL servers** — when you send a zap, Tides contacts the recipient's lightning address provider (the domain in their lightning address) to request an invoice. This is initiated only by your explicit zap action.
- **Giphy API** — only when you open the GIF picker and search; the search term is sent to Giphy.
- **Media and embeds** — images, videos, and embedded players (YouTube, Twitch, Twitter/X) in messages are loaded directly from their origin servers when a message containing them is displayed. Those services may see your IP address, as with any embedded content in a browser.

Tides never injects code into web pages, never reads your browsing history or tabs, and never sells or shares any data — it has no server to send data to.

## Permissions explained

- `storage` — save your encrypted key, contacts, and message cache locally.
- `notifications` — show a desktop notification when a new message arrives.
- `https://*/*` (host access) — required to request zap invoices from lightning address providers, which can live on any domain (e.g. `user@example.com` → `https://example.com/.well-known/lnurlp/user`). Tides makes these requests only when you send a zap. It does not read or modify websites.

## Contact

Questions or concerns: open an issue at https://github.com/arbadacarbaYK/tides
