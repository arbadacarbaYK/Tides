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
        // Update last message time for the contact
        contactManager.updateLastMessageTime(event.pubkey, event.created_at);

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
            
            // Fetch metadata for all contacts before sending updates
            console.log('Fetching metadata for all contacts...');
            await Promise.all(contacts.map(async (contact) => {
              try {
                const metadata = await getUserMetadata(contact.pubkey);
                if (metadata) {
                  contact.displayName = metadata.name || metadata.displayName || contact.displayName;
                  contact.avatarUrl = metadata.picture || contact.avatarUrl;
                  contact.lightning = metadata.lud16 || metadata.lud06;
                  
                  // Store metadata in cache
                  await cacheMetadata(contact.pubkey, metadata);
                }
              } catch (error) {
                console.error(`Error fetching metadata for ${contact.pubkey}:`, error);
              }
            }));

            // Now send the contacts update with metadata
            chrome.runtime.sendMessage({
              type: 'CONTACTS_UPDATED',
              data: contacts
            });
          }

          // Then set up live subscriptions for future updates
          const filters = [
            { kinds: [0], authors: contacts.map(c => c.pubkey) }, // Metadata for all contacts
            { kinds: [3], authors: [user.pubkey] }, // Contact list
            { kinds: [4], '#p': [user.pubkey] }, // DMs
            { kinds: [9735], '#p': [user.pubkey] }, // Zaps
            { kinds: [30311], '#p': [user.pubkey] } // Streams
          ];

          currentSubscription = pool.sub(
            RELAYS.map(relay => ({
              relay,
              filter: filters
            }))
          );

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
          
          if (!lightningAddress) {
            sendResponse({ error: 'No lightning address provided' });
            return;
          }

          // Block ln.tips immediately and return
          if (lightningAddress.toLowerCase().includes('@ln.tips')) {
            sendResponse({ 
              error: 'This lightning address provider (ln.tips) is no longer available. Please ask the user for an updated lightning address.'
            });
            return;
          }

          // Rest of the zap invoice logic only runs if not ln.tips
          console.log('Starting zap request with:', {
            lightningAddress,
            amount,
            zapRequest
          });

          if (!amount || isNaN(parseInt(amount)) || amount <= 0) {
            sendResponse({ error: 'Invalid amount' });
            return;
          }

          // Validate zapRequest
          if (!zapRequest || !zapRequest.pubkey || !zapRequest.tags) {
            sendResponse({ error: 'Invalid zap request format' });
            return;
          }
          
          // Get LNURL endpoint
          const lnurlEndpoint = await getLNURLFromAddress(lightningAddress);
          
          if (lnurlEndpoint) {
            console.log('LNURL endpoint:', lnurlEndpoint);

            // First request: Get LNURL data
            console.log('Fetching LNURL data from:', lnurlEndpoint);
            const lnurlResponse = await fetch(lnurlEndpoint);
            
            console.log('LNURL Response Status:', lnurlResponse.status);
            
            if (!lnurlResponse.ok) {
              const errorText = await lnurlResponse.text();
              throw new Error(`LNURL fetch failed (${lnurlResponse.status}): ${errorText || '[Empty Error Response]'}`);
            }

            const lnurlResponseText = await lnurlResponse.text();
            console.log('Raw LNURL Response:', lnurlResponseText || '[Empty Response]');

            if (!lnurlResponseText) {
              throw new Error('LNURL endpoint returned empty response');
            }

            let lnurlData;
            try {
              lnurlData = JSON.parse(lnurlResponseText);
            } catch (e) {
              throw new Error(`Invalid LNURL JSON response: ${e.message}\nRaw response: ${lnurlResponseText}`);
            }

            console.log('Parsed LNURL data:', lnurlData);

            if (!lnurlData.callback) {
              throw new Error(`Missing callback URL in LNURL response: ${JSON.stringify(lnurlData)}`);
            }

            // Validate LNURL-pay response
            if (lnurlData.tag !== 'payRequest') {
              throw new Error('LNURL endpoint is not a pay request');
            }

            // Check min/max constraints
            const minSendable = Math.ceil(lnurlData.minSendable / 1000);
            const maxSendable = Math.floor(lnurlData.maxSendable / 1000);
            
            if (amount < minSendable || amount > maxSendable) {
              throw new Error(`Amount must be between ${minSendable} and ${maxSendable} sats`);
            }

            // Construct callback URL with proper parameter encoding
            const callbackUrl = new URL(lnurlData.callback);
            const msatAmount = Math.floor(amount * 1000);
            callbackUrl.searchParams.append('amount', msatAmount);
            
            // Ensure zapRequest is properly encoded
            const nostrParam = JSON.stringify(zapRequest);
            callbackUrl.searchParams.append('nostr', nostrParam);
            
            console.log('Callback URL:', callbackUrl.toString());
            console.log('Zap request data:', zapRequest);

            // Get invoice with retry logic
            const invoice = await getInvoice(callbackUrl);
            sendResponse({ invoice });
          }

        } catch (error) {
          console.error('Zap invoice error:', error);
          sendResponse({ 
            error: error.message || 'Failed to get zap invoice',
            details: {
              stack: error.stack,
              name: error.name
            }
          });
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

async function getUserMetadata(pubkey) {
  try {
    // First check cache
    let metadata = await async function(pubkey) {
      const cacheKey = `metadata:${pubkey}`;
      const cached = await chrome.storage.local.get([cacheKey]);
      const data = cached[cacheKey];
      
      // Cache valid for 1 hour
      if (data && Date.now() - data.timestamp < 3600000) {
        return data;
      }
      return null;
    }(pubkey);

    if (!metadata) {
      await relayPool.ensureConnection();
      const relays = relayPool.getConnectedRelays();
      
      if (relays.length === 0) {
        throw new Error('No relays connected');
      }

      const filter = {
        kinds: [0],
        authors: [pubkey],
        limit: 1
      };

      // Try each relay until we get metadata
      for (const relay of relays) {
        try {
          const events = await pool.list([relay], [filter]);
          
          if (events && events.length > 0) {
            const content = JSON.parse(events[0].content);
            metadata = validateAndExtractMetadata(content);
            
            if (metadata) {
              await cacheMetadata(pubkey, metadata);
              break; // Found valid metadata, stop trying relays
            }
          }
        } catch (error) {
          console.warn(`Failed to fetch metadata from ${relay} for ${pubkey}:`, error);
          // Continue to next relay
        }
      }
    }

    // If we still don't have metadata, return default values
    if (!metadata) {
      const npub = nostrCore.nip19.npubEncode(pubkey);
      metadata = {
        name: shortenIdentifier(npub),
        picture: 'icons/default-avatar.png',
        timestamp: Date.now()
      };
    }

    return metadata;

  } catch (error) {
    console.error('Error fetching metadata:', error);
    // Return default values on error
    const npub = nostrCore.nip19.npubEncode(pubkey);
    return {
      name: shortenIdentifier(npub),
      picture: 'icons/default-avatar.png',
      timestamp: Date.now()
    };
  }
}

function validateAndExtractMetadata(content) {
  if (typeof content !== 'object' || content === null) {
    return null;
  }

  // List of valid metadata fields
  const validFields = [
    'name',
    'displayName',
    'picture',
    'about',
    'nip05',
    'lud06',  // Add LNURL
    'lud16',  // Add Lightning Address
    'banner',
    'website'
  ];

  const metadata = {};
  let hasValidData = false;

  for (const [key, value] of Object.entries(content)) {
    if (validFields.includes(key) && typeof value === 'string') {
      metadata[key] = value;
      hasValidData = true;
    }
  }

  if (!hasValidData) {
    return null;
  }

  metadata.timestamp = Date.now();
  return metadata;
}

async function cacheMetadata(pubkey, metadata) {
  const cacheKey = `metadata:${pubkey}`;
  await chrome.storage.local.set({
    [cacheKey]: {
      ...metadata,
      timestamp: Date.now()
    }
  });
}

// Add this function to refresh metadata for all contacts
async function refreshAllMetadata() {
  console.log('Starting metadata refresh for all contacts');
  const contacts = Array.from(contactManager.contacts.values());
  
  // Process in batches to avoid overwhelming the system
  const batchSize = 5;
  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);
    await Promise.all(batch.map(async (contact) => {
      try {
        const metadata = await getUserMetadata(contact.pubkey);
        if (metadata) {
          // Update contact with new metadata
          contact.displayName = metadata.name || metadata.displayName || contact.displayName;
          contact.avatarUrl = metadata.picture || contact.avatarUrl;
          contact.lightning = metadata.lud16 || metadata.lud06;
          contactManager.notifyUpdate(contact);
        }
      } catch (error) {
        console.error(`Error refreshing metadata for ${contact.pubkey}:`, error);
      }
    }));
  }
  console.log('Completed metadata refresh for all contacts');
}

