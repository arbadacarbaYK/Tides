# Tides: A Nostr Messenger Extension For Chrome & Brave  

A zap and NWC enabled Nostr messenger 
Browser extension for Chromium-based browsers like Brave (recommended), Chrome, or Edge.

<img src="https://github.com/user-attachments/assets/da4e469a-4cbf-4935-a4fe-deb211a98c3b"
width="350" alt="Bildschirmfoto">

<img src="https://github.com/user-attachments/assets/f83a865e-7aee-470d-bad1-e5e765004e3d"
width="350" alt="Bildschirmfoto">

<img src="https://github.com/user-attachments/assets/7826fcc3-9415-4b01-975c-b1c3a0132665"
width="350" alt="Bildschirmfoto">

<img src="https://github.com/user-attachments/assets/56d344f0-0f4a-45ec-9d6a-e5af635ef456"
width="350" alt="Bildschirmfoto">

<img src="https://github.com/user-attachments/assets/12ee9443-ab42-4c9f-9d3d-7e4ff6fcd112"
height="250" alt="NWC">
<img height="250" src="https://github.com/user-attachments/assets/5002ea1c-1ea0-419a-ac01-088a899a2256" />
<img src="https://github.com/user-attachments/assets/375aac87-b553-465b-82df-f412c62d09e7" height="250" alt="NWC">

## Features 🚀

- **Direct Messaging & Groups**: P2P communication and group conversations
- **Lightning Zaps**: Send/receive Bitcoin tips with optional ***NWC wallet integration***
- **Media Support**: Images, GIFs, videos (MP4, WebM, MOV, AVI, MKV), file uploads to Blossom
- **Rich Previews**: Nostr notes/profiles, YouTube, Twitter/X, Twitch, Amazon, media links
- **Multiple Relays**: Automatic fallback and retry logic
- **Login Options**: NIP-07 extensions (Alby, nos2x) or manual nsec
- **Contact Management**: Follow/unfollow with network-wide sync, NIP-51 mute lists
- **Search & Navigation**: Find contacts, groups, messages with context menus
- **Modern UI**: Dark mode, emoji picker, GIF search, QR codes
- **Performance**: Message caching, fast loading, robust error handling


## Installation 🔧

1. Download and extract the latest release `.zip` file
2. Open your browser extensions page (`brave://extensions`, `chrome://extensions`, `edge://extensions`)
3. Enable "Developer mode" → Click "Load unpacked" → Select extracted folder
4. Enable "Add to taskbar" in extension details

## Changelog 📝

### v1.2.0 - Advanced Contact Management & NWC (Aug 2025)

**New Features:**
- Advanced contact management with network-wide sync
- NIP-51 mute lists for multi-client consistency  
- Nostr Wallet Connect (NWC) for direct wallet zap payments
- Improved contact discovery and performance optimizations

**Improvements:**
- Enhanced unfollow functionality and removed message limits
- Better error handling, UI stability, and GIF service integration
- Network-level contact actions and proper NIP-51 implementation

## For Developers 🛠️

```bash
git clone https://github.com/arbadacarbaYK/tides.git
cd tides
npm install
npm run build
```

Load the `dist` directory as an unpacked extension in your browser.
You can find more info in Setup Instructions.

### Project Structure

```
src/
├── background.js      # Service worker and background processes
├── popup.js          # Main UI logic
├── popup.html        # Extension popup interface
├── style.css         # Styling
├── shared.js         # Shared utilities and constants
├── userMetadata.js   # User profile handling
├── contact.js        # Contact management
├── messages.js       # Message handling and encryption
├── groupContact.js   # Group contact management
├── groupMessages.js  # Group message handling
├── services/         # External API integrations (Giphy, etc.)
├── sounds/          # Audio files for notifications
├── icons/           # Extension and UI icons
├── state/           # State management and persistence
└── lib/             # Third-party libraries
```

### Tech Stack & NIPs

**Built with:** nostr-tools, WebSocket, Chrome Storage API, Web Notifications, Giphy API, WebLN, Blossom

