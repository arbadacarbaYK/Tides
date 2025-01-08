import { pool, RELAYS, nostrCore, relayPool } from './shared.js';
import { auth } from './auth.js';
import { validateEvent } from './utils.js';
import NostrTools from 'nostr-tools';

export class MessageManager {
  constructor() {
    this.messageCache = new Map();
    this.currentChatPubkey = null;
    this.currentSubscription = null;
    this.pool = pool;
  }

  async init(pubkey) {
    this.currentChatPubkey = pubkey;
    
    if (this.currentSubscription) {
      this.currentSubscription.unsub();
    }

    const currentUser = await auth.getCurrentUser();
    if (!currentUser) return;

    const filter = {
      kinds: [4],
      '#p': [currentUser.pubkey],
      since: Math.floor(Date.now() / 1000) - 1
    };

    this.currentSubscription = this.pool.sub(RELAYS, [filter]);
    this.currentSubscription.on('event', async (event) => {
      if (this.validateEvent(event)) {
        const otherPubkey = event.pubkey === currentUser.pubkey ? 
          event.tags.find(t => t[0] === 'p')?.[1] : event.pubkey;
        
        if (otherPubkey === this.currentChatPubkey) {
          await this.handleIncomingMessage(event);
        }
      }
    });

    return this.fetchMessages(pubkey);
  }

  async cleanup() {
    if (this.currentSubscription) {
      this.currentSubscription.unsub();
      this.currentSubscription = null;
    }
    this.currentChatPubkey = null;
  }

