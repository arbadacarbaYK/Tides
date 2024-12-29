/**
 * @file userMetadata.js
 * @description User Profile Management for Tides Nostr Messenger
 * 
 * This module handles all user metadata operations including:
 * - Fetching profiles from Nostr relays
 * - Caching metadata locally
 * - Queue management for metadata requests
 * - Fallback avatar and name handling
 * 
 * The module implements an efficient queuing system to prevent
 * relay spam when multiple metadata requests occur simultaneously.
 * 
 * 🧙‍♂️ "Behind every pubkey is a story waiting to be told"
 */

import { pool, relayPool } from './shared.js';
import { toLowerCaseHex } from './utils.js';
import { pubkeyToNpub, shortenIdentifier } from './shared.js';

/** Queue for handling multiple metadata requests */
const metadataQueue = [];
/** Flag to prevent concurrent queue processing */
let isProcessingQueue = false;

/**
 * Process queued metadata requests sequentially
 * This prevents overwhelming relays with simultaneous requests
 * and ensures efficient caching
 * @private
 */
async function processMetadataQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  
  while (metadataQueue.length > 0) {
    const { pubkey, resolve, reject } = metadataQueue.shift();
    try {
      const metadata = await fetchMetadataFromRelay(pubkey);
      if (metadata) {
        await storeMetadata(pubkey, metadata);
      }
      resolve(metadata);
    } catch (error) {
      reject(error);
    }
  }

  isProcessingQueue = false;
}

/**
 * Fetch and process user metadata
 * @param {string} pubkey - User's public key in hex format
 * @returns {Promise<Object>} User metadata object containing profile information
 * @property {string} name - User's display name
 * @property {string} picture - URL to user's avatar
 * @property {string} [about] - User's bio/description
 * @property {string} [nip05] - NIP-05 verification address
 * @property {string} [lud16] - Lightning address for payments
 * @throws {Error} If metadata cannot be fetched or processed
 */
export async function getUserMetadata(pubkey) {
  try {
    let metadata = await getStoredMetadata(pubkey);
    if (!metadata) {
      metadata = await fetchMetadataFromRelay(pubkey);
      if (metadata) {
        await storeMetadata(pubkey, metadata);
      }
    }
    console.log('Got metadata for', pubkey, ':', metadata);
    return metadata;
  } catch (error) {
    console.error('Error getting metadata:', error);
    // Return default profile if metadata fetch fails
    return {
      name: shortenIdentifier(pubkeyToNpub(pubkey)),
      picture: '/icons/default-avatar.png'
    };
  }
}

function validateMetadata(metadata) {
  if (typeof metadata !== 'object' || metadata === null) {
    return null;
  }

  const validKeys = ['name', 'displayName', 'picture', 'about', 'nip05', 'lud16', 'banner', 'website'];
  const validatedMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (validKeys.includes(key) && typeof value === 'string') {
      validatedMetadata[key] = value;
    }
  }

  // Ensure at least one valid field is present
  if (Object.keys(validatedMetadata).length === 0) {
    return null;
  }

  return validatedMetadata;
}

export function getDisplayName(pubkey, metadata) {
  return metadata.name || metadata.displayName || pubkeyToNpub(pubkey);
}

export function getAvatarUrl(metadata) {
  return metadata.picture || 'icons/default-avatar.png';
}

export async function getStoredMetadata(pubkey) {
  const result = await chrome.storage.local.get([`metadata:${pubkey}`]);
  const stored = result[`metadata:${pubkey}`];
  
  if (stored && Date.now() - stored.timestamp < 3600000) { // 1 hour cache
    return stored;
  }
  return null;
}

export async function storeMetadata(pubkey, metadata) {
  return chrome.storage.local.set({
    [`metadata:${pubkey}`]: {
      ...metadata,
      timestamp: Date.now()
    }
  });
}

async function fetchMetadataFromRelay(pubkey) {
  try {
    await relayPool.ensureConnection();
    const filter = {
      kinds: [0],
      authors: [pubkey],
      limit: 1
    };
    
    const relays = relayPool.getConnectedRelays();
    const events = await pool.list(relays, [filter]);
    
    if (events.length > 0) {
      const metadata = JSON.parse(events[0].content);
      console.log("Fetched metadata:", metadata);
      return validateMetadata(metadata);
    }
    
    console.log("No metadata found for:", pubkey);
    return null;
  } catch (error) {
    console.error("Error fetching metadata:", error);
    return {
      name: shortenIdentifier(pubkeyToNpub(pubkey)),
      picture: '/icons/default-avatar.png'
    };
  }
}

export { fetchMetadataFromRelay };
