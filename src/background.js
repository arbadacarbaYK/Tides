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
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://nostr.wine',
    'wss://inbox.noderunners.network',
    'wss://nostr.einundzwanzig.space'
  ];

  // Utils
  const getPublicKeyFromPrivateKey = async (privateKey) => {
    try {
      // Use nostr-tools to get public key from private key
      return NostrTools.getPublicKey(privateKey);
    } catch (error) {
      console.error('Failed to get public key from private key:', error);
      throw new Error('Invalid private key');
    }
  };

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

  // Add this after the nostrCore initialization
  const handleZapEvent = async (event) => {
    try {
      // Validate zap event
      if (event.kind !== 9735) return;

      // Get the zapped message ID from the tags
      const zappedEventTag = event.tags.find(t => t[0] === 'e' && t[3] !== 'root');
      if (!zappedEventTag) return;

      const messageId = zappedEventTag[1];
      
      // Get the amount from the tags
      const amountTag = event.tags.find(t => t[0] === 'amount');
      if (!amountTag) return;

      const amount = parseInt(amountTag[1]);
      if (!amount) return;

      // Notify the UI about the received zap
      chrome.runtime.sendMessage({
        type: 'ZAP_RECEIVED',
        data: {
          messageId,
          amount,
          zapperPubkey: event.pubkey,
          timestamp: event.created_at
        }
      });

      // Play a sound for received zaps
      soundManager.play('message');
    } catch (error) {
      console.error('Error handling zap event:', error);
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

  // Add zap event handling to the subscription
  const setupSubscription = (user) => {
    if (currentSubscription) {
      currentSubscription.unsub();
    }

    // Get contacts array safely
    const contactPubkeys = Array.from(contacts.values())
      .map(contact => contact.pubkey)
      .filter(Boolean);

    currentSubscription = pool.sub(
      RELAYS.map(relay => ({
        relay,
        filter: [
          { kinds: [0], authors: contactPubkeys }, // Metadata for all contacts
          { kinds: [3], authors: [user.pubkey] }, // Contact list
          { kinds: [4], '#p': [user.pubkey] }, // DMs
          { kinds: [9735], '#p': [user.pubkey] }, // Zaps received
          { kinds: [30311], '#p': [user.pubkey] } // Streams
        ]
      }))
    );

    currentSubscription.on('event', event => {
      if (event.kind === 9735) {
        handleZapEvent(event);
      }
      // ... rest of the event handling
    });
  };

  // Update the message listener to use the new setup function
  self.addEventListener('message', async (event) => {
    const { type, data } = event.data;
    
    if (type === 'LOGIN_SUCCESS') {
      const user = await auth.getCurrentUser();
      if (user) {
        try {
          await relayPool.ensureConnection();
          
          // First fetch existing data
          const fetchedContacts = await fetchContacts(user.pubkey);
          if (fetchedContacts.length > 0) {
            setContacts(fetchedContacts);
            
            // Fetch metadata for all contacts before sending updates
            console.log('Fetching metadata for all contacts...');
            await Promise.all(fetchedContacts.map(async (contact) => {
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
              data: fetchedContacts
            });
          }

          // Then set up live subscriptions
          setupSubscription(user);

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

  // NWC Payment Functions
  const sendEventToNWCRelay = async (event, nwcConfig) => {
    return new Promise((resolve, reject) => {
      try {
        const relay = nwcConfig.relayUrls[0];

        
        const ws = new WebSocket(relay);
        
        ws.onopen = () => {
          ws.send(JSON.stringify(['EVENT', event]));
        };
        
        ws.onmessage = (message) => {
          try {
            const response = JSON.parse(message.data);
            
            if (response[0] === 'OK' && response[2] === true) {
              ws.close();
              resolve(response);
            } else {
              ws.close();
              reject(new Error(`Event publish failed: ${JSON.stringify(response)}`));
            }
          } catch (error) {
            ws.close();
            reject(error);
          }
        };
        
        ws.onerror = (error) => {
          reject(new Error(`WebSocket error: ${error.message}`));
        };
        
        ws.onclose = () => {
          // Silent close
        };
        
        // Timeout after 10 seconds
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
            reject(new Error('WebSocket timeout'));
          }
        }, 10000);
        
      } catch (error) {
        console.error('sendEventToNWCRelay error:', error);
        reject(error);
      }
    });
  };

  const payInvoiceViaNWC = async (invoice, nwcConfig) => {
    try {

      
      // Step 1: Check balance before payment

      const balanceBeforeEvent = {
        kind: 23194,
        content: '', // Empty content for balance check
        tags: [['p', nwcConfig.walletPubkey]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: nwcConfig.clientPubkey
      };
      
      // Sign the balance check event
      balanceBeforeEvent.id = nostrCore.getEventHash(balanceBeforeEvent);
      balanceBeforeEvent.sig = await nostrCore.getSignature(balanceBeforeEvent, nwcConfig.clientSecret);
      
      // Send balance check
      await sendEventToNWCRelay(balanceBeforeEvent, nwcConfig);
      
      // Encrypt the invoice using NIP-04
      const encryptedContent = await NostrTools.nip04.encrypt(
        nwcConfig.clientSecret,
        nwcConfig.walletPubkey,
        JSON.stringify({
          method: 'pay_invoice',
          params: {
            invoice: invoice
          }
        })
      );
      
      const paymentEvent = {
        kind: 23194,
        content: encryptedContent,
        tags: [['p', nwcConfig.walletPubkey]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: nwcConfig.clientPubkey
      };
      
      // Sign the payment event
      paymentEvent.id = nostrCore.getEventHash(paymentEvent);
      paymentEvent.sig = await nostrCore.getSignature(paymentEvent, nwcConfig.clientSecret);
      
      // Send payment request
      await sendEventToNWCRelay(paymentEvent, nwcConfig);

      
      // Step 3: Check balance after payment (wait 5 seconds)

      await new Promise(resolve => setTimeout(resolve, 5000));
      

      const balanceAfterEvent = {
        kind: 23194,
        content: '', // Empty content for balance check
        tags: [['p', nwcConfig.walletPubkey]],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: nwcConfig.clientPubkey
      };
      
      // Sign the balance check event
      balanceAfterEvent.id = nostrCore.getEventHash(balanceAfterEvent);
      balanceAfterEvent.sig = await nostrCore.getSignature(balanceAfterEvent, nwcConfig.clientSecret);
      
      // Send balance check
      await sendEventToNWCRelay(balanceAfterEvent, nwcConfig);

      return { success: true, message: 'Payment sent successfully' };
      
    } catch (error) {
      console.error('❌ NWC payment failed:', error);
      throw error;
    }
  };

  // Add this to your message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // NWC: Connect to wallet using existing credentials
    if (message.type === 'NWC_CONNECT') {
      (async () => {
        try {
          const { uri } = message.data || {};
          if (!uri || typeof uri !== 'string' || !uri.startsWith('nostr+walletconnect://')) {
            sendResponse({ error: 'Invalid NWC URI' });
            return;
          }

          console.log('Parsing NWC URI');
          
          // Parse the NWC URI to extract components
          const match = uri.match(/^nostr\+walletconnect:\/\/([^?]+)\?(.+)$/);
          if (!match) {
            sendResponse({ error: 'Invalid NWC URI format' });
            return;
          }

          const walletPubkey = match[1];
          const params = new URLSearchParams(match[2]);
          const relay = params.get('relay');
          const secret = params.get('secret');
          const lud16 = params.get('lud16');

          if (!walletPubkey || !relay || !secret) {
            sendResponse({ error: 'Missing required NWC parameters' });
            return;
          }

          // Generate client pubkey from secret (private key)
          const clientPubkey = await getPublicKeyFromPrivateKey(secret);

          // Store NWC configuration
          const nwcConfig = {
            walletPubkey,
            relayUrls: [relay],
            clientSecret: secret,
            clientPubkey,
            encryption: 'nip04',
            methods: ['pay_invoice', 'get_balance', 'get_info', 'list_transactions', 'make_invoice', 'lookup_invoice'],
            alias: lud16 || 'NWC Wallet',
            network: 'mainnet',
            uri: uri,
            sharedSecret: secret,
            supportsLightning: true,
            supportsCashu: true
          };

          await chrome.storage.local.set({ nwcConfig });
          
          console.log('NWC connected successfully:', {
            walletPubkey: nwcConfig.walletPubkey,
            clientPubkey: nwcConfig.clientPubkey,
            relay: nwcConfig.relayUrls[0]
          });

          sendResponse({ 
            ok: true, 
            walletName: nwcConfig.alias,
            config: nwcConfig 
          });

        } catch (error) {
          console.error('NWC connection failed:', error);
          sendResponse({ error: error.message || 'Failed to connect NWC' });
        }
      })();
      return true;
    }

    // NWC: Disconnect from wallet
    if (message.type === 'NWC_DISCONNECT') {
      (async () => {
        try {
          await chrome.storage.local.remove('nwcConfig');
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ error: error.message || 'Failed to disconnect NWC' });
        }
      })();
      return true;
    }

    // NWC: Pay invoice using NWC implementation
    if (message.type === 'PAY_INVOICE_VIA_NWC') {
      (async () => {
        try {
          const { invoice, zapRequest, relays } = message.data || {};
          if (!invoice) {
            sendResponse({ error: 'No invoice provided' });
            return;
          }

          // Get NWC configuration from storage
          const { nwcConfig } = await chrome.storage.local.get(['nwcConfig']);
          if (!nwcConfig) {
            sendResponse({ error: 'NWC not connected. Please connect to a wallet first.' });
            return;
          }

          // Use the NWC payment function
          const result = await payInvoiceViaNWC(invoice, nwcConfig);
          
          // NEW: Create and send zap receipt if this was a zap payment
          let zapReceiptResult = null;
          if (result.success && zapRequest && relays && relays.length > 0) {
            // Extract amount from zap request for the receipt, or use message data if available
            const amount = message.data.amount || zapRequest.tags?.find(tag => tag[0] === 'amount')?.[1] || '5000';
            const paymentData = { ...result, amount, message: message.data.message || zapRequest.content || 'Zapped via NWC', invoice: message.data.invoice };
            zapReceiptResult = await Background.createAndSendZapReceipt.call(Background, zapRequest, paymentData, relays);
          }
          
          sendResponse({ 
            ok: true, 
            result: result,
            zapReceipt: zapReceiptResult,
            message: 'Payment sent successfully via NWC'
          });

        } catch (error) {
          console.error('NWC payment failed:', error);
          sendResponse({ error: error.message || 'NWC payment failed' });
        }
      })();
      return true;
    }

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
            // First request: Get LNURL data
            const lnurlResponse = await fetch(lnurlEndpoint);
            
            if (!lnurlResponse.ok) {
              const errorText = await lnurlResponse.text();
              const domain = new URL(lnurlEndpoint).hostname;
              
              // Provide user-friendly error messages based on status codes
              let userMessage;
              if (lnurlResponse.status === 500) {
                userMessage = `The lightning server (${domain}) is experiencing technical difficulties. Please try again later.`;
              } else if (lnurlResponse.status === 404) {
                userMessage = `Lightning address not found on ${domain}. Please verify the address is correct.`;
              } else if (lnurlResponse.status >= 500) {
                userMessage = `The lightning server (${domain}) is temporarily unavailable. Please try again later.`;
              } else if (lnurlResponse.status >= 400) {
                userMessage = `Invalid request to ${domain}. Please check your lightning address.`;
              } else {
                userMessage = `Failed to connect to ${domain} (${lnurlResponse.status}). Please try again.`;
              }
              
              throw new Error(userMessage);
            }

            const lnurlResponseText = await lnurlResponse.text();

            if (!lnurlResponseText) {
              throw new Error('LNURL endpoint returned empty response');
            }

            let lnurlData;
            try {
              lnurlData = JSON.parse(lnurlResponseText);
            } catch (e) {
              throw new Error(`Invalid LNURL JSON response: ${e.message}\nRaw response: ${lnurlResponseText}`);
            }

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
    auth,
    
    // Zap Receipt Functions (NIP-57) - NEW ADDITION
    createAndSendZapReceipt: async (zapRequest, paymentResult, relays) => {
      try {

        
        if (!zapRequest || !relays || relays.length === 0) {
          console.warn('Missing zap request or relays for receipt creation');
          return;
        }

        // Get the current user's credentials for proper signing
        let currentUser = await auth.getCurrentUser();
        
        if (!currentUser) {
          console.warn('No authenticated user found, cannot create valid zap receipt');
          return { success: false, error: 'User not authenticated' };
        }
        
        // Check if currentUser is still encrypted (should be an object, not a string)
        if (typeof currentUser === 'string' && currentUser.length > 100) {
          try {
            // The background script's auth returns encrypted data, so we need to decrypt it
            const { encryptionKey } = await chrome.storage.sync.get('encryptionKey');
            
            if (!encryptionKey) {
              throw new Error('No encryption key found');
            }
            
            // Convert encrypted data from base64
            const combined = new Uint8Array(
              atob(currentUser).split('').map(char => char.charCodeAt(0))
            );
            
            // Extract IV and encrypted data
            const iv = combined.slice(0, 12);
            const data = combined.slice(12);
            
            // Import decryption key
            const key = await crypto.subtle.importKey(
              'raw',
              new Uint8Array(encryptionKey).buffer,
              { name: 'AES-GCM', length: 256 },
              false,
              ['decrypt']
            );
            
            // Decrypt the data
            const decrypted = await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv },
              key,
              data
            );
            
            const decryptedStr = new TextDecoder().decode(decrypted);
            const decryptedUser = JSON.parse(decryptedStr);
            
            // Replace currentUser with decrypted data
            currentUser = decryptedUser;
            
          } catch (decryptError) {
            console.error('❌ Manual decryption failed:', decryptError);
            return { success: false, error: 'Failed to decrypt user credentials' };
          }
        }
        



        
        // Create zap receipt event (kind 9735) according to NIP-57
        // Create zap receipt tags - only include 'e' tag if we have a zap request ID
        const zapReceiptTags = [
          ['p', zapRequest.pubkey], // Recipient pubkey
          ['bolt11', paymentResult.invoice || ''], // Lightning invoice that was paid
          ['description', JSON.stringify({
            kind: zapRequest.kind,
            pubkey: zapRequest.pubkey,
            created_at: zapRequest.created_at,
            content: zapRequest.content,
            tags: zapRequest.tags
          })], // Safe zap request description
          ['amount', paymentResult.amount || '5000'], // Amount in millisats
          ['relays', ...relays] // All relays from zap request
        ];

        // Add 'e' tag only if zapRequest has an ID
        if (zapRequest.id) {
          zapReceiptTags.splice(1, 0, ['e', zapRequest.id]); // Insert after 'p' tag
        }

        const zapReceipt = {
          kind: 9735,
          pubkey: currentUser.pubkey, // Use the actual user's Nostr pubkey
          content: '', // Empty content for zap receipts
          tags: zapReceiptTags,
          created_at: Math.floor(Date.now() / 1000)
        };

        // Validate required fields before proceeding
        
        if (!zapReceipt.pubkey || !zapReceipt.kind || !zapReceipt.created_at) {
          console.error('❌ Zap receipt missing required fields:', {
            pubkey: zapReceipt.pubkey,
            kind: zapReceipt.kind,
            created_at: zapReceipt.created_at
          });
          console.error('❌ Full zapReceipt object:', zapReceipt);
          console.error('❌ Full currentUser object:', currentUser);
          throw new Error('Zap receipt missing required fields');
        }

        // Debug: Log the zap receipt before calculating hash

        
        // Calculate the event ID first (required for signing)
        try {
          zapReceipt.id = nostrCore.getEventHash(zapReceipt);
        } catch (hashError) {
          console.error('❌ Failed to calculate zapReceipt hash:', hashError);
          throw hashError;
        }
        
        if (currentUser.type === 'NSEC' && currentUser.privkey) {
          // Sign with private key if available
          zapReceipt.sig = await nostrCore.getSignature(zapReceipt, currentUser.privkey);
        } else if (currentUser.type === 'NIP-07') {
          // For NIP-07, we need to use the extension to sign
          try {
            if (typeof window?.nostr !== 'undefined') {
              zapReceipt.sig = await window.nostr.signEvent(zapReceipt);
            } else {
              console.warn('NIP-07 extension not available in background context');
              return { success: false, error: 'NIP-07 extension not available' };
            }
          } catch (signError) {
            console.error('Failed to sign with NIP-07 extension:', signError);
            return { success: false, error: 'Failed to sign zap receipt' };
          }
        } else {
          console.warn('Unknown user type, cannot sign zap receipt');
          return { success: false, error: 'Unknown user authentication type' };
        }
        
        // Send to all relays from the zap request (NOT the NWC relay!)
        let successCount = 0;
        for (const relay of relays) {
          try {
            if (relay.startsWith('wss://')) {
              // Send via WebSocket to relay
              await Background.sendEventToRelay(zapReceipt, relay);
              successCount++;
            } else {
              console.warn(`Skipping non-WebSocket relay: ${relay}`);
            }
          } catch (error) {
            console.error(`Failed to send zap receipt to ${relay}:`, error);
          }
        }
        
        console.log(`✅ Zap receipt sent to ${successCount}/${relays.length} relays`);
        return { success: true, sentTo: successCount, total: relays.length };
        
      } catch (error) {
        console.error('❌ Failed to create/send zap receipt:', error);
        // Don't throw - zap receipt failure shouldn't break the payment flow
        return { success: false, error: error.message };
      }
    },
    
    // Helper function to send events to relays (separate from NWC)
    sendEventToRelay: async (event, relay) => {
      return new Promise((resolve, reject) => {
        try {
          const ws = new WebSocket(relay);
          
          ws.onopen = () => {
            ws.send(JSON.stringify(['EVENT', event]));
          };
          
          ws.onmessage = (message) => {
            try {
              const response = JSON.parse(message.data);
              
              if (response[0] === 'OK' && response[2] === true) {
                ws.close();
                resolve(response);
              } else {
                ws.close();
                resolve(response); // Resolve anyway, don't fail the whole process
              }
            } catch (error) {
              ws.close();
              resolve({ error: 'Parse error' }); // Resolve anyway
            }
          };
          
          ws.onerror = (error) => {
            reject(new Error(`WebSocket error: ${error.message}`));
          };
          
          ws.onclose = () => {
            // Silent close
          };
          
          // Timeout after 10 seconds
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
              reject(new Error('WebSocket timeout'));
            }
          }, 10000);
          
        } catch (error) {
          console.error('sendEventToRelay error:', error);
          reject(error);
        }
      });
    }
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
          throw new Error(`The lightning address provider (${domain}) is not responding (${domainCheck.status}). Please verify the address is correct or try again later.`);
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
        const domain = new URL(callbackUrl).hostname;
        
        // Provide user-friendly error messages for invoice fetch failures
        let userMessage;
        if (response.status === 500) {
          userMessage = `The lightning server (${domain}) is experiencing technical difficulties while generating the invoice. Please try again later.`;
        } else if (response.status === 404) {
          userMessage = `Invoice endpoint not found on ${domain}. Please verify the lightning address is correct.`;
        } else if (response.status >= 500) {
          userMessage = `The lightning server (${domain}) is temporarily unavailable. Please try again later.`;
        } else if (response.status >= 400) {
          userMessage = `Invalid request to ${domain}. Please check your lightning address and amount.`;
        } else {
          userMessage = `Failed to connect to ${domain} (${response.status}). Please try again.`;
        }
        
        throw new Error(userMessage);
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
 * - NWC payments and zap receipts
 * 
 * Components:
 * - nostrCore: Core Nostr functionality wrapper
 * - soundManager: Audio notification system
 * - messageManager: Message processing and caching
 * - auth: Authentication state handler
 * 
 * @note Uses IIFE pattern for extension compatibility
 */
