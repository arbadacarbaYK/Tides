import { pool, RELAYS, nostrCore, relayPool, pubkeyToNpub } from './shared.js';
import { auth } from './auth.js';
import { validateEvent } from './utils.js';
// NostrTools is loaded via script tag in popup.html

export class MessageManager {
  constructor() {
    this.messageCache = new Map();
    this.currentChatPubkey = null;
    this.currentSubscription = null;
    this.pool = pool;
    // Track peers that have been seen using NIP-17 (kind 14)
    this.peerSupportsNip17 = new Set();
  }

  async init(pubkey) {
    this.currentChatPubkey = pubkey;
    
    if (this.currentSubscription) {
      this.currentSubscription.unsub();
    }

    const currentUser = await auth.getCurrentUser();
    if (!currentUser) return;

    const filter = {
      kinds: [4, 14],
      '#p': [currentUser.pubkey],
      since: Math.floor(Date.now() / 1000) - 1
    };

    // Prefer user's DM relay set (kind 10050); fallback to default RELAYS
    let liveRelays = [];
    try {
      const userDmRelays = await this.getUserRelays(currentUser.pubkey.toLowerCase());
      liveRelays = (userDmRelays || []).filter(u => typeof u === 'string' && u.startsWith('wss://')).slice(0, 15);
    } catch (_) {}
    const subRelays = (liveRelays && liveRelays.length > 0) ? liveRelays : RELAYS;

    // Establish connections only to these relays for this subscription
    try { await relayPool.ensureSpecificConnections(subRelays); } catch (_) {}
    // Use only relays that are actually connected; fallback to defaults
    let activeSubRelays = (relayPool.getConnectedRelays() || []).filter(r => subRelays.includes(r));
    if (!activeSubRelays || activeSubRelays.length === 0) {
      activeSubRelays = (relayPool.getConnectedRelays() || RELAYS).slice(0, 15);
    }
    this.currentSubscription = this.pool.sub(activeSubRelays, [filter]);
    this.currentSubscription.on('event', async (event) => {
      if (this.validateEvent ? this.validateEvent(event) : true) {
        const otherPubkey = event.pubkey === currentUser.pubkey ? 
          event.tags.find(t => t[0] === 'p')?.[1] : event.pubkey;
        if (event.kind === 14 && otherPubkey) {
          this.peerSupportsNip17.add(otherPubkey);
        }
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
    // Prefer receiver's DM relays for delivery, also include sender's DM relays
    const self = (await auth.getCurrentUser()).pubkey.toLowerCase();
    let senderDm = [];
    let receiverDm = [];
    try {
      senderDm = await this.getUserRelays(self);
      receiverDm = await this.getUserRelays(pubkey.toLowerCase());
    } catch (_) {}
    const relays = [...new Set([...(receiverDm || []), ...(senderDm || []), ...relayPool.getConnectedRelays()])]
      .filter(u => typeof u === 'string' && u.startsWith('wss://'))
      .slice(0, 20);
    if (!relays || relays.length === 0) {
      throw new Error('No connected relays available');
    }

    // Attempt to send as NIP-17 (kind 14) first if peer supports it; fallback to kind 4
    const preferKind14 = this.peerSupportsNip17.has(pubkey);

    const sendKind14 = async () => {
      const event14 = {
        kind: 14,
        pubkey: currentUser.pubkey,
        content: message,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', pubkey], ['client', 'tides']]
      };
      event14.id = NostrTools.getEventHash(event14);
      if (currentUser.type === 'NIP-07') {
        event14.sig = await window.nostr.signEvent(event14);
      } else {
        event14.sig = NostrTools.getSignature(event14, currentUser.privkey);
      }
      await this.publishToAnyRelay(relays, event14);
      return event14;
    };

    const sendKind4 = async () => {
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
      const event4 = {
        kind: 4,
        pubkey: currentUser.pubkey,
        content: encryptedContent,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', pubkey], ['client', 'tides']]
      };
      event4.id = NostrTools.getEventHash(event4);
      if (currentUser.type === 'NIP-07') {
        event4.sig = await window.nostr.signEvent(event4);
      } else {
        event4.sig = NostrTools.getSignature(event4, currentUser.privkey);
      }
      await this.publishToAnyRelay(relays, event4);
      return event4;
    };

    let sentEvent;
    try {
      sentEvent = preferKind14 ? await sendKind14() : await sendKind4();
    } catch (e) {
      // fallback between kinds
      sentEvent = preferKind14 ? await sendKind4() : await sendKind14();
    }

    const dmMessage = {
      id: sentEvent.id,
      pubkey: sentEvent.pubkey,
      content: message,
      created_at: sentEvent.created_at,
      tags: sentEvent.tags,
      type: 'dm',
      recipientPubkey: pubkey
    };

    await this.storeMessage(dmMessage);
    return dmMessage;
  }

  async publishToAnyRelay(relays, event) {
    let publishedToAny = false;
    const errors = [];
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
      }
    }
    if (!publishedToAny) {
      if (errors.length > 0) throw new Error(`Failed to publish message: ${errors.join(', ')}`);
      throw new Error('Failed to publish message to any relay');
    }
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

      // If this pubkey is the actively opened chat, allow wider DM relay logic; otherwise keep it lightweight
      const isActiveChat = (this.currentChatPubkey || '').toLowerCase() === targetPubkey;

      // Discover relay sets per NIP-17: own 10050 for default, peer 10050 reserved for backfill (active chat only)
      let extraRelays = [];
      let peerRelaySet = [];
      try {
        const userRelays = await this.getUserRelays(userPubkey);
        extraRelays = [...new Set([...(userRelays || [])])];
        if (isActiveChat) {
          const peerRelays = await this.getUserRelays(targetPubkey);
          peerRelaySet = [...new Set([...(peerRelays || [])])];
        }
      } catch (_) {}
      const allRelays = [...new Set([...(connectedRelays || []), ...extraRelays])]
        .filter(url => typeof url === 'string' && url.startsWith('wss://'));
      const queryRelays = isActiveChat ? allRelays.slice(0, 20) : (connectedRelays || []).slice(0, 10);

      // Handle self-messages first
      if (userPubkey === targetPubkey) {
        const filters = [{
          kinds: [4, 14],
          authors: [userPubkey],
          '#p': [userPubkey]
        }];

        let events = await this.pool.list(queryRelays, filters);
        const seen = new Set();
        events = events.filter(e => (e?.id && !seen.has(e.id)) ? (seen.add(e.id), true) : false);
        const messages = await Promise.all(
          events
            .filter(event => {
              // Additional validation for DMs (accept kind 4 and 14)
              if (event.kind !== 4 && event.kind !== 14) return false;
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

      // Use targeted filters for this specific conversation
      const filters = [
        {
          kinds: [4, 14],
          authors: [userPubkey],
          '#p': [targetPubkey]  // DMs from current user TO target
        },
        {
          kinds: [4, 14],
          authors: [targetPubkey],
          '#p': [userPubkey]   // DMs from target TO current user
        }
      ];

      // Ensure connections to these specific relays to avoid broad fanout
      if (isActiveChat) { try { await relayPool.ensureSpecificConnections(queryRelays); } catch (_) {} }
      const activeQueryRelays = (relayPool.getConnectedRelays() || []).filter(r => queryRelays.includes(r));
      const relaysToUse = activeQueryRelays.length > 0 ? activeQueryRelays : queryRelays;
      let events = await Promise.race([
        this.pool.list(relaysToUse, filters),
        new Promise(resolve => setTimeout(() => resolve([]), isActiveChat ? 2500 : 1200))
      ]);
      console.log(`Found ${events.length} DM messages for ${pubkey}`);
      const seenIds = new Set();
      events = events.filter(e => (e?.id && !seenIds.has(e.id)) ? (seenIds.add(e.id), true) : false);

      // Lightweight backfill for kind 14 if none returned yet
      const hasKind14 = events.some(e => e.kind === 14);
      if (isActiveChat && !hasKind14) {
        const now = Math.floor(Date.now() / 1000);
        const since30 = now - 30 * 24 * 60 * 60;
        const backfillFilters30 = [
          { kinds: [14], authors: [userPubkey], '#p': [targetPubkey], since: since30, limit: 200 },
          { kinds: [14], authors: [targetPubkey], '#p': [userPubkey], since: since30, limit: 200 }
        ];
        try {
          const backfill30 = await Promise.race([
            this.pool.list(relaysToUse, backfillFilters30),
            new Promise(resolve => setTimeout(() => resolve([]), 2500))
          ]);
          if (backfill30?.length) {
            for (const e of backfill30) { if (e?.id && !seenIds.has(e.id)) { seenIds.add(e.id); events.push(e); } }
          } else {
            const peerRelaysLimited = (peerRelaySet || []).filter(u => typeof u === 'string' && u.startsWith('wss://')).slice(0, 6);
            if (peerRelaysLimited.length > 0) {
              try { await relayPool.ensureSpecificConnections(peerRelaysLimited); } catch (_) {}
              try {
                const backfill30Peer = await Promise.race([
                  this.pool.list(peerRelaysLimited, backfillFilters30),
                  new Promise(resolve => setTimeout(() => resolve([]), 2500))
                ]);
                if (backfill30Peer?.length) {
                  for (const e of backfill30Peer) { if (e?.id && !seenIds.has(e.id)) { seenIds.add(e.id); events.push(e); } }
                }
              } catch (_) {}
            }
            const since90 = now - 90 * 24 * 60 * 60;
            const backfillFilters90 = [
              { kinds: [14], authors: [userPubkey], '#p': [targetPubkey], since: since90, limit: 200 },
              { kinds: [14], authors: [targetPubkey], '#p': [userPubkey], since: since90, limit: 200 }
            ];
            const backfill90 = await Promise.race([
              this.pool.list(relaysToUse, backfillFilters90),
              new Promise(resolve => setTimeout(() => resolve([]), 2500))
            ]);
            if (backfill90?.length) {
              for (const e of backfill90) { if (e?.id && !seenIds.has(e.id)) { seenIds.add(e.id); events.push(e); } }
            } else {
              if (peerRelaysLimited && peerRelaysLimited.length > 0) {
                try { await relayPool.ensureSpecificConnections(peerRelaysLimited); } catch (_) {}
                try {
                  const backfill90Peer = await Promise.race([
                    this.pool.list(peerRelaysLimited, backfillFilters90),
                    new Promise(resolve => setTimeout(() => resolve([]), 2500))
                  ]);
                  if (backfill90Peer?.length) {
                    for (const e of backfill90Peer) { if (e?.id && !seenIds.has(e.id)) { seenIds.add(e.id); events.push(e); } }
                  }
                } catch (_) {}
              }
              // Final deep backfill up to 365 days, include both kinds just in case
              const since365 = now - 365 * 24 * 60 * 60;
              const deepFilters = [
                { kinds: [4, 14], authors: [userPubkey], '#p': [targetPubkey], since: since365, limit: 800 },
                { kinds: [4, 14], authors: [targetPubkey], '#p': [userPubkey], since: since365, limit: 800 }
              ];
              try {
                const deep = await Promise.race([
                  this.pool.list(relaysToUse, deepFilters),
                  new Promise(resolve => setTimeout(() => resolve([]), 3000))
                ]);
                if (deep?.length) {
                  for (const e of deep) { if (e?.id && !seenIds.has(e.id)) { seenIds.add(e.id); events.push(e); } }
                }
                if (peerRelaysLimited && peerRelaysLimited.length > 0) {
                  try { await relayPool.ensureSpecificConnections(peerRelaysLimited); } catch (_) {}
                  try {
                    const deepPeer = await Promise.race([
                      this.pool.list(peerRelaysLimited, deepFilters),
                      new Promise(resolve => setTimeout(() => resolve([]), 3000))
                    ]);
                    if (deepPeer?.length) {
                      for (const e of deepPeer) { if (e?.id && !seenIds.has(e.id)) { seenIds.add(e.id); events.push(e); } }
                    }
                  } catch (_) {}
                }
              } catch (_) {}
            }
          }
        } catch (_) {
          // ignore backfill errors to avoid slowing UI
        }
      }

      // Process and decrypt messages
      const messages = await Promise.all(
        events
          .filter(event => {
            // Basic validation - filters are already targeted; accept kind 4 and 14
            if (event.kind !== 4 && event.kind !== 14) return false;

            // Validate this is a proper DM with at least one 'p' tag
            const pTags = event.tags.filter(t => t[0] === 'p');
            if (pTags.length === 0) return false;

            const authorPubkey = event.pubkey.toLowerCase();
            const pRecipients = pTags.map(t => (t[1] || '').toLowerCase());

            // Accept messages where author is user and any 'p' equals target, or vice versa
            const isValidConversation = (
              (authorPubkey === userPubkey && pRecipients.includes(targetPubkey)) ||
              (authorPubkey === targetPubkey && pRecipients.includes(userPubkey))
            );

            if (!isValidConversation) {
              return false;
            }

            return true;
          })
          .sort((a, b) => a.created_at - b.created_at)
          .map(async (event) => {
            const decrypted = await this.decryptMessage(event);
            if (!decrypted) return null;

            // Filter out JSON/structured messages (nostrmarket spam) AFTER decryption
            try {
              const parsed = JSON.parse(decrypted);
              if (parsed && typeof parsed === 'object' && (parsed.type !== undefined || parsed.items || parsed.address !== undefined)) {
                return null;
              }
            } catch (e) {
              // Not JSON, continue with normal DM processing
            }

            // Pick a reasonable recipient: the other participant in this 1:1 conversation
            const pRecipients = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
            const authorIsUser = event.pubkey.toLowerCase() === userPubkey;
            const recipient = authorIsUser
              ? (pRecipients.find(p => p.toLowerCase() === targetPubkey) || pRecipients[0])
              : (pRecipients.find(p => p.toLowerCase() === userPubkey) || pRecipients[0]);

            // Add DM-specific attributes
            return {
              id: event.id,
              pubkey: event.pubkey,
              content: decrypted,
              created_at: event.created_at,
              tags: event.tags,
              type: 'dm',
              recipientPubkey: recipient
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
      
      // Handle NIP-59 Gift Wraps (kind 1059): unwrap to inner kind 13 seal and decrypt kind 14
      if (event.kind === 1059) {
        try {
          // content is a nip44-encrypted JSON Seal (kind 13) addressed via 'p' tag
          // Try decrypt with NIP-44 first (sender unknown yet)
          let unwrappedSealJson = null;
          if (currentUser?.type === 'NIP-07' && window.nostr?.nip44?.decrypt) {
            unwrappedSealJson = await window.nostr.nip44.decrypt(event.pubkey, event.content);
          } else if (nostrCore.nip44?.decrypt && privateKey) {
            unwrappedSealJson = await nostrCore.nip44.decrypt(privateKey, event.pubkey, event.content);
          }
          if (unwrappedSealJson) {
            try {
              const seal = JSON.parse(unwrappedSealJson);
              if (seal && seal.kind === 13 && typeof seal.content === 'string') {
                // The inner content is the encrypted unsigned kind 14 message; decrypt it using NIP-44
                if (currentUser?.type === 'NIP-07' && window.nostr?.nip44?.decrypt) {
                  return await window.nostr.nip44.decrypt(event.pubkey, seal.content);
                }
                if (nostrCore.nip44?.decrypt && privateKey) {
                  return await nostrCore.nip44.decrypt(privateKey, event.pubkey, seal.content);
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
        return null;
      }

      if (!currentUser) return null;
      if (event.kind === 14) {
        // Try NIP-44 decrypt first; if it fails, treat as plaintext
        try {
          if (currentUser.type === 'NIP-07' && window.nostr?.nip44?.decrypt) {
            return await window.nostr.nip44.decrypt(event.pubkey, event.content);
          }
          if (nostrCore.nip44?.decrypt) {
            return await nostrCore.nip44.decrypt(privateKey, event.pubkey, event.content);
          }
        } catch (_) {}
        return event.content || '';
      }
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

      const counterpartPubkey = isSent ? recipientPubkey : event.pubkey;

      // First try standard NIP-04 decryption
      try {
        if (currentUser.type === 'NIP-07') {
          return await window.nostr.nip04.decrypt(counterpartPubkey, event.content);
        } else {
          return await NostrTools.nip04.decrypt(privateKey, counterpartPubkey, event.content);
        }
      } catch (_) {
        // If NIP-04 fails, try NIP-44 versioned encryption as a fallback
        try {
          if (currentUser.type === 'NIP-07' && window.nostr?.nip44?.decrypt) {
            return await window.nostr.nip44.decrypt(counterpartPubkey, event.content);
          }
          if (nostrCore.nip44?.decrypt) {
            return await nostrCore.nip44.decrypt(privateKey, counterpartPubkey, event.content);
          }
        } catch (_) {
          // fall through to return null below
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async handleIncomingMessage(event) {
    try {
      if (event.kind === 14) {
        const other = event.tags.find(t => t[0] === 'p')?.[1] || null;
        if (other) this.peerSupportsNip17.add(other);
      }
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

  async getUserRelays(pubkey) {
    try {
      // Fetch user's relay list prioritizing NIP-17 kind 10050 (DM relays), then NIP-65 10002, then kind 3
      const filters = [
        { kinds: [10050], authors: [pubkey], limit: 1 },
        { kinds: [10002], authors: [pubkey], limit: 1 },
        { kinds: [3], authors: [pubkey], limit: 1 }
      ];

      const events = await this.pool.list(relayPool.getConnectedRelays(), filters);
      const relays = [];

      for (const event of events) {
        if (event.kind === 10050) {
          event.tags.forEach(tag => {
            if (tag[0] === 'r' && tag[1]) {
              relays.push(tag[1]);
            }
          });
          continue;
        }
        if (event.kind === 10002) {
          // NIP-65 relay list
          event.tags.forEach(tag => {
            if (tag[0] === 'r' && tag[1]) {
              relays.push(tag[1]);
            }
          });
        } else if (event.kind === 3) {
          // Contact list - check for relay URLs in content
          try {
            const content = JSON.parse(event.content || '{}');
            Object.keys(content).forEach(url => {
              if (url.startsWith('wss://') || url.startsWith('ws://')) {
                relays.push(url);
              }
            });
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }

      return [...new Set(relays)]; // Remove duplicates
    } catch (error) {
      console.warn(`Failed to fetch relays for user ${pubkey.slice(0,8)}:`, error);
      return [];
    }
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

