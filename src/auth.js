import { nostrCore, pool, RELAYS, shortenIdentifier } from './shared.js';
import { validateEvent, soundManager } from './utils.js';
import { storeMetadata } from './userMetadata.js';
import { credentialManager } from './credentialManager.js';

class Auth {
  constructor() {
    this.currentUser = null;
  }

  async init() {
    const stored = await credentialManager.getStoredCredentials();
    if (stored) {
      this.currentUser = stored;
      return stored;
    }
    return null;
  }

  async login(method, credentials) {
    try {
      let user;
      
      // NIP-07 extension login was removed: signer extensions never inject
      // window.nostr into another extension's popup. NIP-46 remote signing is
      // the planned replacement.
      if (method === 'NSEC') {
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
    await credentialManager.storeCredentials(credentials);
    return credentials;
  }

  async getStoredCredentials() {
    try {
      return await credentialManager.getStoredCredentials();
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

    if (user.type === 'NSEC' && user.privkey) {
      return user.privkey;
    }
    return null;
  }
}

const auth = new Auth();
window.auth = auth;
export { auth };

/**
 * @class Auth
 * @description Authentication manager for Nostr login handling
 * Supports NSEC (private key) login; keys are stored AES-GCM encrypted via
 * credentialManager. NIP-46 remote signing is planned as a second method.
 * 
 * Key features:
 * - Secure credential storage
 * - User metadata initialization
 * - Private key management
 * 
 * @example
 * const user = await auth.login('NSEC', nsecString);
 */
