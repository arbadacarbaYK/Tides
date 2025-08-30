# Tides: A Nostr Messenger Extension For Chrome & Brave  

A powerful Nostr messenger browser extension for Chromium-based browsers like Brave (recommended), Chrome, or Edge.

<img src="https://github.com/user-attachments/assets/cb262f4b-6275-43a3-bbb9-eefdd2f3740b"
width="350" alt="Bildschirmfoto">

<img src="https://github.com/user-attachments/assets/da4e469a-4cbf-4935-a4fe-deb211a98c3b"
width="350" alt="Bildschirmfoto">

<img src="https://github.com/user-attachments/assets/f83a865e-7aee-470d-bad1-e5e765004e3d"
width="350" alt="Bildschirmfoto">


<img src="https://github.com/user-attachments/assets/7826fcc3-9415-4b01-975c-b1c3a0132665"
width="350" alt="Bildschirmfoto">

<img src="https://github.com/user-attachments/assets/fa411735-feda-4f4e-af4d-f4376d3abd71"
width="350" alt="Bildschirmfoto">

<img src="https://github.com/user-attachments/assets/56d344f0-0f4a-45ec-9d6a-e5af635ef456"
width="350" alt="Bildschirmfoto">

## Features 🚀

- **Direct Messaging & Groups**: P2P communication and group conversations
- **Lightning Zaps**: Send/receive Bitcoin tips with NWC wallet integration (optional)
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
- Comprehensive developer documentation and testing guides

## For Developers 🛠️

```bash
git clone https://github.com/arbadacarbaYK/tides.git
cd tides
npm install
npm run build
```

Load the `dist` directory as an unpacked extension in your browser.

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

**Supported NIPs:** 01, 02, 03, 04, 05, 07, 19, 21, 25, 28, 40, 41, 42, 44, 47, 51, 57, 65, 89, 92

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

## Support ⚡

If you find this project useful, please consider sending a zap to support development at arbadacarba@btip.nl!

## License 📄

Licensed under [Creative Commons Attribution-NonCommercial 4.0](https://creativecommons.org/licenses/by-nc/4.0/)

**You can**: Share, remix, adapt  
**Requirements**: Attribution, non-commercial use only

## Acknowledgments 🙏

Thanks to the Nostr community, Lightning Network developers, and all contributors!

---
