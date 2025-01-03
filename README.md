# Tides: A Nostr Messenger Extension For Chrome/Brave  

Tides is a powerful Nostr messenger that lives right in your browser as an extension. 
Its Compatible with Chromium-based browsers like Brave (recommended), Chrome, or Edge.

<img src="https://github.com/user-attachments/assets/cb262f4b-6275-43a3-bbb9-eefdd2f3740b" width="350" alt="Bildschirmfoto vom 2024-12-28 04-28-08">

<img src="https://github.com/user-attachments/assets/3c9a6ea2-7deb-4688-a666-2ad9fe09d328" width="350" alt="Bildschirmfoto vom 2024-12-28 04-29-15">

<img src="https://github.com/user-attachments/assets/da4e469a-4cbf-4935-a4fe-deb211a98c3b" width="350" alt="Bildschirmfoto vom 2024-12-28 04-29-42">


<img src="https://github.com/user-attachments/assets/f83a865e-7aee-470d-bad1-e5e765004e3d" width="350" alt="Bildschirmfoto vom 2024-12-28 04-30-51">

<img src="https://github.com/user-attachments/assets/7826fcc3-9415-4b01-975c-b1c3a0132665" width="350" alt="Bildschirmfoto vom 2024-12-28 04-31-33">

<img src="https://github.com/user-attachments/assets/fa411735-feda-4f4e-af4d-f4376d3abd71" width="350" alt="Bildschirmfoto vom 2024-12-28 04-31-33">


## Features 🚀

- **Direct Messaging**: Seamless peer-to-peer communication over the Nostr network
- **Zaps Integration**: Send and receive Bitcoin tips via Lightning Network
- **Media Support**: Share images, GIFs, and embed content from popular platforms
- **Rich Link Previews**: Automatic previews for Nostr notes, profiles, and media links
- **Multiple Relay Support**: Connect to various Nostr relays for increased reliability
- **Extension Login**: Compatible with NIP-07 browser extensions like Alby and nos2x
- **Offline Support**: Access your message history even when offline
- **Custom Themes**: Dark mode support with a sleek, modern interface

## Installation for Users 🔧

### Manual Installation from ZIP
1. Download the latest release `.zip` file
2. Extract the ZIP file - the contents should contain `manifest.json` and other files
3. Open your browser and navigate to:
   - Brave: `brave://extensions`
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
4. Enable "Developer mode" in the top right corner
5. Click "Load unpacked" and select the folder containing the extracted files
6. Make sure to enable "Add to taskbar" in the extension details to see the icon
7. The extension icon should appear in your browser toolbar

## For Developers 🛠️

### Setting Up the Development Environment

1. Clone the repository:
```
git clone https://github.com/arbadacarbaYK/tides.git
cd tides
```

2. Install dependencies and build:
```
npm install
npm run build
```

3. Load the extension in your browser:
   - Navigate to the extensions page (see installation instructions above)
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` directory from your build
   - Enable "Add to taskbar" in extension details

### Project Structure

```
src/
├── background.js      # Service worker and background processes
├── popup.js          # Main UI logic
├── popup.html        # Extension popup interface
├── style.css         # Styling
├── shared.js         # Shared utilities and constants
├── userMetadata.js   # User profile handling
├── services/         # External API integrations (Giphy, etc.)
├── sounds/          # Audio files for notifications
├── icons/           # Extension and UI icons
├── state/           # State management and persistence
└── lib/             # Third-party libraries
```

### Technical Details

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

### Development Guidelines

1. **Authentication Flow**
   - Support both NIP-07 extension login and manual nsec
   - Implement secure credential storage
   - Handle auto-login via Chrome storage
   - Validate all key formats

2. **Relay Management**
   - Implement connection pooling
   - Handle relay failures gracefully
   - Cache messages for offline use
   - Monitor relay health

3. **Message Handling**
   - Encrypt all DMs using NIP-04
   - Validate message signatures
   - Handle different content types
   - Implement proper error recovery

4. **Performance**
   - Cache user metadata locally
   - Implement lazy loading for media
   - Optimize WebSocket connections
   - Minimize storage usage

## Privacy & Security 🔒

- End-to-end encrypted messages using both:
  - NIP-04: Legacy encryption support
  - NIP-44: Latest versioned encryption protocol
- No central server, pure P2P communication
- Private keys never leave your device
- Local storage encryption for cached data
- Open source and auditable code
- No tracking or analytics
- Minimal permission requirements
- Secure relay connections only

## Contributing 🤝

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Support ⚡

If you find this project useful, please consider sending a zap to support development at arbadacarba@btip.nl!

## License 📄

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 

This means you are free to:

- Share: Copy and redistribute the material in any medium or format

- Adapt: Remix, transform, and build upon the material
Under the following terms:
- Attribution: You must give appropriate credit, provide a link to the license, and indicate if changes were made
- NonCommercial: You may not use the material for commercial purposes
- No additional restrictions: You may not apply legal terms or technological measures that legally restrict others from doing anything the license permits

For more information, see [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)

## Acknowledgments 🙏

- The Nostr community for their amazing psychoOs and tools
- Lightning Network developers making instant payments possible
- All contributors and users making this project better

---
