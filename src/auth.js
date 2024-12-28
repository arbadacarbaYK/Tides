import { nostrCore, pool, RELAYS, shortenIdentifier } from './shared.js';
import { validateEvent, getStoredCredentials, soundManager } from './utils.js';
import { storeMetadata } from './userMetadata.js';

class Auth {
  constructor() {
    this.currentUser = null;
  }

  async init() {
    const stored = await getStoredCredentials();
    if (stored) {
      this.currentUser = stored;
      return stored;
    }
    return null;
  }

  async login(method, credentials) {
    try {
      let user;
      
      if (method === 'NIP-07') {
        user = await this.loginWithNIP07();
      } else if (method === 'NSEC') {
        user = await this.loginWithNSEC(credentials);
      } else {
        throw new Error('Invalid login method');
      }

      if (user) {
        await this.storeCredentials(user);
        soundManager.play('login');
      }

      return user;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  async loginWithNIP07() {
    if (!window.nostr) {
      throw new Error('NIP-07 extension not found');
    }

    try {
      const pubkey = await window.nostr.getPublicKey();
      const npub = nostrCore.nip19.npubEncode(pubkey);
      
      const credentials = {
        type: 'NIP-07',
        pubkey: pubkey.toLowerCase(),
        npub,
        displayId: shortenIdentifier(npub)
      };

      await this.storeCredentials(credentials);
      
      return credentials;
    } catch (error) {
      console.error('NIP-07 login failed:', error);
      throw error;
    }
  }

  async loginWithNSEC(nsecString) {
    try {
      const { type, data: privateKey } = nostrCore.nip19.decode(nsecString);
      
      if (type !== 'nsec') {
        throw new Error('Invalid nsec format');
      }
      
      const publicKey = nostrCore.getPublicKey(privateKey);
      const npub = nostrCore.nip19.npubEncode(publicKey);
      
      const credentials = {
        type: 'NSEC',
        pubkey: publicKey,
        privkey: privateKey,
        npub,
        displayId: shortenIdentifier(npub)
      };

      await this.storeCredentials(credentials);
      
      return credentials;
    } catch (error) {
      console.error('NSEC login failed:', error);
      throw error;
    }
  }

  async storeCredentials(credentials) {
    if (!credentials?.pubkey) {
      throw new Error('Invalid credentials format');
    }
    
    this.currentUser = credentials;
    await chrome.storage.local.set({ 
      currentUser: credentials,
      [`credentials:${credentials.pubkey}`]: credentials 
    });
    return credentials;
  }

  async getStoredCredentials() {
    try {
      const { currentUser } = await chrome.storage.local.get('currentUser');
      return currentUser || null;
    } catch (error) {
      console.error('Failed to get stored credentials:', error);
      return null;
    }
  }

  async getCurrentUser() {
    if (this.currentUser) return this.currentUser;
    return await this.getStoredCredentials();
  }

  async getPublicKey() {
    if (!this.currentUser) return null;
    return this.currentUser.pubkey;
  }

  async initializeUserData(pubkey) {
    try {
      const metadata = await getUserMetadata(pubkey);
      if (metadata) {
        await storeMetadata(pubkey, metadata);
      }
      return metadata;
    } catch (error) {
      console.error('Failed to initialize user data:', error);
      throw error;
    }
  }

  async getPrivateKey() {
    const user = await this.getCurrentUser();
    if (!user) return null;

    if (user.type === 'NIP-07') {
      return window.nostr;
    } else if (user.type === 'NSEC' && user.privkey) {
      return user.privkey;
    }
    return null;
  }
}

const auth = new Auth();
export { auth };
