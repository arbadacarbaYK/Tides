# Tides: A Nostr-based Messenger

Tides is a messaging application built as Chrome extension that enables secure and private communication using the Nostr protocol.

<p align="center">
<img src="https://github.com/user-attachments/assets/85527f53-7f04-4ff9-8e93-ef78ba71d737" width="300" />
<img src="https://github.com/user-attachments/assets/d9b07c28-dcfb-4934-9a90-519612f1925c" width="300" />
<img src="https://github.com/user-attachments/assets/7cde7eac-10d8-4181-8a15-0bbeef1b3ab2" width="300" />
</p>


## Features

- Secure login via:
  - NIP-07 browser extension (recommended)
  - Chrome storage
  - Manual private key (nsec)
- Real-time encrypted messaging
- Contact management with profile pictures and usernames
- Message notifications with sound
- Media sharing support (images, videos, GIFs)
- Emoji picker
- Link previews
- Multi-relay support

## Installation

1. Download the latest release from the releases page

2. Install in Chrome:
   - Open Chrome and navigate to `chrome://extensions`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" in the top left
   - Select the downloaded and unzipped Tides folder

3. Click the Tides icon in your Chrome toolbar to start using the app

## Login Methods

1. **NIP-07 Extension (Recommended)**
   - Install a Nostr signer extension (like nos2x or Alby)
   - Click "Login with Extension" in Tides

2. **Chrome Storage**
   - Your credentials will be securely stored in Chrome
   - Automatically logs you in on browser restart

3. **Manual Login**
   - Enter your nsec private key
   - Not recommended for regular use

## Technical Details

Built using:
- nostr-tools for protocol handling
- Native WebSocket for relay connections
- Chrome Storage API for data persistence
- Web Notifications API
- Giphy API for GIF support

Supports NIPs:
- NIP-01: Basic protocol
- NIP-04: Encrypted Direct Messages
- NIP-05: DNS Identifiers
- NIP-07: Browser Extension
- NIP-44: Versioned Encryption
- NIP-89: Application Handlers

## Privacy & Security

- End-to-end encrypted messages
- No central server
- Private keys never leave your device
- Open source and auditable

## License

MIT License - See LICENSE file for details