  async sendMessage(pubkey, message) {
    const currentUser = await auth.getCurrentUser();
    if (!currentUser?.pubkey) {
      throw new Error('User not authenticated');
    }

    await relayPool.ensureConnection();
    const relays = relayPool.getConnectedRelays();
    if (!relays || relays.length === 0) {
      throw new Error('No connected relays available');
    }

    let encryptedContent;
    try {
      if (currentUser.type === 'NIP-07') {
        encryptedContent = await window.nostr.nip04.encrypt(pubkey, message);
      } else {
        encryptedContent = await NostrTools.nip04.encrypt(currentUser.privkey, pubkey, message);
      }
    } catch (error) {
      throw new Error('Failed to encrypt message');
    }

    const event = {
      kind: 4,
      pubkey: currentUser.pubkey,
      content: encryptedContent,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', pubkey], ['client', 'tides']]
    };

    // Sign the event
    try {
      event.id = NostrTools.getEventHash(event);
      if (currentUser.type === 'NIP-07') {
        event.sig = await window.nostr.signEvent(event);
      } else {
        event.sig = NostrTools.getSignature(event, currentUser.privkey);
      }
    } catch (error) {
      throw new Error('Failed to sign message');
    }

    let publishedToAny = false;
    const errors = [];

    // Try each relay sequentially to avoid multiple error reports
    for (const relay of relays) {
      try {
        await this.pool.publish([relay], event);
        publishedToAny = true;
        break;
      } catch (err) {
        if (!err.message?.includes('no active subscription') && 
            !err.message?.includes('restricted')) {
          errors.push(`${relay}: ${err.message}`);
        }
        continue;
      }
    }

    if (!publishedToAny) {
      if (errors.length > 0) {
        throw new Error(`Failed to publish message: ${errors.join(', ')}`);
      }
      throw new Error('Failed to publish message to any relay');
    }
    
    const dmMessage = {
      id: event.id,
      pubkey: event.pubkey,
      content: message,
      created_at: event.created_at,
      tags: event.tags,
      type: 'dm',
      recipientPubkey: pubkey
    };

    // Store the message immediately
    await this.storeMessage(dmMessage);
    return dmMessage;
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

      // Handle self-messages first
      if (userPubkey === targetPubkey) {
        const filters = [{
          kinds: [4],
          authors: [userPubkey],
          '#p': [userPubkey]
        }];

        const events = await this.pool.list(connectedRelays, filters);
        const messages = await Promise.all(
          events
            .filter(event => {
              // Additional validation for DMs
              if (event.kind !== 4) return false;
              // Must have exactly one p tag for recipient
              const pTags = event.tags.filter(t => t[0] === 'p');
              if (pTags.length !== 1) return false;
              // For self-messages, author must be same as recipient
              if (pTags[0][1].toLowerCase() !== event.pubkey.toLowerCase()) return false;
              return true;
            })
            .sort((a, b) => a.created_at - b.created_at)
            .map(async (event) => {
              const decrypted = await this.decryptMessage(event);
              if (!decrypted) return null;
              
              // Add DM-specific attributes
              return {
                id: event.id,
                pubkey: event.pubkey,
                content: decrypted,
                created_at: event.created_at,
                tags: event.tags,
                type: 'dm',
                recipientPubkey: event.tags.find(t => t[0] === 'p')?.[1]
              };
            })
        );

        return messages.filter(Boolean);
      }

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

      const events = await this.pool.list(connectedRelays, filters);
      console.log(`Found ${events.length} DM messages for ${pubkey}`);

      // Process and decrypt messages
      const messages = await Promise.all(
        events
          .filter(event => {
            // Additional validation for DMs
            if (event.kind !== 4) return false;
            // Must have exactly one p tag for recipient
            const pTags = event.tags.filter(t => t[0] === 'p');
            if (pTags.length !== 1) return false;
            return true;
          })
          .sort((a, b) => a.created_at - b.created_at)
          .map(async (event) => {
            const decrypted = await this.decryptMessage(event);
            if (!decrypted) return null;
            
            // Add DM-specific attributes
            return {
              id: event.id,
              pubkey: event.pubkey,
              content: decrypted,
              created_at: event.created_at,
              tags: event.tags,
              type: 'dm',
              recipientPubkey: event.tags.find(t => t[0] === 'p')?.[1]
            };
          })
      );

      return messages.filter(Boolean);
    } catch (err) {
      throw new Error('Failed to fetch messages');
    }
  }

  async decryptMessage(event) {
    try {
      const currentUser = await auth.getCurrentUser();
      const privateKey = await auth.getPrivateKey();
      
      if (!currentUser) return null;
      if (!privateKey) {
        throw new Error('No private key available');
      }

      const isSent = event.pubkey === currentUser.pubkey;
      
      // Get recipient pubkey from tags
      const recipientPubkey = isSent 
        ? event.tags.find(tag => tag[0] === 'p')?.[1] 
        : event.pubkey;
        
      if (!recipientPubkey) {
        throw new Error('No recipient pubkey found in tags');
      }

      let decrypted;
      if (currentUser.type === 'NIP-07') {
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

      return decrypted;
    } catch (error) {
      return null;
    }
  }

  async handleIncomingMessage(event) {
    try {
      const decrypted = await this.decryptMessage(event);
      if (!decrypted) return;

      const message = {
        id: event.id,
        pubkey: event.pubkey,
        content: decrypted,
        created_at: event.created_at,
        tags: event.tags,
        type: 'dm',
        recipientPubkey: event.tags.find(t => t[0] === 'p')?.[1]
      };

      await this.storeMessage(message);
      return message;
    } catch (error) {
      return null;
    }
  }

  async storeMessage(message) {
    if (!message.type || message.type !== 'dm') {
      throw new Error('Invalid message type. Only DMs can be stored here.');
    }

    if (!message.recipientPubkey) {
      throw new Error('Missing recipient pubkey for DM');
    }

    // Store in message cache with both sender and recipient keys
    const key = `${message.pubkey}_${message.recipientPubkey}`;
    const reverseKey = `${message.recipientPubkey}_${message.pubkey}`;
    
    // Store message under both keys to ensure it appears in both directions
    [key, reverseKey].forEach(k => {
      if (!this.messageCache.has(k)) {
        this.messageCache.set(k, []);
      }
      if (!this.messageCache.get(k).some(m => m.id === message.id)) {
        this.messageCache.get(k).push(message);
        this.messageCache.get(k).sort((a, b) => a.created_at - b.created_at);
      }
    });
  }
}

export const messageManager = new MessageManager();
export const sendMessage = messageManager.sendMessage.bind(messageManager);
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

