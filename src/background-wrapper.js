(function() {
  'use strict';

  // Minimal setup - no async operations
  importScripts('lib/nostr-tools.js');
  self.NostrTools = NostrTools;
  importScripts('background.js');
  const bg = self.Background;

  // Track connection state
  let isInitialized = false;
  let pendingMessages = [];

  // Immediate lifecycle events
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', () => clients.claim());

  // Track popup state
  let popupPort = null;
  
  // Handle port connections
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'popup') {
      popupPort = port;
      port.onDisconnect.addListener(() => {
        popupPort = null;
      });

      // Send any pending messages
      while (pendingMessages.length > 0) {
        const msg = pendingMessages.shift();
        try {
          chrome.runtime.sendMessage(msg).catch(() => {
            // If sending fails, add back to queue
            pendingMessages.unshift(msg);
          });
        } catch (e) {
          pendingMessages.unshift(msg);
        }
      }
    }
  });

  // Safe message sender with error handling
  function safeSendMessage(message) {
    if (!isInitialized || !popupPort) {
      pendingMessages.push(message);
      return;
    }
    chrome.runtime.sendMessage(message).catch(() => {
      // If sending fails, add back to queue but don't log as error
      pendingMessages.push(message);
    });
  }

  // Handle messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LOGIN_SUCCESS') {
      // Immediately get stored user
      chrome.storage.local.get(['currentUser', 'lastRelays'], async result => {
        const user = result.currentUser;
        const lastRelays = result.lastRelays || [];
        
        if (!user) {
          sendResponse({ success: false, error: 'No user found' });
          return;
        }

        // Respond immediately with stored user
        sendResponse({ success: true, user });

        // Initialize in background
        try {
          // Connect to last successful relays first, then fallback to defaults
          const relays = [...new Set([...lastRelays, "wss://relay.damus.io", "wss://nos.lol"])];
          
          // Try to connect to at least one relay
          let connected = false;
          for (const relay of relays) {
            try {
              if (await bg.relayPool.connectToRelay(relay)) {
                connected = true;
                break;
              }
            } catch (e) {
              console.warn(`Failed to connect to ${relay}:`, e);
            }
          }

          if (!connected) {
            safeSendMessage({
              type: 'INIT_ERROR',
              error: 'Could not connect to any relay'
            });
            return;
          }

          // Start fetching contacts
          const contacts = await bg.fetchContacts(user.pubkey);
          if (contacts?.length > 0) {
            bg.setContacts(contacts);
            safeSendMessage({
              type: 'CONTACTS_UPDATED',
              data: contacts
            });
          }

          // Setup subscriptions
          bg.setupSubscriptions(user.pubkey);
          
          // Play sound and notify completion
          bg.soundManager.play('login', true);
          
          safeSendMessage({
            type: 'INIT_COMPLETE',
            data: { user }
          });

          isInitialized = true;

          // Connect to remaining relays in background
          setTimeout(() => {
            bg.relayPool.RELAYS.forEach(relay => 
              bg.relayPool.connectToRelay(relay)
                .then(success => {
                  if (success) {
                    const currentRelays = new Set(lastRelays);
                    currentRelays.add(relay);
                    chrome.storage.local.set({
                      lastRelays: Array.from(currentRelays)
                    });
                  }
                })
                .catch(() => {})
            );
          }, 1000);
        } catch (error) {
          console.error('Background init error:', error);
          safeSendMessage({
            type: 'INIT_ERROR',
            error: error.message
          });
        }
      });
      return true;
    }
    
    if (message.type === 'GET_ZAP_INVOICE') {
      (async () => {
        try {
          const { lightningAddress, amount, zapRequest } = message.data;
          if (!lightningAddress) {
            sendResponse({ success: false, error: 'No lightning address provided' });
            return;
          }

          console.log('Creating zap invoice:', { lightningAddress, amount, zapRequest });
          const invoice = await bg.createZapInvoice(lightningAddress, amount, zapRequest);
          
          if (!invoice) {
            sendResponse({ success: false, error: 'Failed to generate invoice' });
            return;
          }

          console.log('Successfully generated invoice:', invoice);
          sendResponse({ success: true, invoice });
        } catch (error) {
          console.debug('Zap invoice error:', error);
          sendResponse({ 
            success: false, 
            error: error.message || 'Failed to generate invoice'
          });
        }
      })();
      return true;
    }
    
    // Handle other messages
    return false;
  });
})(); 