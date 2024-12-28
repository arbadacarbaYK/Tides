var Background = (function(NostrTools) {
  'use strict';

  // Core dependencies initialization from NostrTools
  const nostrCore = {
    nip19: NostrTools.nip19,
    getPublicKey: NostrTools.getPublicKey,
    getEventHash: NostrTools.getEventHash,
    getSignature: NostrTools.getSignature
  };

  const pool = new NostrTools.SimplePool();
  const RELAYS = [
    "wss://relay.damus.io",
    "wss://relay.nostr.band",
    "wss://nos.lol",
    "wss://relay.snort.social",
    "wss://nostr.wine"
  ];

  // Utils
  const validateEvent = (event) => {
    try {
      return event && 'object' === typeof event && event.id && event.pubkey && 
             event.created_at && event.kind && event.content;
    } catch (error) {
      console.error('Event validation failed:', error);
      return null;
    }
  };

  const soundManager = new class {
    constructor() {
      this.sounds = new Map([
        ['login', chrome.runtime.getURL('sounds/login.mp3')],
        ['message', chrome.runtime.getURL('sounds/icq_message.mp3')]
      ]);
      this.played = new Set();
      this.enabled = true;
    }

    async play(type, once = false) {
      if (!this.enabled || (once && this.played.has(type))) return;
      const soundUrl = this.sounds.get(type);
      if (soundUrl) {
        try {
          const audio = new Audio(soundUrl);
          if (type === 'login') {
            audio.volume = 0.1;
          }
          await audio.play();
          if (once) this.played.add(type);
        } catch (error) {
          console.error(`Error playing ${type} sound:`, error);
        }
      }
    }
  };

  // State management
  let currentSubscription = null;
  const contacts = new Map();
  const messageManager = new class {
    constructor() {
      this.subscriptions = new Map();
      this.messageCache = new Map();
    }

    async handleIncomingMessage(event) {
      const decryptedContent = await this.decryptMessage(event);
      if (decryptedContent) {
        chrome.runtime.sendMessage({
          type: 'NEW_MESSAGE',
          data: {
            id: event.id,
            pubkey: event.pubkey,
            content: decryptedContent,
            created_at: event.created_at
          }
        });
        soundManager.play('message');
      }
    }

    async decryptMessage(event) {
      // Your existing decryption logic
    }
  };

  // Add auth class before Service Worker Event Listeners
  const auth = new class {
    constructor() {
      this.currentUser = null;
    }

    async init() {
      const credentials = await this.getStoredCredentials();
      if (credentials) {
        this.currentUser = credentials;
        return credentials;
      }
      return null;
    }

    async getCurrentUser() {
      return this.currentUser || await this.getStoredCredentials();
    }

    async getStoredCredentials() {
      try {
        const { currentUser } = await chrome.storage.local.get('currentUser');
        return currentUser || null;
      } catch (error) {
        console.error('Failed to get stored credentials:', error);
        return null;
      }
    }

    async login(method, key) {
      try {
        let credentials;
        if (method === 'NIP-07') {
          credentials = await this.loginWithNIP07();
        } else if (method === 'NSEC') {
          credentials = await this.loginWithNSEC(key);
        } else {
          throw new Error('Invalid login method');
        }

        if (credentials) {
          await this.storeCredentials(credentials);
          soundManager.play('login');
        }
        return credentials;
      } catch (error) {
        console.error('Login failed:', error);
        throw error;
      }
    }

    async loginWithNIP07() {
      try {
        // Check if NIP-07 extension exists in extension context
        if (typeof window?.nostr === 'undefined') {
          throw new Error('No Nostr extension found. Please install Alby or nos2x.');
        }

        // Test if we can actually get permissions
        await window.nostr.enable();
        
        // Get public key
        const pubkey = await window.nostr.getPublicKey();
        
        // Verify we can sign (this confirms the extension is working)
        const testEvent = {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: 'test'
        };
        
        try {
          await window.nostr.signEvent(testEvent);
        } catch (e) {
          throw new Error('Nostr extension cannot sign events. Please check its permissions.');
        }

        const npub = nostrCore.nip19.npubEncode(pubkey);
        return {
          type: 'NIP-07',
          pubkey: pubkey.toLowerCase(),
          npub,
          displayId: npub.slice(0, 8) + '...' + npub.slice(-4)
        };
      } catch (error) {
        console.error('NIP-07 login failed:', error);
        throw error;
      }
    }

    async loginWithNSEC(nsec) {
      try {
        const { type, data: privkey } = nostrCore.nip19.decode(nsec);
        if (type !== 'nsec') throw new Error('Invalid nsec format');
        const pubkey = nostrCore.getPublicKey(privkey);
        const npub = nostrCore.nip19.npubEncode(pubkey);
        return {
          type: 'NSEC',
          pubkey,
          privkey,
          npub,
          displayId: npub.slice(0, 8) + '...' + npub.slice(-4)
        };
      } catch (error) {
        throw error;
      }
    }

    async storeCredentials(credentials) {
      if (!credentials?.pubkey) throw new Error('Invalid credentials format');
      this.currentUser = credentials;
      await chrome.storage.local.set({
        currentUser: credentials,
        [`credentials:${credentials.pubkey}`]: credentials
      });
      return credentials;
    }
  };

  // Service Worker Event Listeners
  self.addEventListener('install', async (event) => {
    console.log('Service Worker installing.');
    event.waitUntil(self.skipWaiting());
  });

  self.addEventListener('activate', async (event) => {
    console.log('Service Worker activated.');
    event.waitUntil(Promise.all([
      clients.claim(),
      auth.init()
    ]));
  });

  self.addEventListener('message', async (event) => {
    const { type, data } = event.data;
    
    if (type === 'LOGIN_SUCCESS') {
      const user = await auth.getCurrentUser();
      if (user) {
        try {
          await relayPool.ensureConnection();
          
          if (currentSubscription) {
            currentSubscription.unsub();
          }

          // First fetch existing data
          const contacts = await fetchContacts(user.pubkey);
          if (contacts.length > 0) {
            setContacts(contacts);
            chrome.runtime.sendMessage({
              type: 'CONTACTS_UPDATED',
              data: contacts
            });
          }

          // Then set up live subscriptions
          currentSubscription = pool.sub(
            RELAYS.map(relay => ({
              relay,
              filter: [
                { kinds: [3], authors: [user.pubkey] },
                { kinds: [0], authors: [user.pubkey] },
                { kinds: [4], '#p': [user.pubkey] },
                { kinds: [9735], '#p': [user.pubkey] },
                { kinds: [42], '#e': user.channelIds },
                { kinds: [30311], '#p': [user.pubkey] }
              ]
            }))
          );

          currentSubscription.on('event', async (event) => {
            if (validateEvent(event)) {
              console.log('Received event:', event);
              if (event.kind === 0) {
                const metadata = JSON.parse(event.content);
                await storeMetadata(event.pubkey, metadata);
              } else if (event.kind === 3) {
                const contacts = await processContactEvent(event);
                setContacts(contacts);
                chrome.runtime.sendMessage({
                  type: 'CONTACTS_UPDATED',
                  data: contacts
                });
              } else if (event.kind === 4) {
                await messageManager.handleIncomingMessage(event);
              } else if (event.kind === 9735) {
                const zapAmount = event.tags.find(t => t[0] === 'amount')?.[1];
                const messageId = event.tags.find(t => t[0] === 'e')?.[1];
                if (zapAmount && messageId) {
                  chrome.runtime.sendMessage({
                    type: 'ZAP_RECEIVED',
                    data: { messageId, amount: parseInt(zapAmount) }
                  });
                }
              } else if (event.kind === 30311) {
                const streamMetadata = JSON.parse(event.content);
                const streamId = event.tags.find(t => t[0] === 'd')?.[1];
                if (streamId) {
                  const streamData = {
                    pubkey: event.pubkey,
                    displayName: streamMetadata.title || 'Unnamed Stream',
                    isChannel: true,
                    avatarUrl: streamMetadata.image || '/icons/default-avatar.png',
                    streamUrl: streamId,
                    embedUrl: `https://zap.stream/embed/${streamId}`,
                    about: streamMetadata.description
                  };
                  
                  chrome.runtime.sendMessage({
                    type: 'STREAM_UPDATED',
                    data: streamData
                  });
                }
              }
            }
          });

          soundManager.play('login', true);
          
          chrome.runtime.sendMessage({
            type: 'INIT_COMPLETE',
            data: { user }
          });
        } catch (error) {
          console.error('Error during initialization:', error);
          chrome.runtime.sendMessage({
            type: 'INIT_ERROR',
            error: error.message
          });
        }
      }
    }
  });

  // Add this to your message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_ZAP_INVOICE') {
      (async () => {
        try {
          const { lightningAddress, amount, zapRequest } = message.data;
          
          let lightningUrl;
          if (lightningAddress.includes('@')) {
            const [name, domain] = lightningAddress.split('@');
            lightningUrl = `https://${domain}/.well-known/lnurlp/${name}`;
          } else {
            lightningUrl = lightningAddress;
          }

          // Get LNURL data with proper headers
          const response = await fetch(lightningUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });
          
          if (!response.ok) throw new Error('Failed to fetch lightning address info');
          const lnurlData = await response.json();
          
          // Get invoice with proper headers
          const callbackUrl = new URL(lnurlData.callback);
          callbackUrl.search = new URLSearchParams({
            amount: amount * 1000,
            nostr: JSON.stringify(zapRequest)
          }).toString();
          
          const invoiceResponse = await fetch(callbackUrl.toString(), {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });
          
          if (!invoiceResponse.ok) throw new Error('Failed to generate invoice');
          const { pr: invoice } = await invoiceResponse.json();
          
          sendResponse({ invoice });
        } catch (error) {
          console.error('Zap invoice error:', error);
          sendResponse({ error: error.message });
        }
      })();
      return true;
    }
  });

  // Public API
  return {
    updateContactStatus: function(pubkey, isOnline) {
      const contact = contacts.get(pubkey);
      if (contact) {
        contact.isOnline = isOnline;
        chrome.runtime.sendMessage({
          type: 'contactStatusUpdated',
          pubkey,
          isOnline
        });
      }
    },
    messageManager,
    soundManager,
    pool,
    contacts,
    auth
  };

})(NostrTools);
