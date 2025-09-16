import { SimplePool, nip19, getPublicKey, getEventHash, getSignature, nip04, nip44 } from 'nostr-tools';

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

// Add NIP-44 helpers if available
nostrCore.nip44 = nip44;

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
    // Resolve early once a minimal healthy set is connected
    const MIN_READY = 3;
    if (this.connectedRelays.size >= MIN_READY) {
      return true;
    }

    const slowPattern = /nostr\.watch|relay\.nostr\.net/i;
    const fastRelays = RELAYS.filter(url => !slowPattern.test(url));
    const slowRelays = RELAYS.filter(url => slowPattern.test(url));

    let resolveEarly;
    const early = new Promise(res => { resolveEarly = res; });

    const connect = async (url) => {
      try {
        await this.pool.ensureRelay(url);
        this.connectedRelays.add(url);
        if (this.connectedRelays.size >= MIN_READY) {
          resolveEarly(true);
        }
        return true;
      } catch (error) {
        console.warn(`Failed to connect to relay: ${url}`, error);
        return false;
      }
    };

    // Connect fast relays first
    const fastPromises = fastRelays.map(connect);

    // Start slow relays in the background (do not block)
    setTimeout(() => {
      slowRelays.forEach(connect);
    }, 0);

    // Return as soon as MIN_READY reached, or when all fast relays settle
    const settled = Promise.allSettled(fastPromises).then(results =>
      results.some(r => r.status === 'fulfilled' && r.value === true)
    );
    return Promise.race([early, settled]);
  }

  // Ensure connections to a specific set of relays only (lightweight, capped)
  async ensureSpecificConnections(relayUrls = []) {
    const urls = (relayUrls || [])
      .filter(u => typeof u === 'string' && (u.startsWith('wss://') || u.startsWith('ws://')));
    const promises = urls.map(async (url) => {
      if (this.connectedRelays.has(url)) return true;
      try {
        await this.pool.ensureRelay(url);
        this.connectedRelays.add(url);
        return true;
      } catch (err) {
        return false;
      }
    });
    const results = await Promise.allSettled(promises);
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

// NIP-07 proxy shim for extension popup: bridge to page context (e.g., Alby)
// Some providers (like Alby) do not inject window.nostr into extension pages.
// This shim mirrors the NIP-07 API and executes calls in the active tab.
if (typeof window.nostr === 'undefined' && typeof chrome !== 'undefined' && chrome.scripting && chrome.tabs) {
  const executeInActiveTab = async (fn, args = []) => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs && tabs[0];
    if (!activeTab || !activeTab.id) {
      throw new Error('No active tab available for NIP-07 provider');
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: (userFnString, userArgs) => {
        const userFn = new Function(`return (${userFnString});`)();
        return userFn(...(userArgs || []));
      },
      args: [fn.toString(), args]
    });
    if (result && result.__nostr_error) {
      throw new Error(result.__nostr_error);
    }
    return result;
  };

  const callNostr = async (method, ...args) => {
    return executeInActiveTab((m, a) => {
      try {
        if (!window.nostr) return { __nostr_error: 'NIP-07 provider not found in page' };
        const target = m.split('.').reduce((obj, key) => (obj ? obj[key] : undefined), window.nostr);
        if (typeof target !== 'function') return { __nostr_error: `Method not available: ${m}` };
        return Promise.resolve(target.apply(window.nostr, a));
      } catch (e) {
        return { __nostr_error: e && e.message ? e.message : String(e) };
      }
    }, [method, args]);
  };

  window.nostr = {
    enable: async () => {
      // Some providers do not require enable; try if available
      try { return await callNostr('enable'); } catch { return true; }
    },
    getPublicKey: async () => {
      return await callNostr('getPublicKey');
    },
    signEvent: async (event) => {
      return await callNostr('signEvent', event);
    },
    // Namespaced methods (nip04/nip44)
    nip04: {
      encrypt: async (pubkey, content) => {
        return await callNostr('nip04.encrypt', pubkey, content);
      },
      decrypt: async (pubkey, content) => {
        return await callNostr('nip04.decrypt', pubkey, content);
      }
    },
    nip44: {
      decrypt: async (pubkey, content) => {
        return await callNostr('nip44.decrypt', pubkey, content);
      }
    }
  };
}

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
