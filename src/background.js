// Core dependencies
import { pool, relayPool, RELAYS, pubkeyToNpub, nostrCore } from './shared.js';
import { validateEvent, toLowerCaseHex, soundManager } from './utils.js';
import { auth } from './auth.js';
import { messageManager, sendMessage, receiveMessage, fetchMessages } from './messages.js';
import { fetchContacts, setContacts, processContactEvent } from './contact.js';
import { getUserMetadata, getDisplayName, getAvatarUrl, storeMetadata } from './userMetadata.js';
import { publishAppHandlerEvent } from './nip89.js';

// Move to top level (after imports):
let currentSubscription = null;

// Register service worker
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
              { kinds: [42], '#e': user.channelIds }
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

export function updateContactStatus(pubkey, isOnline) {
  const contact = contacts.get(pubkey);
  if (contact) {
    contact.isOnline = isOnline;
    chrome.runtime.sendMessage({
      type: 'contactStatusUpdated',
      pubkey,
      isOnline
    });
  }
}