// Modify the login success handler to include metadata refresh
async function handleLoginSuccess(user) {
  try {
    // Initialize user data
    await auth.initializeUserData(user);
    
    // Initialize contacts
    const userContacts = await contactManager.init(user.pubkey);
    
    // Refresh metadata for all contacts
    await refreshAllMetadata();
    
    return { success: true, user, contacts: userContacts };
  } catch (error) {
    console.error('Login initialization error:', error);
    throw error;
  }
}

async function getLNURLFromAddress(address) {
  try {
    console.log('Processing lightning address:', address);
    
    // Handle LNURL directly first
    if (address.toLowerCase().startsWith('lnurl')) {
      console.log('Handling LNURL format');
      const { words } = bech32.decode(address, 1000);
      const data = bech32.fromWords(words);
      const decoded = new TextDecoder().decode(data);
      console.log('Decoded LNURL:', decoded);
      return decoded;
    }
    
    // Handle direct LNURL endpoints
    if (address.toLowerCase().startsWith('http')) {
      console.log('Using direct LNURL endpoint');
      return address;
    }

    // Check if it's a lightning address
    if (address.includes('@')) {
      console.log('Handling lightning address format');
      const [name, domain] = address.split('@');

      try {
        console.log(`Checking availability of domain: ${domain}`);
        const domainCheck = await fetch(`https://${domain}`, {
          method: 'HEAD',
          timeout: 2000
        });
        if (!domainCheck.ok) {
          throw new Error(`The lightning address provider (${domain}) appears to be unavailable.`);
        }
      } catch (error) {
        console.error(`Domain check failed for ${domain}:`, error);
        throw new Error(`The lightning address provider (${domain}) appears to be unavailable. Please verify the address is correct.`);
      }

      const endpoint = `https://${domain}/.well-known/lnurlp/${name}`;
      console.log('Constructed LNURL endpoint:', endpoint);
      return endpoint;
    }
    
    throw new Error(`Unsupported lightning address format: ${address}`);
  } catch (error) {
    console.error('Error parsing lightning address:', error);
    throw error;
  }
}

