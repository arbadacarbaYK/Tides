/**
 * @file credentialManager.js
 * @description Secure credential management for Nostr private keys
 */

class CredentialManager {
  constructor() {
    this.encryptionKey = null;
  }

  /**
   * Initialize the encryption key using Chrome's secure storage
   */
  async init() {
    try {
      const stored = await chrome.storage.sync.get('encryptionKey');
      if (stored.encryptionKey) {
        // Convert stored array back to Uint8Array
        this.encryptionKey = new Uint8Array(stored.encryptionKey);
      } else {
        // Generate a random encryption key if none exists
        this.encryptionKey = crypto.getRandomValues(new Uint8Array(32));
        // Store as regular array to avoid serialization issues
        await chrome.storage.sync.set({ 
          encryptionKey: Array.from(this.encryptionKey) 
        });
      }
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
      throw error;
    }
  }

  /**
   * Encrypt sensitive data before storage
   */
  async encrypt(data) {
    if (!this.encryptionKey) await this.init();
    
    try {
      // Convert data to string if it's an object
      const dataStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
      
      // Generate a random IV for each encryption
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      // Import encryption key
      const key = await crypto.subtle.importKey(
        'raw',
        this.encryptionKey.buffer,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );
      
      // Encrypt the data
      const encodedData = new TextEncoder().encode(dataStr);
      const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encodedData
      );
      
      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encryptedData.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encryptedData), iv.length);
      
      // Convert to base64 for storage
      return btoa(String.fromCharCode(...combined));
    } catch (error) {
      console.error('Encryption failed:', error);
      throw error;
    }
  }

  /**
   * Decrypt sensitive data after retrieval
   */
  async decrypt(encryptedData) {
    if (!this.encryptionKey) await this.init();
    
    try {
      // Convert from base64
      const combined = new Uint8Array(
        atob(encryptedData).split('').map(char => char.charCodeAt(0))
      );
      
      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const data = combined.slice(12);
      
      // Import decryption key
      const key = await crypto.subtle.importKey(
        'raw',
        this.encryptionKey.buffer,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );
      
      // Decrypt the data
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
      );
      
      const decryptedStr = new TextDecoder().decode(decrypted);
      
      // Try to parse as JSON if possible
      try {
        return JSON.parse(decryptedStr);
      } catch {
        return decryptedStr;
      }
    } catch (error) {
      console.error('Decryption failed:', error);
      throw error;
    }
  }

  /**
   * Store encrypted credentials
   */
  async storeCredentials(credentials) {
    if (!credentials?.pubkey) {
      throw new Error('Invalid credentials format');
    }

    try {
      const encrypted = await this.encrypt(credentials);
      await chrome.storage.local.set({
        currentUser: encrypted,
        [`credentials:${credentials.pubkey}`]: encrypted
      });
      return credentials;
    } catch (error) {
      console.error('Failed to store credentials:', error);
      throw error;
    }
  }

  /**
   * Retrieve and decrypt credentials
   */
  async getStoredCredentials() {
    try {
      const { currentUser } = await chrome.storage.local.get('currentUser');
      if (!currentUser) return null;
      
      return await this.decrypt(currentUser);
    } catch (error) {
      console.error('Failed to get stored credentials:', error);
      return null;
    }
  }
}

// Create a singleton instance
const credentialManager = new CredentialManager();
export { credentialManager }; 