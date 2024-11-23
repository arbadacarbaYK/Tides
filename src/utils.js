import { nostrCore, pubkeyToNpub, shortenIdentifier } from './shared.js';

export function npubToPubkey(npub) {
  try {
    const { data } = nostrCore.nip19.decode(npub);
    return data;
  } catch (error) {
    console.error('Invalid npub:', error);
    return null;
  }
}

export function normalizeIdentifier(identifier) {
  if (identifier.startsWith('npub')) {
    return npubToPubkey(identifier);
  }
  return identifier;
}

export function generateCredentialFormats(privkey) {
  try {
    if (typeof privkey === 'string' && privkey.startsWith('nsec1')) {
      const decoded = nostrCore.nip19.decode(privkey);
      privkey = decoded.data;
    }
    
    const pubkey = nostrCore.getPublicKey(privkey);
    const npub = nostrCore.nip19.npubEncode(pubkey);
    const shortenedNpub = shortenIdentifier(npub);
    
    return { 
      pubkey: pubkey.toLowerCase(),
      privkey,
      npub,
      shortenedNpub 
    };
  } catch (error) {
    console.error('Error generating credential formats:', error);
    return null;
  }
}

export function displayUserIdentifier(user) {
  if (user.name) return user.name;
  if (user.petname) return user.petname;
  const npub = pubkeyToNpub(user.pubkey);
  return shortenIdentifier(npub);
}

export function validateEvent(event) {
  try {
    if (!event || typeof event !== 'object') return null;
    if (!event.id || !event.pubkey || !event.created_at || !event.kind) return null;
    if (!event.content) return null;
    return event;
  } catch (error) {
    console.error('Event validation failed:', error);
    return null;
  }
}

export function exponentialBackoff(attempt) {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

export function toLowerCaseHex(str) {
  return str.toLowerCase();
}

export async function getStoredCredentials() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['credentials'], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result.credentials || null);
      }
    });
  });
}

export async function getPrivateKey() {
  const credentials = await getStoredCredentials();
  if (credentials && credentials.privkey) {
    return credentials.privkey;
  }
  throw new Error('Private key not found');
}

class SoundManager {
  constructor() {
    this.sounds = new Map([
      ['login', 'sounds/login.mp3'],
      ['message', 'sounds/message.mp3']
    ]);
    this.played = new Set();
    this.enabled = true;
  }

  async play(type, onlyOnce = false) {
    if (!this.enabled || (onlyOnce && this.played.has(type))) {
      return;
    }

    const soundPath = this.sounds.get(type);
    if (!soundPath) {
      console.error(`Unknown sound type: ${type}`);
      return;
    }

    try {
      const audio = new Audio(soundPath);
      await audio.play();
      if (onlyOnce) {
        this.played.add(type);
      }
    } catch (error) {
      console.error(`Error playing ${type} sound:`, error);
    }
  }

  reset() {
    this.played.clear();
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
    this.reset();
  }
}

export const soundManager = new SoundManager();

export function validateNsec(nsec) {
  if (!nsec || typeof nsec !== 'string') return false;
  if (!nsec.startsWith('nsec1')) return false;

  try {
    const decoded = nostrCore.nip19.decode(nsec);
    return !!(decoded && decoded.data);
  } catch {
    return false;
  }
}
