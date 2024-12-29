/**
 * @file background.js
 * @description Service Worker for the Tides Nostr Messenger
 * 
 * This file handles all background processes for the Tides extension, including:
 * - Relay connections and management
 * - Message encryption/decryption
 * - Lightning Network integrations
 * - User metadata caching
 * - Push notifications
 * 
 * The service worker stays active even when the popup is closed, ensuring
 * real-time message delivery and notifications.
 * 
 * 🌊 "The tide rises, the tide falls, but messages flow eternal" 
 */

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

  // State management
  let currentSubscription = null;
  const contacts = new Map();

  // Auth Manager with minimal initial setup
  const auth = {
    currentUser: null,

    async init() {
      try {
        const { currentUser } = await chrome.storage.local.get('currentUser');
        if (currentUser) {
          this.currentUser = currentUser;
        }
        return currentUser || null;
      } catch (error) {
        console.error('Auth init error:', error);
        return null;
      }
    },

    async getCurrentUser() {
      return this.currentUser || this.init();
    }
  };

  // Simplified relay pool management
  const relayPool = {
    connectedRelays: new Set(),

    async connectToRelay(url) {
      if (this.connectedRelays.has(url)) {
        return true;
      }

      try {
        await pool.ensureRelay(url);
        this.connectedRelays.add(url);
        return true;
      } catch (error) {
        console.debug(`Failed to connect to relay ${url}:`, error);
        return false;
      }
    },

    getConnectedRelays() {
      return Array.from(this.connectedRelays);
    }
  };

  // Message Manager
  const messageManager = new class {
    constructor() {
      this.subscriptions = new Map();
      this.messageCache = new Map();
    }

    async decryptMessage(event) {
      try {
        const currentUser = await auth.getCurrentUser();
        if (!currentUser) return null;

        const privateKey = currentUser.type === 'NSEC' ? currentUser.privkey : window.nostr;
        if (!privateKey || !event?.content) return null;

        const isSender = event.pubkey === currentUser.pubkey;
        const recipientPubkey = isSender ? 
          event.tags.find(tag => tag[0] === 'p')?.[1] : 
          event.pubkey;

        if (!recipientPubkey) return null;

        // Normalize content by removing any invalid base64 characters
        let content = event.content.replace(/[^A-Za-z0-9+/=]/g, '');
        
        // Add padding if needed
        const mod4 = content.length % 4;
        if (mod4 > 0) {
          content += '='.repeat(4 - mod4);
        }

        try {
          if (privateKey === window.nostr) {
            return await window.nostr.nip04.decrypt(
              isSender ? recipientPubkey : event.pubkey,
              content
            );
          } else {
            return await NostrTools.nip04.decrypt(
              privateKey,
              isSender ? recipientPubkey : event.pubkey,
              content
            );
          }
        } catch (error) {
          // If decryption fails, try with original content
          try {
            if (privateKey === window.nostr) {
              return await window.nostr.nip04.decrypt(
                isSender ? recipientPubkey : event.pubkey,
                event.content
              );
            } else {
              return await NostrTools.nip04.decrypt(
                privateKey,
                isSender ? recipientPubkey : event.pubkey,
                event.content
              );
            }
          } catch (retryError) {
            // Silently log decryption errors as debug
            console.debug('Message decryption failed:', retryError);
            return null;
          }
        }
      } catch (error) {
        // Silently log decryption errors as debug
        console.debug('Message decryption failed:', error);
        return null;
      }
    }

    async handleIncomingMessage(event) {
      try {
        const decryptedContent = await this.decryptMessage(event);
        if (decryptedContent) {
          const contact = contacts.get(event.pubkey);
          if (contact) {
            contact.hasMessages = true;
            contact.lastMessage = event;
            notifyUpdate(contact);
          }
          
          safeSendMessage({
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
      } catch (error) {
        console.debug('Error handling incoming message:', error);
      }
    }
  };

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

  // Add helper functions
  function notifyUpdate(contact) {
        chrome.runtime.sendMessage({
      type: 'CONTACT_UPDATED',
      data: contact
    });
  }

  function setContacts(contactList) {
    contactList.forEach(contact => {
      contacts.set(contact.pubkey, contact);
    });
  }

  function shortenIdentifier(identifier) {
    return identifier.slice(0, 8) + '...' + identifier.slice(-4);
  }

  // Lightning address handling
  async function getLightningUrl(address) {
    if (!address?.includes('@')) {
      throw new Error('Invalid lightning address format - expected user@domain.com');
    }

    const [username, domain] = address.split('@');
    const url = `https://${domain}/.well-known/lnurlp/${username}`;
    
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Lightning service error: ${response.status}`);
      }
      return url;
    } catch (error) {
      console.error('Lightning URL error:', error);
      throw new Error('Lightning service not available at this domain');
    }
  }

  /**
   * Debug utility for logging objects with consistent formatting
   * @param {string} label - Description of what's being debugged
   * @param {Object} obj - The object to inspect
   * @returns {Object} Formatted debug information
   */
  function debugObject(label, obj) {
    const debugInfo = {
      type: obj ? typeof obj : 'null/undefined',
      value: obj,
      keys: obj ? Object.keys(obj) : [],
      stringified: JSON.stringify(obj, null, 2)
    };
    console.log(`Debug ${label}:`, debugInfo);
    return debugInfo;
  }

  /**
   * Fetches and caches user metadata from Nostr relays
   * @param {string} pubkey - User's public key in hex format
   * @returns {Promise<Object>} User metadata including name, picture, and lightning address
   * @throws {Error} If metadata cannot be fetched or parsed
   */
  async function getUserMetadata(pubkey) {
    try {
      console.log('Fetching metadata for pubkey:', pubkey);
      
      // First check cache
      const cacheKey = `metadata:${pubkey}`;
      const cached = await chrome.storage.local.get(cacheKey);
      if (cached[cacheKey] && Date.now() - cached[cacheKey].timestamp < 3600000) {
        const metadata = cached[cacheKey];
        console.log('Using cached metadata:', debugObject('cached_metadata', metadata));
        return metadata;
      }

      // Not in cache or expired, fetch from relays
      const relays = relayPool.getConnectedRelays();
      if (!relays.length) {
        console.warn('No relays connected, connecting to primary relays');
        await Promise.any([
          relayPool.connectToRelay("wss://relay.damus.io"),
          relayPool.connectToRelay("wss://nos.lol")
        ]);
      }

      const events = await pool.list(relayPool.getConnectedRelays(), [{
        kinds: [0],
        authors: [pubkey],
        limit: 1
      }]);

      let metadata = null;
      if (events?.[0]?.content) {
        try {
          metadata = JSON.parse(events[0].content);
          console.log('Raw metadata from relay:', debugObject('raw_metadata', metadata));
          
          // Normalize lightning address fields
          if (metadata.lud16 || metadata.lightning) {
            metadata.lightningAddress = metadata.lud16 || metadata.lightning;
            console.log('Found lightning address:', {
              lud16: metadata.lud16,
              lightning: metadata.lightning,
              normalized: metadata.lightningAddress
            });
          } else if (metadata.lud06) {
            try {
              const lnurl = await decodeLnurl(metadata.lud06);
              metadata.lightningAddress = lnurl;
              console.log('Decoded LUD-06:', {
                original: metadata.lud06,
                decoded: lnurl
              });
            } catch (e) {
              console.warn('Failed to decode LUD-06:', e);
            }
          }

          // Cache the result
          await chrome.storage.local.set({
            [cacheKey]: {
              ...metadata,
              timestamp: Date.now()
            }
          });
        } catch (e) {
          console.error('Failed to parse metadata JSON:', e, 'Raw content:', events[0].content);
        }
      } else {
        console.warn('No metadata event found for pubkey:', pubkey);
      }
      return metadata;
    } catch (error) {
      console.error('Error in getUserMetadata:', error, 'Pubkey:', pubkey);
      return null;
    }
  }

  async function processContactEvent(event) {
    try {
      const contactPubkeys = event.tags
        .filter(tag => tag[0] === 'p')
        .map(tag => tag[1]);

      const processedContacts = await Promise.all(
        contactPubkeys.map(async pubkey => {
          try {
            const metadata = await getUserMetadata(pubkey);
            const npub = nostrCore.nip19.npubEncode(pubkey);
            
            // Check for messages with this contact
            const hasMessages = await messageManager.hasMessages(pubkey);

            const contactData = {
              pubkey,
              npub,
              displayName: metadata?.name || metadata?.displayName || shortenIdentifier(npub),
              avatarUrl: metadata?.picture || '/icons/default-avatar.png',
              isOnline: false,
              hasMessages,
              metadata,
              lightningAddress: metadata?.lightningAddress || metadata?.lud16 || metadata?.lightning || null,
              lud16: metadata?.lud16 || null,
              lightning: metadata?.lightning || null
            };

            // Update or create contact
            const existingContact = contacts.get(pubkey);
            const contact = { ...existingContact || {}, ...contactData };
            contacts.set(pubkey, contact);
            
            return contact;
          } catch (error) {
            console.error(`Error processing contact ${pubkey}:`, error);
            return null;
          }
        })
      );

      return processedContacts.filter(Boolean);
    } catch (error) {
      console.error('Error processing contact event:', error);
      return [];
    }
  }

  /**
   * Processes a Lightning Network payment request
   * @param {string} lightningAddress - User's Lightning address (lud16 format)
   * @param {number} amount - Payment amount in millisatoshis
   * @param {Object} zapRequest - NIP-57 zap request details
   * @returns {Promise<string>} Lightning invoice in BOLT11 format
   * @throws {Error} If invoice generation fails
   */
  async function createZapInvoice(lightningAddress, amount, zapRequest) {
    try {
      console.log('Creating zap invoice with params:', {
        lightningAddress,
        amount,
        zapRequest: zapRequest ? {
          kind: zapRequest.kind,
          pubkey: zapRequest.pubkey,
          tags: zapRequest.tags
        } : null
      });

      if (!lightningAddress) {
        throw new Error('No lightning address provided');
      }

      // Handle both direct lightning addresses and metadata formats
      let finalAddress = lightningAddress;
      if (typeof lightningAddress === 'object') {
        console.log('Lightning address from metadata:', lightningAddress);
        finalAddress = lightningAddress.lightningAddress || lightningAddress.lud16 || lightningAddress.lightning;
      }

      if (!finalAddress || !finalAddress.includes('@')) {
        throw new Error(`Invalid lightning address format: ${finalAddress}`);
      }

      const [username, domain] = finalAddress.split('@');
      if (!username || !domain) {
        throw new Error(`Invalid lightning address parts: username=${username}, domain=${domain}`);
      }

      // Try HTTPS first, then fallback to HTTP if needed
      const protocols = ['https', 'http'];
      let lnurlResponse = null;
      let lastError = null;
      let lastResponseDetails = null;
      let lastResponseText = null;

      for (const protocol of protocols) {
        try {
          const url = `${protocol}://${domain}/.well-known/lnurlp/${username}`;
          console.log(`Trying ${protocol.toUpperCase()} endpoint:`, url);
          
          const response = await fetch(url, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'NostrClient/1.0'
            }
          });

          const responseDetails = {
            protocol,
            url,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries())
          };
          console.log(`${protocol.toUpperCase()} response details:`, responseDetails);
          lastResponseDetails = responseDetails;

          if (!response.ok) {
            console.warn(`${protocol.toUpperCase()} endpoint returned ${response.status}`);
            continue;
          }

          const text = await response.text();
          console.log(`${protocol.toUpperCase()} raw response:`, text);
          lastResponseText = text;
          
          if (!text) {
            console.warn(`Empty response from ${protocol.toUpperCase()} endpoint`);
            continue;
          }

          try {
            const data = JSON.parse(text);
            console.log(`Parsed ${protocol.toUpperCase()} response:`, data);

            if (!data) {
              throw new Error('Empty JSON response');
            }

            if (!data.callback) {
              throw new Error(`Missing callback URL in response: ${JSON.stringify(data)}`);
            }

            lnurlResponse = data;
            break;
          } catch (e) {
            console.warn(`Failed to parse JSON from ${protocol.toUpperCase()} endpoint:`, e);
            lastError = e;
            continue;
          }
        } catch (e) {
          console.warn(`Failed to fetch from ${protocol.toUpperCase()} endpoint:`, e);
          lastError = e;
        }
      }

      if (!lnurlResponse) {
        // Check if the domain is not responding or returning errors
        if (lastError?.message?.includes('Failed to fetch') || 
            lastError?.message?.includes('Network Error') ||
            lastResponseDetails?.status === 404) {
          throw new Error(`Lightning address ${finalAddress} is inactive or invalid`);
        }
        
        throw new Error(`Lightning service for ${finalAddress} is unavailable`);
      }

      // Build callback URL with proper parameters
      const callbackUrl = new URL(lnurlResponse.callback);
      const msatAmount = Math.floor(amount * 1000); // Convert sats to msats
      callbackUrl.searchParams.set('amount', msatAmount);

      // Add zap request if provided
      if (zapRequest) {
        // Simplify the nostr event to only include essential fields
        const nostrEvent = {
          kind: zapRequest.kind,
          pubkey: zapRequest.pubkey,
          created_at: Math.floor(Date.now() / 1000),
          tags: zapRequest.tags,  // Keep all original tags
          content: ''
        };
        nostrEvent.id = NostrTools.getEventHash(nostrEvent);
        
        // Sign the event if we have a private key
        const currentUser = await auth.getCurrentUser();
        if (currentUser) {
          if (currentUser.type === 'NIP-07' && window.nostr) {
            nostrEvent.sig = await window.nostr.signEvent(nostrEvent);
          } else if (currentUser.type === 'NSEC' && currentUser.privkey) {
            nostrEvent.sig = NostrTools.getSignature(nostrEvent, currentUser.privkey);
          }
        }
        
        // Add nostr event as a compact JSON string without whitespace
        callbackUrl.searchParams.set('nostr', JSON.stringify(nostrEvent));
      }

      console.log('Requesting invoice with callback URL:', {
        url: callbackUrl.toString(),
        params: Object.fromEntries(callbackUrl.searchParams.entries())
      });

      // Retry logic for invoice generation
      const maxRetries = 3;
      const retryDelay = 1000; // 1 second
      let lastInvoiceError = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Invoice generation attempt ${attempt}/${maxRetries}`);

          const invoiceResponse = await fetch(callbackUrl.toString(), {
            method: 'GET',
            headers: {
              'Accept': '*/*',
              'User-Agent': 'NostrClient/1.0'
            },
            cache: 'no-cache'
          });

          console.log('Invoice response details:', {
            status: invoiceResponse.status,
            statusText: invoiceResponse.statusText,
            headers: Object.fromEntries(invoiceResponse.headers.entries())
          });

          if (!invoiceResponse.ok) {
            throw new Error(`Invoice generation failed: ${invoiceResponse.status} - ${invoiceResponse.statusText}`);
          }

          const contentType = invoiceResponse.headers.get('content-type');
          const invoiceText = await invoiceResponse.text();
          console.log('Raw invoice response:', invoiceText);

          // Handle empty response
          if (!invoiceText) {
            const details = {
              callbackUrl: callbackUrl.toString(),
              status: invoiceResponse.status,
              headers: Object.fromEntries(invoiceResponse.headers.entries()),
              attempt
            };

            // Check if it's a LNURL error response
            if (contentType && contentType.includes('application/json')) {
              try {
                const errorData = JSON.parse(invoiceText);
                if (errorData.status === 'ERROR') {
                  throw new Error(`LNURL Error: ${errorData.reason}`);
                }
              } catch (e) {
                console.warn('Failed to parse error response:', e);
              }
            }

            lastInvoiceError = new Error(`Empty response from LNURL-pay endpoint. Details: ${JSON.stringify(details)}`);
            
            if (attempt < maxRetries) {
              console.debug(`Retrying in ${retryDelay}ms...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              continue;
            }
            throw lastInvoiceError;
          }

          // Handle direct BOLT11 invoice
          if (invoiceText.toLowerCase().startsWith('lnbc')) {
            console.log('Received direct BOLT11 invoice');
            return invoiceText.trim();
          }

          // Handle JSON response
          try {
            const invoiceData = JSON.parse(invoiceText);
            console.log('Parsed invoice data:', invoiceData);

            // Check for LNURL error response with better error messages
            if (invoiceData.status === 'ERROR') {
              const reason = invoiceData.reason?.toLowerCase() || '';
              if (reason.includes('invalid zap request')) {
                throw new Error('No zap support');
              } else if (reason.includes('amount')) {
                throw new Error('Invalid amount');
              } else if (reason.includes('invalid') || reason.includes('malformed')) {
                throw new Error('Invalid request');
              } else {
                throw new Error('Service error');
              }
            }

            // Check all possible invoice field names
            const invoice = invoiceData?.pr || 
                           invoiceData?.invoice || 
                           invoiceData?.payment_request ||
                           invoiceData?.paymentRequest ||
                           invoiceData?.lightning_invoice?.payreq;

            if (!invoice) {
              lastInvoiceError = new Error('No invoice in response');
              
              if (attempt < maxRetries) {
                console.debug(`Retrying in ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
              }
              throw lastInvoiceError;
            }

            return invoice;
          } catch (e) {
            console.debug('Failed to parse invoice JSON:', e);
            if (e.message.includes('Service does not support zaps')) {
              lastInvoiceError = new Error('Service does not support zaps');
            } else if (e.message.includes('Amount outside allowed limits')) {
              lastInvoiceError = new Error('Amount outside allowed limits');
            } else if (e.message.includes('Service rejected')) {
              lastInvoiceError = new Error('Service rejected request');
            } else {
              lastInvoiceError = new Error('Service unavailable');
            }
            
            if (attempt < maxRetries) {
              console.debug(`Retrying in ${retryDelay}ms...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              continue;
            }
            throw lastInvoiceError;
          }
        } catch (e) {
          lastInvoiceError = e;
          if (attempt < maxRetries) {
            console.debug(`Retrying in ${retryDelay}ms due to error:`, e);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          }
        }
      }

      throw lastInvoiceError || new Error('Failed to generate invoice after all retries');
    } catch (error) {
      // Log expected errors as debug instead of error
      console.debug('Zap invoice error:', error);
      throw error;
    }
  }

  // Message handling
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_ZAP_INVOICE') {
      (async () => {
        try {
          const { lightningAddress, amount, zapRequest } = message.data;
          if (!lightningAddress) {
            sendResponse({ success: false, error: 'No lightning address provided' });
            return;
          }

          console.log('Creating zap invoice:', { lightningAddress, amount, zapRequest });
          const invoice = await createZapInvoice(lightningAddress, amount, zapRequest);
          
          if (!invoice) {
            sendResponse({ success: false, error: 'Failed to generate invoice' });
            return;
          }

          console.log('Successfully generated invoice:', invoice);
          sendResponse({ success: true, invoice });
        } catch (error) {
          // Log expected errors as debug instead of error
          console.debug('Zap invoice error:', error);
          sendResponse({ 
            success: false, 
            error: error.message || 'Failed to generate invoice'
          });
        }
      })();
      return true; // Keep the message channel open for async response
    }
  });

  /**
   * Service Worker installation handler
   * Ensures immediate activation by using skipWaiting
   */
  self.addEventListener('install', async (event) => {
    console.log('Service Worker installing.');
    event.waitUntil(self.skipWaiting());
  });

  /**
   * Service Worker activation handler
   * Sets up relay connections and initializes user data
   * Uses a race condition for fast startup with primary relays
   */
  self.addEventListener('activate', async (event) => {
    console.log('Service Worker activated.');
    event.waitUntil(
      Promise.all([
      clients.claim(),
        (async () => {
          try {
            const user = await auth.init();
            if (user) {
              // Connect to primary relays first
              await Promise.race([
                relayPool.connectToRelay("wss://relay.damus.io"),
                relayPool.connectToRelay("wss://nos.lol"),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
              ]);
              
              // Then fetch contacts and setup subscriptions in parallel
              const [contacts] = await Promise.all([
                fetchContacts(user.pubkey),
                setupSubscriptions(user.pubkey)
              ]);

              if (contacts.length > 0) {
                setContacts(contacts);
              }

              // Connect to remaining relays in background
              setTimeout(() => {
                RELAYS.filter(r => 
                  r !== "wss://relay.damus.io" && 
                  r !== "wss://nos.lol"
                ).forEach(relay => 
                  relayPool.connectToRelay(relay).catch(() => {})
                );
              }, 0);
            }
          } catch (error) {
            console.error('Error during service worker activation:', error);
          }
        })()
      ])
    );
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

  // Modify fetchContacts function to properly handle all conversations
  async function fetchContacts(pubkey) {
    try {
      const relays = relayPool.getConnectedRelays();
      if (relays.length === 0) {
        throw new Error('No relays connected');
      }

      // Get ALL messages first
      const messagePromises = relays.map(relay => 
        Promise.all([
          // Get sent messages
          pool.list([relay], [{
            kinds: [4],
            authors: [pubkey]
          }]),
          // Get received messages
          pool.list([relay], [{
            kinds: [4],
            '#p': [pubkey]
          }])
        ])
      );

      const relayResults = await Promise.allSettled(messagePromises);
      
      // Process ALL messages
      const messageMap = new Map();
      const contactPubkeys = new Set();

      relayResults.forEach(result => {
        if (result.status === 'fulfilled') {
          const [sent, received] = result.value;
          [...sent, ...received].forEach(msg => {
            if (!messageMap.has(msg.id)) {
              messageMap.set(msg.id, msg);
              // Add both sender and recipient to contacts
              contactPubkeys.add(msg.pubkey);
              const recipientTag = msg.tags.find(t => t[0] === 'p');
              if (recipientTag) {
                contactPubkeys.add(recipientTag[1]);
              }
            }
          });
        }
      });

      // Process each contact
      const processedContacts = await Promise.all(
        Array.from(contactPubkeys).map(async contactPubkey => {
          if (contactPubkey === pubkey) return null; // Skip self
          
          try {
            const metadata = await getUserMetadata(contactPubkey);
            const npub = nostrCore.nip19.npubEncode(contactPubkey);
            
            // Get ALL messages with this contact
            const contactMessages = Array.from(messageMap.values())
              .filter(msg => 
                msg.pubkey === contactPubkey || 
                msg.tags.find(t => t[0] === 'p')?.[1] === contactPubkey
              )
              .sort((a, b) => b.created_at - a.created_at);
          
          const contactData = {
              pubkey: contactPubkey,
            npub,
              displayName: metadata?.name || metadata?.displayName || shortenIdentifier(npub),
              avatarUrl: metadata?.picture || '/icons/default-avatar.png',
              isOnline: false,
              hasMessages: contactMessages.length > 0,
              metadata,
              lightningAddress: metadata?.lightningAddress || metadata?.lud16 || metadata?.lightning || null,
              lud16: metadata?.lud16 || null,
              lightning: metadata?.lightning || null,
              lastMessage: contactMessages[0] || null,
              messageCount: contactMessages.length
            };

            // Update existing contact or create new one
            const existingContact = contacts.get(contactPubkey);
            const contact = { ...existingContact || {}, ...contactData };
            contacts.set(contactPubkey, contact);
            
          return contact;
        } catch (error) {
            console.error(`Error processing contact ${contactPubkey}:`, error);
          return null;
        }
        })
      );

      // Return ALL contacts with messages, sorted by most recent
      return processedContacts
        .filter(Boolean)
        .filter(contact => contact.hasMessages)
        .sort((a, b) => {
          const timeA = a.lastMessage?.created_at || 0;
          const timeB = b.lastMessage?.created_at || 0;
          return timeB - timeA;
        });

    } catch (error) {
      console.error('Error fetching contacts:', error);
      return [];
    }
  }

  // Add setupSubscriptions function
  function setupSubscriptions(pubkey) {
      if (currentSubscription) {
        currentSubscription.unsub();
      }

    // First get all contacts and their metadata
    const filters = [
      // Contact list
      { kinds: [3], authors: [pubkey] },
      // User metadata
      { kinds: [0], authors: [pubkey] },
      // Messages sent by user
      { kinds: [4], authors: [pubkey], limit: 500 },
      // Messages received by user
      { kinds: [4], '#p': [pubkey], limit: 500 },
      // Zaps
      { kinds: [9735], '#p': [pubkey] }
    ];

    // Subscribe to all relays
      currentSubscription = pool.sub(
        RELAYS.map(relay => ({
          relay,
        filter: filters
        }))
      );

      currentSubscription.on('event', async (event) => {
        if (validateEvent(event)) {
          console.log('Received event:', event);
        try {
          if (event.kind === 0) {
            const metadata = JSON.parse(event.content);
            await storeMetadata(event.pubkey, metadata);
            // Update contact if exists
            const contact = contacts.get(event.pubkey);
            if (contact) {
              contact.displayName = metadata.name || metadata.displayName || contact.displayName;
              contact.avatarUrl = metadata.picture || contact.avatarUrl;
              contact.metadata = metadata;
              contact.lud16 = metadata.lud16 || null;
              contact.lightning = metadata.lightning || null;
              notifyUpdate(contact);
            }
          } else if (event.kind === 3) {
            const newContacts = await processContactEvent(event);
            setContacts(newContacts);
            chrome.runtime.sendMessage({
              type: 'CONTACTS_UPDATED',
              data: newContacts
            });
          } else if (event.kind === 4) {
            await messageManager.handleIncomingMessage(event);
            // Update contact's hasMessages flag
            const contactPubkey = event.pubkey === pubkey ? 
              event.tags.find(t => t[0] === 'p')?.[1] : 
              event.pubkey;
            if (contactPubkey) {
              let contact = contacts.get(contactPubkey);
              if (!contact) {
                // Create new contact if doesn't exist
                const metadata = await getUserMetadata(contactPubkey);
                const npub = nostrCore.nip19.npubEncode(contactPubkey);
                contact = {
                  pubkey: contactPubkey,
                  npub,
                  displayName: metadata?.name || metadata?.displayName || shortenIdentifier(npub),
                  avatarUrl: metadata?.picture || '/icons/default-avatar.png',
                  isOnline: false,
                  hasMessages: true,
                  metadata,
                  lud16: metadata?.lud16 || null,
                  lightning: metadata?.lightning || null
                };
                contacts.set(contactPubkey, contact);
              } else {
                contact.hasMessages = true;
              }
              notifyUpdate(contact);
            }
          } else if (event.kind === 9735) {
            const zapAmount = event.tags.find(t => t[0] === 'amount')?.[1];
            const messageId = event.tags.find(t => t[0] === 'e')?.[1];
            if (zapAmount && messageId) {
              chrome.runtime.sendMessage({
                type: 'ZAP_RECEIVED',
                data: { messageId, amount: parseInt(zapAmount) }
              });
            }
          }
        } catch (error) {
          console.error('Error processing event:', error);
        }
      }
    });

    return currentSubscription;
  }

  // Initialize auth immediately
  auth.init().catch(console.error);

  // Public API
  return {
    updateContactStatus(pubkey, isOnline) {
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
    fetchContacts,
    setContacts,
    createZapInvoice,
    setupSubscriptions,
    pool,
    contacts,
    relayPool,
    soundManager,
    messageManager,
    auth
  };

})(self.NostrTools);

// Make Background available to service worker scope
self.Background = Background;

