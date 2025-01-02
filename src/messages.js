import { pool, RELAYS, nostrCore, relayPool } from './shared.js';
import { auth } from './auth.js';
import { validateEvent } from './utils.js';
import NostrTools from 'nostr-tools';

export class MessageManager {
  constructor() {
    this.subscriptions = new Map();
    this.messageCache = new Map();
    this.pool = new NostrTools.SimplePool();
    this.currentChatPubkey = null;
  }

  async fetchMessages(pubkey) {
    const currentUser = await auth.getCurrentUser();
    if (!currentUser?.pubkey) {
      throw new Error('User not authenticated');
    }

    try {
      await relayPool.ensureConnection();
      const connectedRelays = relayPool.getConnectedRelays();
      
      const userPubkey = currentUser.pubkey.toLowerCase();
      const targetPubkey = pubkey.toLowerCase();

      // Create filters for both sent and received messages
      const filters = [
        {
          kinds: [4],
          '#p': [targetPubkey],
          authors: [userPubkey]
        },
        {
          kinds: [4],
          '#p': [userPubkey],
          authors: [targetPubkey]
        }
      ];

      // Handle self-messages
      if (userPubkey === targetPubkey) {
        filters.length = 0;
        filters.push({
          kinds: [4],
          '#p': [userPubkey],
          authors: [userPubkey]
        });
      }

      console.log('Fetching messages with filters:', filters);
      const events = await this.pool.list(connectedRelays, filters);
      console.log(`Found ${events.length} messages for ${pubkey}`);

      // Process and decrypt messages
      const messages = await Promise.all(
        events
          .filter(this.validateEvent)
          .sort((a, b) => a.created_at - b.created_at)
          .map(async (event) => {
            const decrypted = await this.decryptMessage(event);
            if (!decrypted) return null;
            
            return {
              id: event.id,
              pubkey: event.pubkey,
              content: decrypted,
              created_at: event.created_at,
              tags: event.tags
            };
          })
      );

      const validMessages = messages.filter(Boolean);
      console.log(`Decrypted ${validMessages.length} valid messages for ${pubkey}`);
      return validMessages;
    } catch (err) {
      console.error('Error fetching messages:', err);
      throw err;
    }
  }

  async decryptMessage(event) {
    try {
      const currentUser = await auth.getCurrentUser();
      const privateKey = await auth.getPrivateKey();
      
      if (!privateKey) {
        throw new Error('No private key available');
      }

      let decrypted;
      const isSent = event.pubkey === currentUser.pubkey;
      
      // Get recipient pubkey from tags
      const recipientPubkey = isSent 
        ? event.tags.find(tag => tag[0] === 'p')?.[1] 
        : event.pubkey;
        
      if (!recipientPubkey) {
        throw new Error('No recipient pubkey found in tags');
      }

      // Handle different encryption methods
      try {
        if (privateKey === window.nostr) {
          decrypted = await window.nostr.nip04.decrypt(
            isSent ? recipientPubkey : event.pubkey,
            event.content
          );
        } else {
          decrypted = await NostrTools.nip04.decrypt(
            privateKey,
            isSent ? recipientPubkey : event.pubkey,
            event.content
          );
        }
      } catch (decryptError) {
        // Silently handle padding errors
        if (decryptError.message?.includes('padding')) {
          return null;
        }
        // For other decryption errors, log but don't throw
        console.debug('Message decryption failed:', decryptError.message);
        return null;
      }

      return decrypted;
    } catch (err) {
      // Only log critical errors that aren't related to decryption
      if (!err.message?.includes('padding')) {
        console.error('Critical message handling error:', err);
      }
      return null;
    }
  }

  validateEvent(event) {
    try {
      return event && 
             typeof event === 'object' && 
             event.id && 
             event.pubkey && 
             event.created_at && 
             event.kind && 
             event.content;
    } catch (err) {
      console.error('Event validation failed:', err);
      return null;
    }
  }

  async handleIncomingMessage(event) {
    const decrypted = await this.decryptMessage(event);
    if (decrypted) {
      chrome.runtime.sendMessage({
        type: 'NEW_MESSAGE',
        data: {
          id: event.id,
          pubkey: event.pubkey,
          content: decrypted,
          created_at: event.created_at
        }
      });
      soundManager.play('message');
    }
  }

  cleanup() {
    this.subscriptions.forEach(sub => sub.unsub());
    this.subscriptions.clear();
    this.messageCache.clear();
  }

  async sendMessage(recipientPubkey, content) {
    const currentUser = await auth.getCurrentUser();
    if (!currentUser?.pubkey) {
      throw new Error('User not authenticated');
    }

    const messageKey = `${currentUser.pubkey}-${recipientPubkey}-${content}-${Date.now()}`;
    if (this.messageCache.has(messageKey)) {
      return this.messageCache.get(messageKey);
    }

    try {
      let encrypted;
      if (currentUser.type === 'NIP-07' && window.nostr?.nip04?.encrypt) {
        encrypted = await window.nostr.nip04.encrypt(recipientPubkey, content);
      } else if (currentUser.type === 'NSEC' && currentUser.privkey) {
        encrypted = await NostrTools.nip04.encrypt(
          currentUser.privkey,
          recipientPubkey,
          content
        );
      } else {
        throw new Error(`Unsupported login type: ${currentUser.type}`);
      }

      const event = {
        kind: 4,
        pubkey: currentUser.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', recipientPubkey]],
        content: encrypted
      };

      event.id = nostrCore.getEventHash(event);
      
      if (currentUser.type === 'NIP-07') {
        event.sig = await window.nostr.signEvent(event);
      } else {
        event.sig = nostrCore.getSignature(event, currentUser.privkey);
      }

      const result = {
        ...event,
        decrypted: content,
        timestamp: event.created_at * 1000
      };

      this.messageCache.set(messageKey, result);

      const relays = relayPool.getConnectedRelays();
      await Promise.race([
        this.pool.publish(relays, event),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Publish timeout')), 5000))
      ]);

      return result;
    } catch (error) {
      this.messageCache.delete(messageKey);
      throw error;
    }
  }
}

export const messageManager = new MessageManager();
export const sendMessage = messageManager.sendMessage.bind(messageManager);
export const receiveMessage = messageManager.handleIncomingMessage.bind(messageManager);
export const fetchMessages = messageManager.fetchMessages.bind(messageManager);

/**
 * @class MessageManager
 * @description Handles all message-related operations in the Nostr network
 * 
 * Core functionalities:
 * - Message encryption/decryption (NIP-04)
 * - Message caching
 * - Relay pool management
 * - Subscription handling
 * 
 * Message flow:
 * 1. Message composition
 * 2. Encryption
 * 3. Relay publishing
 * 4. Subscription management
 * 5. Decryption
 * 6. UI updates
 * 
 * @example
 * await messageManager.sendMessage(recipientPubkey, content);
 * const messages = await messageManager.fetchMessages(pubkey);
 */