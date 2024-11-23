import { SimplePool, nip19, getPublicKey, getEventHash, signEvent } from 'nostr-tools';

// Core nostr functionality export
export const nostrCore = {
  nip19,
  getPublicKey,
  getEventHash,
  signEvent
};

// Export pool instance for direct use
export const pool = new SimplePool();

// Relay list
export const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.wine'
];

// Utility functions
export function shortenIdentifier(identifier) {
  return identifier.slice(0, 8) + '...' + identifier.slice(-4);
}

export function pubkeyToNpub(pubkey) {
  return nostrCore.nip19.npubEncode(pubkey);
}

// Relay pool management
class RelayPool {
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
        console.log(`Connected to relay: ${url}`);
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
