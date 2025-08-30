# Setup Instructions

## Requirements
- Node 18+
- Chrome/Brave (Chromium-based)

## Install
1. npm install
2. npm run build
3. Load unpacked in browser, select `dist/`

## Development
- Build: `npm run build`
- Clean: `npm run clean`

## Env/Config
- No .env required. NWC and relay configuration stored via Chrome storage.

## Release Steps
1. Update `package.json` and `manifest.json` versions (kept in sync).
2. Update `CHANGELOG.md`.
3. `npm run build` → upload `dist/` as release asset or `Load unpacked`.
# Tides Development Setup Instructions

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Git
- Chromium-based browser (Chrome, Brave, Edge)

## Quick Start

1. **Clone and Setup**
   ```bash
   git clone https://github.com/arbadacarbaYK/tides.git
   cd tides
   npm install
   npm run build
   ```

2. **Load Extension in Browser**
   - Open browser extensions page (`chrome://extensions`, `brave://extensions`, etc.)
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/` directory
   - Enable "Add to taskbar" in extension details

## Development Workflow

### Build Commands
```bash
npm run build          # Production build
npm run dev            # Development build with watch (if available)
npm run prebuild       # Create dist directory structure
```

### File Structure
```
src/
├── auth.js            # NIP-07 and NSEC authentication
├── background.js      # Service worker, NWC, LNURL, zap processing
├── contact.js         # Contact management, follow lists, mute lists
├── messages.js        # DM handling, encryption (NIP-04/44)
├── popup.js           # Main UI, contact filtering, unfollow logic
├── groupContact.js    # Group management (NIP-40/41)
├── groupMessages.js   # Group message handling
├── userMetadata.js    # Profile handling (NIP-05)
├── shared.js          # Constants, relay lists
├── services/          # External integrations (Giphy, sound)
└── icons/             # UI and extension icons
```

## NIPs Implementation Status

### Core Protocol
- ✅ **NIP-01**: Basic protocol flow
- ✅ **NIP-02**: Follow List (contact management)
- ✅ **NIP-03**: Follow List metadata
- ✅ **NIP-04**: Encrypted Direct Messages
- ✅ **NIP-07**: Browser Extension authentication
- ✅ **NIP-19**: bech32-encoded entities

### Advanced Features
- ✅ **NIP-25**: Reactions (likes, dislikes on messages)
- ✅ **NIP-41**: Channel Metadata (group management)
- ✅ **NIP-44**: Versioned Encryption
- ✅ **NIP-47**: Nostr Wallet Connect (zap payments)
- ✅ **NIP-51**: Lists (including mute lists for blocking)
- ✅ **NIP-57**: Lightning Zaps
- ✅ **NIP-65**: Relay List Metadata

### Contact Management Features
- ✅ Follow/unfollow contacts with network synchronization
- ✅ Mute lists for blocking unwanted contacts (NIP-51)
- ✅ Multi-client consistency for contact actions
- ✅ Support for both followed contacts and temporary message senders
- ✅ Automatic filtering based on follow and mute status

### Zap Payment Features  
- ✅ Traditional QR code zap payments
- ✅ Optional Nostr Wallet Connect (NWC) integration
- ✅ LNURL-pay support with timeout handling
- ✅ User-friendly error messages for failed payments

## Configuration

### Environment Variables
Create `.env` file if needed for:
- API keys for external services
- Custom relay lists
- Development flags

### Relay Configuration
Edit `src/shared.js` to modify:
```javascript
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  // Add your relays here
];
```

## Testing

### Manual Testing Checklist
- [ ] Extension loads without errors
- [ ] Authentication works (both NIP-07 and NSEC)
- [ ] Send/receive DMs
- [ ] Follow/unfollow contacts (check network sync)
- [ ] Mute/unmute contacts (check across clients)
- [ ] Create/join/leave groups
- [ ] Send zaps (QR and NWC if configured)
- [ ] Media uploads and previews
- [ ] Contact filtering (Recent vs Other)

### Browser Testing
Test on:
- Brave (recommended)
- Chrome
- Edge
- Any Chromium-based browser

## Debugging

### Console Logs
Enable verbose logging in browser dev tools. Key log categories:
- `CONTACT INIT:` - Contact loading and filtering
- `Found X DM messages` - Message discovery
- `Removing unfollowed/muted contact` - Contact filtering
- `Published updated follow/mute list` - Network updates

### Common Issues
1. **Contacts not appearing**: Check follow list and mute list filtering
2. **Unfollow not working**: Verify signing method and relay restrictions
3. **Messages not loading**: Check relay connections and DM filters
4. **NWC not working**: Verify wallet connection string format

### Error Handling
- Check `result.txt` for console output during debugging
- Monitor network tab for relay connection issues
- Verify event signatures and formats

## Development Notes

### Code Style
- Use modern JavaScript (ES6+)
- Implement proper error handling with try/catch
- Add null checks for DOM elements
- Use meaningful variable names
- Add comments for complex logic

### Performance Considerations
- Batch relay operations when possible
- Cache user metadata and contact lists
- Use AbortController for timeouts
- Minimize DOM updates

### Security Guidelines
- Validate all user inputs
- Sanitize displayed content
- Never expose private keys
- Use secure relay connections only
- Implement proper CORS handling

## Release Process

1. Update version in `manifest.json`
2. Test thoroughly on multiple browsers
3. Build production version: `npm run build`
4. Test the built extension
5. Create release ZIP from `dist/` directory
6. Update README.md with new features
7. Tag release in git

## Contributing

1. Follow existing code patterns
2. Test all new features thoroughly
3. Update documentation for new NIPs or features
4. Ensure cross-browser compatibility
5. Add proper error handling

## Support

For development questions:
- Check existing issues on GitHub
- Review NIPs documentation at https://nips.nostr.com
- Test against other Nostr clients for compatibility

---

Last updated: January 2025
