import { NostrTools } from './shared.popup.js';

export function shortenIdentifier(id) {
  return id ? `${id.slice(0, 8)}...${id.slice(-4)}` : '';
}

export function pubkeyToNpub(pubkey) {
  return NostrTools.nip19.npubEncode(pubkey);
}
