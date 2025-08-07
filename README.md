# Tides: A Nostr Messenger Extension For Chrome & Brave  

Tides is a powerful Nostr messenger that lives right in your browser as an extension. 
Its Compatible with Chromium-based browsers like Brave (recommended), Chrome, or Edge.

<img src="https://github.com/user-attachments/assets/cb262f4b-6275-43a3-bbb9-eefdd2f3740b" width="350" alt="Bildschirmfoto">
<img src="https://github.com/user-attachments/assets/da4e469a-4cbf-4935-a4fe-deb211a98c3b" width="350" alt="Bildschirmfoto">
<img src="https://github.com/user-attachments/assets/f83a865e-7aee-470d-bad1-e5e765004e3d" width="350" alt="Bildschirmfoto">

<img src="https://github.com/user-attachments/assets/7826fcc3-9415-4b01-975c-b1c3a0132665" width="350" alt="Bildschirmfoto">
<img src="https://github.com/user-attachments/assets/fa411735-feda-4f4e-af4d-f4376d3abd71" width="350" alt="Bildschirmfoto">
<img src="https://github.com/user-attachments/assets/56d344f0-0f4a-45ec-9d6a-e5af635ef456" width="350" alt="Bildschirmfoto">

## Features 🚀

- **Direct Messaging**: Seamless peer-to-peer communication over the Nostr network
- **Group Chats**: Create and manage group conversations with multiple participants
- **Zaps Integration**: Send and receive Bitcoin tips via Lightning Network
- **Enhanced Media Support**: Share images, GIFs, videos (MP4, WebM, MOV, AVI, MKV), and embed content from popular platforms
- **File Upload**: Upload files to Blossom file server with automatic URL sharing
- **Rich Link Previews**: Automatic previews for Nostr notes, profiles, YouTube, Twitter/X, Twitch, Amazon, and media links
- **Multiple Relay Support**: Connect to various Nostr relays with automatic fallback and retry logic
- **Extension Login**: Compatible with NIP-07 browser extensions like Alby and nos2x
- **Advanced Contact Management**: Unfollow contacts with network-wide synchronization across all Nostr clients
- **Mute Lists**: Block unwanted contacts using standardized mute lists (NIP-51) for multi-client consistency
- **Nostr Wallet Connect**: Pay zaps directly from your own NWC-compatible wallet (optional)
- **Message Caching**: Temporary storage of recent messages for faster loading
- **Custom Themes**: Dark mode support with a sleek, modern interface
- **Search**: Search through contacts, groups, and messages
- **Group Management**: Create, edit, and leave groups with member management
- **Performance Optimizations**: Fast message loading with timeout protection and error recovery
- **Robust Error Handling**: Graceful degradation when relays fail or media doesn't load
- **Context Menus**: Right-click context menus for contacts and groups
- **Profile Modals**: View and edit user profiles with metadata
- **Emoji Picker**: Built-in emoji selection for messages
- **GIF Integration**: Search and share GIFs from Giphy
- **QR Code Generation**: Generate QR codes for Lightning invoices and LNURLs


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

## Changelog 📝

### v1.2.0 - Advanced Contact Management & Stability (Aug 2025)

**🎉 Major Features:**
- **Advanced Contact Management**: Unfollow contacts with network-wide synchronization
- **NIP-51 Mute Lists**: Block unwanted contacts with multi-client consistency  
- **Nostr Wallet Connect (NWC)**: Pay zaps from your own wallet (optional)
- **Improved Contact Discovery**: More reliable "Recent" contact classification
- **Performance Optimizations**: Faster loading with bulk DM conversation discovery

**🔧 Improvements:**
- Fixed contacts missing from Recent list (Jan, Mikih, Quillie, etc.)
- Enhanced unfollow functionality for both followed contacts and non-contacts
- Removed arbitrary message limits that excluded older conversations
- Better error handling for failed relays and network issues
- Improved UI stability with null-safe operations
- Fixed GIF service integration and ES6 module compatibility

**🛡️ Security & Standards:**
- Network-level contact actions for multi-client synchronization
- Proper NIP-51 mute list implementation (corrected from NIP-25)
- Filtered relay publishing to avoid restricted relay errors
- Enhanced input validation and error boundaries

**📚 Documentation:**
- Updated README with all new features and NIPs
- Created comprehensive SETUP_INSTRUCTIONS.md for developers
- Added debugging guide and testing checklist

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

### Technical Details

Built using:
- nostr-tools for protocol handling
- Native WebSocket for relay connections
- Chrome Storage API for data persistence
- Web Notifications API
- Giphy API for GIF support
- WebLN for Lightning Network integration
- Blossom file server for file uploads

Supports NIPs:
- NIP-01: Basic protocol
- NIP-02: Follow List (contact management)
- NIP-03: Follow List metadata (contact management)
- NIP-04: Encrypted Direct Messages
- NIP-05: DNS Identifiers
- NIP-07: Browser Extension
- NIP-19: bech32-encoded entities
- NIP-21: nostr: URL scheme
- NIP-25: Reactions (likes, dislikes on messages)
- NIP-28: Public Chat Channels
- NIP-40: Expiration Timestamp
- NIP-41: Channel Metadata (group management)
- NIP-42: Authentication
- NIP-44: Versioned Encryption
- NIP-47: Nostr Wallet Connect (zap payments)
- NIP-51: Lists (including mute lists for blocking)
- NIP-57: Lightning Zaps
- NIP-65: Relay List Metadata
- NIP-89: Application Handlers
- NIP-92: Media Attachments

### Development Guidelines

1. **Authentication Flow**
   - Support both NIP-07 extension login and manual nsec
   - Implement secure credential storage
   - Handle auto-login via Chrome storage
   - Validate all key formats

2. **Relay Management**
   - Implement connection pooling with fallback relays
   - Handle relay failures gracefully with retry logic
   - Cache messages for offline use
   - Monitor relay health and connection timeouts

3. **Message Handling**
   - Encrypt all DMs using NIP-04/44
   - Validate message signatures
   - Handle different content types including video files
   - Implement proper error recovery with fallbacks
   - Process group messages (kind 42)
   - Handle group metadata updates
   - Support media uploads to Blossom

4. **Contact Management**
   - Follow/unfollow contacts using NIP-02/03 follow lists
   - Network-wide contact synchronization across Nostr clients
   - Mute unwanted contacts using NIP-51 mute lists
   - Filter contacts by follow status and mute status
   - Support both followed contacts and temporary message senders
   - Multi-client consistency for all contact actions

5. **Group Management**
   - Create and edit groups
   - Member management
   - Group metadata handling
   - Leave group functionality
   - Group message caching
   - Group event validation

6. **Performance**
   - Cache user metadata locally
   - Cache group data locally
   - Implement lazy loading for media
   - Optimize WebSocket connections
   - Minimize storage usage
   - Efficient message filtering
   - Timeout protection for all async operations

7. **Error Handling**
   - Global error boundaries prevent crashes
   - Graceful degradation for failed operations
   - Fallback content for failed media
   - Comprehensive logging for debugging
   - User-friendly error messages

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
- File uploads use secure authentication
- Optional Nostr Wallet Connect (NWC) for zap payments
- Contact management with network-wide synchronization
- Mute lists for privacy control across all Nostr clients

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
