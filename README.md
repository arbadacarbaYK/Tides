# Tides: A Nostr-based Messenger

<img src="https://github.com/user-attachments/assets/cb262f4b-6275-43a3-bbb9-eefdd2f3740b" width="350" alt="Bildschirmfoto vom 2024-12-28 04-28-08">

<img src="https://github.com/user-attachments/assets/3c9a6ea2-7deb-4688-a666-2ad9fe09d328" width="350" alt="Bildschirmfoto vom 2024-12-28 04-29-15">

<img src="https://github.com/user-attachments/assets/da4e469a-4cbf-4935-a4fe-deb211a98c3b" width="350" alt="Bildschirmfoto vom 2024-12-28 04-29-42">


<img src="https://github.com/user-attachments/assets/f83a865e-7aee-470d-bad1-e5e765004e3d" width="350" alt="Bildschirmfoto vom 2024-12-28 04-30-51">

<img src="https://github.com/user-attachments/assets/7826fcc3-9415-4b01-975c-b1c3a0132665" width="350" alt="Bildschirmfoto vom 2024-12-28 04-31-33">

<img src="https://github.com/user-attachments/assets/fa411735-feda-4f4e-af4d-f4376d3abd71" width="350" alt="Bildschirmfoto vom 2024-12-28 04-31-33">


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
   - Unpack the dist-zip from Releases to a new folder
   - Open Chrome and navigate to `chrome://extensions`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" in the top left
   - Select the downloaded and unzipped Tides folder

4. Click the Tides icon in your Chrome toolbar to start using the app


To do the build youself start ```npm install``` on the codebase and run ```npm run build``` afterwards. Then open the Extension as described above from the newly created dist-folder.


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


