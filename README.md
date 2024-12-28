# Tides: A Nostr-based Messenger

Tides is a messaging application built as Chrome extension that enables secure and private communication using the Nostr protocol.

## Features

- Secure login via:
  - NIP-07 browser extension 
  - Chrome storage
  - Manual private key (nsec)
- Real-time encrypted messaging
- Media link sharing and preview support:
  - Images (PNG, JPG, WEBP, GIF)
  - Videos (MP4, WEBM)
  - YouTube videos
  - Twitter/X posts
  - Nostr notes and profiles
- Emoji picker
- Link previews
- Multi-relay support
- Zaps support 
- Search history for contacts
- Integrated Noderunners Radio stream


## Installation

1. Download the latest release (v1.1.0) from the releases page

2. Install in Chrome:
   - Open Chrome and navigate to `chrome://extensions`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" in the top left
   - Select the downloaded and unzipped Tides folder

3. Click the Tides icon in your Chrome toolbar to start using the app

## Login Methods

1. **NIP-07 Extension**
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
- WebLN for Lightning Network integration

Supports NIPs:
- NIP-01: Basic protocol
- NIP-04: Encrypted Direct Messages
- NIP-05: DNS Identifiers
- NIP-07: Browser Extension
- NIP-19: bech32-encoded entities
- NIP-21: nostr: URL scheme
- NIP-25: Reactions
- NIP-44: Versioned Encryption
- NIP-57: Lightning Zaps
- NIP-89: Application Handlers

## Privacy & Security

- End-to-end encrypted messages
- No central server
- Private keys never leave your device
- Open source and auditable


