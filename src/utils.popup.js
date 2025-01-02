import { NostrTools } from './shared.popup.js';

export function shortenIdentifier(id) {
  return id ? `${id.slice(0, 8)}...${id.slice(-4)}` : '';
}

export function pubkeyToNpub(pubkey) {
  return NostrTools.nip19.npubEncode(pubkey);
}

/**
 * @file utils.popup.js
 * @description Utility functions specific to popup UI operations
 * 
 * Core utilities:
 * - shortenIdentifier: Formats long identifiers for display
 * - pubkeyToNpub: Converts public keys to npub format
 */
