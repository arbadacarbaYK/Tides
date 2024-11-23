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
      throw new Error("User not authenticated");
    }

    try {
      await relayPool.ensureConnection();
      const relays = relayPool.getConnectedRelays();
      
      const userPubkey = currentUser.pubkey.toLowerCase();
      const contactPubkey = pubkey.toLowerCase();
      
      const filters = [
        {
          kinds: [4],
          "#p": [contactPubkey],
          authors: [userPubkey]
        },
        {
          kinds: [4],
          "#p": [userPubkey],
          authors: [contactPubkey]
        }
      ];

      if (userPubkey === contactPubkey) {
        filters.length = 0;
        filters.push({
          kinds: [4],
          "#p": [userPubkey],
          authors: [userPubkey]
        });
      }

      const events = await this.pool.list(relays, filters);

      const messages = await Promise.all(
        events
          .filter(this.validateEvent)
          .sort((a, b) => a.created_at - b.created_at)
          .map(async event => {
            const decrypted = await this.decryptMessage(event);
            return decrypted ? {
              id: event.id,
              pubkey: event.pubkey,
              content: decrypted,
              timestamp: event.created_at * 1000,
              tags: event.tags
            } : null;
          })
      );

      return messages.filter(Boolean);
    } catch (error) {
      console.error("Error fetching messages:", error);
      throw error;
    }
  }

  async decryptMessage(event) {
    try {
      const currentUser = await auth.getCurrentUser();
      const privateKey = await auth.getPrivateKey();
      if (!privateKey) throw new Error('No private key available');
  
      let decrypted;
      const isOwnMessage = event.pubkey === currentUser.pubkey;
      
      if (privateKey === window.nostr) {
        decrypted = await window.nostr.nip04.decrypt(
          isOwnMessage ? event.tags.find(t => t[0] === 'p')?.[1] : event.pubkey,
          event.content
        );
      } else {
        decrypted = await NostrTools.nip04.decrypt(
          privateKey,
          isOwnMessage ? event.tags.find(t => t[0] === 'p')?.[1] : event.pubkey,
          event.content
        );
      }
  
      // First check if it's a market order
      try {
        const parsed = JSON.parse(decrypted);
        if (parsed.items && parsed.shipping_id) {
          return {
            type: 'market-order',
            content: parsed
          };
        }
      } catch {}
  
      // Then check for media links
      const mediaMatch = decrypted.match(/https?:\/\/[^\s<]+[^<.,:;"')\]\s](?:\.(?:jpg|jpeg|gif|png|mp4|webm|mov|ogg))/i);
      const urlMatch = decrypted.match(/https?:\/\/[^\s<]+/g);
      const textContent = decrypted.replace(mediaMatch?.[0] || '', '').trim();

      if (mediaMatch) {
        return {
          type: 'media',
          content: textContent || decrypted,
          mediaUrl: mediaMatch[0],
          urls: urlMatch?.filter(url => url !== mediaMatch[0]) || []
        };
      }
  
      // Check for URLs that might need preview
      if (urlMatch) {
        return {
          type: 'text',
          content: decrypted,
          urls: urlMatch,
          needsPreview: true
        };
      }
  
      // Regular text (may include emojis)
      return {
        type: 'text',
        content: decrypted
      };
  
    } catch (error) {
      console.error('Failed to decrypt message:', error);
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
    } catch (error) {
      console.error('Event validation failed:', error);
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

      event.id = NostrTools.getEventHash(event);
      if (currentUser.type === 'NIP-07') {
        event.sig = await window.nostr.signEvent(event);
      } else {
        event.sig = NostrTools.signEvent(event, currentUser.privkey);
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
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Publish timeout')), 5000)
        )
      ]);

      setTimeout(() => this.messageCache.delete(messageKey), 10000);
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