**Supported NIPs:** 01, 02, 03, 04, 05, 07, 17, 19, 21, 25, 28, 40, 41, 42, 44, 47, 51, 57, 59, 65, 89, 92

#### NWC (Wallet Connect)
Tides supports zapping via Nostr Wallet Connect (NIP‑47):
- Connect your wallet in Settings → NWC and paste your NWC URI
- In any chat, use the zap button → choose “Pay with NWC” (or scan QR)
- We show clear success/error status without closing the modal prematurely
- Your custom message is included in the zap receipt (NIP‑57; for NWC zaps not yet shown on all apps)

#### NIPs and Kinds at a Glance

| Feature | NIP | Kind(s) | What it means | Where Tides uses it |
|---|---|---|---|---|
| Direct Messages (encrypted) | [NIP-04](https://nips.nostr.com/04) | 4 | Legacy encrypted DMs | Reading older DMs, fallback when peer doesn’t support NIP‑17 |
| Chat Messages (DMs) | [NIP-17](https://nips.nostr.com/17) | 14 | Unsigned chat messages; may be wrapped via NIP‑59 | Preferred for DMs when available |
| Versioned Encryption | [NIP-44](https://nips.nostr.com/44) | – (applies to payloads of 4/14) | Stronger encryption format | Decrypting/creating modern DMs |
| Gift Wrap & Seals | [NIP-59](https://nips.nostr.com/59) | 1059 (gift wrap), 13 (seal) | Wraps/ships kind‑14 privately | Receiving “secret” NIP‑17 messages |
| Zap Receipts | [NIP-57](https://nips.nostr.com/57) | 9734 | Lightning zap receipt events | QR zaps and NWC zaps |
| Wallet Connect | [NIP-47](https://nips.nostr.com/47) | – | Control wallet over Nostr | “Pay with NWC” buttons |
| Groups | – | 40 (create), 41 (metadata/update/leave), 42 (messages) | Group lifecycle and chat | Group list and chat views |
| DM Relay List | [NIP-17](https://nips.nostr.com/17) | 10050 | User’s preferred DM relays | Live DMs use your 10050; backfill may widen to peer’s 10050 |
| Relay List (general) | [NIP-65](https://nips.nostr.com/65) | 10002 | General relay preferences | Fallback when 10050 is missing |
| Contacts + Relay Hints | [NIP-02/03](https://nips.nostr.com) | 3 | Follow list; sometimes includes relays | Contact discovery and hints |

### Key Development Areas

- **Authentication**: NIP-07/nsec login, secure storage, key validation
- **Relays**: Connection pooling, fallbacks, retry logic, health monitoring
- **Messages**: NIP-04/44 encryption, signatures, media support, group handling
- **Contacts**: Follow lists (NIP-02/03), mute lists (NIP-51), network sync
- **Groups**: Creation, management, metadata, caching
- **Performance**: Local caching, lazy loading, optimized connections, timeouts
- **Error Handling**: Global boundaries, graceful degradation, user-friendly messages

## Privacy & Security 🔒

- **E2E Encryption**: NIP-04/44 encrypted messages, private keys never leave device
- **P2P Communication**: No central server, open source, no tracking
- **Secure Features**: Local storage encryption, minimal permissions, secure relay connections
- **Privacy Controls**: Network-wide contact sync, NIP-51 mute lists, optional NWC integration

## Contributing 🤝

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License 📄

Licensed under [Creative Commons Attribution-NonCommercial 4.0](https://creativecommons.org/licenses/by-nc/4.0/)
**You can**: Share, remix, adapt  
**Requirements**: Attribution, non-commercial use only

## Acknowledgments 🙏

Thanks to my dear weirdos of the Nostr and lightning community ! 

If you want to support my work send some 🧡 to LNURL1DP68GURN8GHJ7CN5D9CZUMNV9UH8WETVDSKKKMN0WAHZ7MRWW4EXCUP0X9UXGDEEXQ6XVVM9XUMXGDFCXY6NQS43TRV