async function getInvoice(callbackUrl, maxRetries = 3) {
  let lastError = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Attempt ${i + 1}/${maxRetries} to fetch invoice from:`, callbackUrl.toString());
      
      // Simplify to just amount parameter
      const baseUrl = callbackUrl.origin + callbackUrl.pathname;
      const amount = callbackUrl.searchParams.get('amount');
      const simpleUrl = `${baseUrl}?amount=${amount}`;
      
      console.log('Final invoice URL:', simpleUrl);
      
      const response = await fetch(simpleUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      console.log('Invoice Response Status:', response.status);
      console.log('Invoice Response Headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Invoice fetch failed (${response.status}): ${errorText || '[Empty Error Response]'}`);
      }

      const responseText = await response.text();
      console.log('Raw Invoice Response:', responseText || '[Empty Response]');

      if (!responseText) {
        throw new Error('Empty response from invoice endpoint');
      }

      try {
        const invoiceData = JSON.parse(responseText);
        console.log('Parsed invoice data:', invoiceData);

        if (!invoiceData || !invoiceData.pr) {
          throw new Error(`Missing payment request in invoice response: ${JSON.stringify(invoiceData)}`);
        }

        return invoiceData.pr;
      } catch (e) {
        console.warn('Failed to parse invoice response:', e);
        throw new Error(`Invalid JSON in invoice response: ${e.message}\nRaw response: ${responseText}`);
      }
    } catch (error) {
      console.warn(`Attempt ${i + 1} failed:`, error);
      lastError = error;
      
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }
  }

  throw new Error(`Failed to get invoice after ${maxRetries} attempts. Last error: ${lastError?.message}`);
}

/**
 * @file background.js
 * @description Chrome Extension Service Worker for Nostr messaging
 * 
 * Core functionalities:
 * - Message handling and decryption
 * - Sound management for notifications
 * - Contact state management
 * - Authentication persistence
 * - Lightning address processing
 * - Invoice generation and handling
 * 
 * Components:
 * - nostrCore: Core Nostr functionality wrapper
 * - soundManager: Audio notification system
 * - messageManager: Message processing and caching
 * - auth: Authentication state handler
 * 
 * @note Uses IIFE pattern for extension compatibility
 */
