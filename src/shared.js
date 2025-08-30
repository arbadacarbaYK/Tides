import { SimplePool, nip19, getPublicKey, getEventHash, getSignature, nip04 } from 'nostr-tools';

// Core nostr functionality export
export const nostrCore = {
  nip19,
  getPublicKey,
  getEventHash,
  getSignature,
  nip04,
  encrypt: nip04.encrypt,
  decrypt: nip04.decrypt
};

// Export pool instance for direct use
export const pool = new SimplePool({
  eoseSubTimeout: 2000,
  getTimeout: 2000,
  connectTimeout: 1500
});

// Relay list
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://inbox.azzamo.net',
  'wss://relay.primal.net',
  'wss://nostr.azzamo.net',
  'wss://nostr.einundzwanzig.space',
  'wss://relay.nostr.net',
  'wss://relay.nostr.watch',
  'wss://relay.minibits.cash'
];

// Utility functions
export function shortenIdentifier(identifier) {
  return identifier.slice(0, 8) + '...' + identifier.slice(-4);
}

export function pubkeyToNpub(pubkey) {
  return nostrCore.nip19.npubEncode(pubkey);
}

// Relay pool management
export class RelayPool {
  constructor() {
    this.pool = pool;
    this.connectedRelays = new Set();
  }

  async ensureConnection() {
    if (this.connectedRelays.size > 0) {
      return true;
    }

    const connectionPromises = RELAYS.map(async (url) => {
      try {
        await this.pool.ensureRelay(url);
        this.connectedRelays.add(url);
        return true;
      } catch (error) {
        console.warn(`Failed to connect to relay: ${url}`, error);
        return false;
      }
    });

    const results = await Promise.allSettled(connectionPromises);
    return results.some(r => r.status === 'fulfilled' && r.value === true);
  }

  getConnectedRelays() {
    return Array.from(this.connectedRelays);
  }
}

export const relayPool = new RelayPool();

// Export to global scope for other scripts
window.relayPool = relayPool;
window.RELAYS = RELAYS;
window.nostrCore = nostrCore;
// Ensure global access to the shared SimplePool for modules using window.pool
window.pool = pool;

/**
 * @file shared.js
 * @description Core shared utilities and constants for Nostr operations
 * 
 * Exports:
 * - nostrCore: Core Nostr functionality
 * - pool: SimplePool instance for relay management
 * - RELAYS: Default relay list
 * - RelayPool: Custom relay pool management
 * 
 * Utility functions:
 * - shortenIdentifier(): Formats long identifiers
 * - pubkeyToNpub(): Converts pubkeys to npub format
 * 
 * @example
 * await relayPool.ensureConnection();
 * const npub = pubkeyToNpub(pubkey);
 */
