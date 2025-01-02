import { pool, relayPool, RELAYS, nostrCore, shortenIdentifier } from './shared.js';
import { getUserMetadata } from './userMetadata.js';
import { toLowerCaseHex } from './utils.js';
import { generateCredentialFormats } from './utils.js';
import { messageManager } from './messages.js';
import { auth } from './auth.js';

class ContactManager {
  constructor() {
    this.contacts = new Map();
    this.channels = new Map();
    this.subscriptions = new Map();
    this.lastMessageTimes = new Map();
  }

  async init(pubkey) {
    const contacts = await fetchContacts(pubkey);
    this.contacts = new Map(contacts.map(c => [c.pubkey, c]));
    
    try {
      // Wait for authentication
      const currentUser = await auth.getCurrentUser();
      if (!currentUser) {
        console.error('User not authenticated');
        return Array.from(this.contacts.values());
      }

      // Clear existing message times
      this.lastMessageTimes.clear();

      // Initialize message times for all contacts
      for (const contact of this.contacts.values()) {
        try {
          console.log(`Fetching messages for contact ${contact.pubkey}`);
          const messages = await messageManager.fetchMessages(contact.pubkey);
          console.log(`Got ${messages?.length || -1} messages for ${contact.pubkey}`);
          
          if (messages && messages.length > -1) {
            // Find the most recent message
            const lastMessage = messages.reduce((latest, msg) => {
              if (!latest || msg.created_at > latest.created_at) {
                console.log(`Found newer message for ${contact.pubkey}:`, msg.created_at);
                return msg;
              }
              return latest;
            }, null);
            
            if (lastMessage) {
              console.log(`Setting last message time for ${contact.pubkey}:`, {
                displayName: contact.displayName,
                timestamp: lastMessage.created_at,
                messageId: lastMessage.id
              });
              this.lastMessageTimes.set(contact.pubkey, lastMessage.created_at);
            }
          }
        } catch (error) {
          console.error(`Error fetching messages for contact ${contact.pubkey}:`, error);
        }
      }

      // Log the final state
      const contactsWithMessages = Array.from(this.lastMessageTimes.entries()).map(([pubkey, time]) => ({
        pubkey,
        displayName: this.contacts.get(pubkey)?.displayName,
        lastMessageTime: time
      }));
      console.log('Contacts with messages:', contactsWithMessages);
      
    } catch (error) {
      console.error('Error initializing message times:', error);
    }
    
    return Array.from(this.contacts.values());
  }

  updateLastMessageTime(pubkey, timestamp) {
    console.log(`Updating last message time for ${pubkey}:`, timestamp);
    const currentTime = this.lastMessageTimes.get(pubkey);
    if (!currentTime || timestamp > currentTime) {
      this.lastMessageTimes.set(pubkey, timestamp);
      console.log(`Updated lastMessageTimes for ${pubkey} to ${timestamp}`);
      const contact = this.contacts.get(pubkey) || this.ensureContact(pubkey);
      this.notifyUpdate(contact);
    }
  }

  getSortedContacts() {
    const allContacts = Array.from(this.contacts.values());
    
    // Sort contacts by last message time, most recent first
    return allContacts.sort((a, b) => {
      const timeA = this.lastMessageTimes.get(a.pubkey) || 0;
      const timeB = this.lastMessageTimes.get(b.pubkey) || 0;
      return timeB - timeA;
    });
  }

  updateStatus(pubkey, isOnline) {
    const contact = this.contacts.get(pubkey);
    if (contact) {
      contact.isOnline = isOnline;
      this.notifyUpdate(contact);
    }
  }

  notifyUpdate(contact) {
    chrome.runtime.sendMessage({
      type: 'CONTACT_UPDATED',
      data: contact
    });
  }

  async addChannel(channelData) {
    const channel = {
      ...channelData,
      isChannel: true,
      avatarUrl: channelData.picture || '/icons/default-channel.png',
      displayName: channelData.name || 'Unnamed Channel',
      description: channelData.about || '',
      pubkey: channelData.id
    };
    
    this.channels.set(channel.pubkey, channel);
    this.notifyUpdate(channel);
    return channel;
  }
}

export const contactManager = new ContactManager();

export async function fetchContacts(pubkey) {
  const filter = {
    kinds: [3],
    authors: [pubkey]
  };
  
  try {
    console.log('Fetching contacts for pubkey:', pubkey);
    await relayPool.ensureConnection();
    
    const relays = relayPool.getConnectedRelays();
    if (relays.length === 0) {
      throw new Error('No relays connected');
    }

    const events = await pool.list(relays, [filter]);
    
    if (!events || events.length === 0) {
      console.warn('No contact list found for pubkey:', pubkey);
      return [];
    }

    const contactEvent = events[0];
    console.log('Found contact list event:', contactEvent);

    if (!contactEvent.tags) {
      console.error('Contact list has no tags');
      return [];
    }

    const contactPubkeys = contactEvent.tags
      .filter(tag => tag[0] === 'p')
      .map(tag => tag[1]);

    console.log('Found contact pubkeys:', contactPubkeys.length);

    const contacts = await Promise.all(
      contactPubkeys.map(async (pubkey) => {
        try {
          const metadata = await getUserMetadata(pubkey);
          return {
            pubkey,
            npub: nostrCore.nip19.npubEncode(pubkey),
            displayName: metadata?.name || shortenIdentifier(nostrCore.nip19.npubEncode(pubkey)),
            avatarUrl: metadata?.picture || 'icons/default-avatar.png',
            isOnline: false
          };
        } catch (error) {
          console.error(`Error processing contact ${pubkey}:`, error);
          return null;
        }
      })
    );

    return contacts.filter(Boolean);
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return [];
  }
}

export function handleOnlineStatus(event) {
  const isOnline = event.content === 'online';
  updateContactStatus(event.pubkey, isOnline);
  chrome.runtime.sendMessage({
    type: 'onlineStatusUpdate',
    pubkey: event.pubkey,
    isOnline
  });
}

export function updateContactStatus(pubkey, isOnline) {
  contactManager.updateStatus(pubkey, isOnline);
}

export function getContact(pubkey) {
  return contactManager.contacts.get(pubkey);
}

export function setContacts(contactsList) {
  contactManager.contacts = new Map(contactsList.map(contact => [contact.pubkey, contact]));
}

export async function processContactEvent(event) {
  if (!event || !Array.isArray(event.tags)) {
    console.error('Invalid event format');
    return [];
  }

  const contacts = [];
  const channels = [];

  for (const tag of event.tags) {
    if (tag[0] === 'p') {
      // Handle regular contacts
      try {
        const pubkey = toLowerCaseHex(tag[1]);
        const metadata = await getUserMetadata(pubkey);
        const npub = nostrCore.nip19.npubEncode(pubkey);
        
        contacts.push({
          pubkey: pubkey.toLowerCase(),
          npub,
          displayName: metadata?.name || shortenIdentifier(npub),
          avatarUrl: metadata?.picture || '/icons/default-avatar.png',
          isOnline: false
        });
      } catch (error) {
        console.error(`Error processing contact ${tag[1]}:`, error);
      }
    } else if (tag[0] === 'e' && tag[3] === 'channel') {
      // Handle channel subscriptions
      try {
        const channelId = tag[1];
        const channelEvent = await pool.get(RELAYS, {
          ids: [channelId],
          kinds: [40]
        });
        
        if (channelEvent) {
          const content = JSON.parse(channelEvent.content);
          channels.push({
            id: channelEvent.id,
            pubkey: channelId,
            name: content.name || 'Unnamed Channel',
            about: content.about || '',
            picture: content.picture,
            isChannel: true,
            avatarUrl: content.picture || '/icons/default-channel.png',
            displayName: content.name || 'Unnamed Channel'
          });
        }
      } catch (error) {
        console.error(`Error processing channel ${tag[1]}:`, error);
      }
    }
  }

  // Update both contacts and channels in the manager
  contactManager.contacts = new Map(contacts.map(c => [c.pubkey, c]));
  contactManager.channels = new Map(channels.map(c => [c.pubkey, c]));

  return contacts;
}

export async function ensureContact(pubkey) {
  let contact = contactManager.contacts.get(pubkey);
  
  if (!contact) {
    const metadata = await getUserMetadata(pubkey);
    const npub = nostrCore.nip19.npubEncode(pubkey);
    
    contact = {
      pubkey: pubkey.toLowerCase(),
      npub,
      displayName: metadata?.name || shortenIdentifier(npub),
      avatarUrl: metadata?.picture || 'icons/default-avatar.png',
      isOnline: false,
      isTemporary: true // Mark as non-contact
    };
    
    contactManager.contacts.set(pubkey, contact);
  }
  
  return contact;
}

/**
 * @class ContactManager
 * @description Manages user contacts and channels in the Nostr network
 * 
 * Features:
 * - Contact list management
 * - Channel subscriptions
 * - Message time tracking
 * - Contact metadata caching
 * - Online status management
 * 
 * Core components:
 * - contacts: Map<string, Contact> - Stores contact information
 * - channels: Map<string, Channel> - Manages channel subscriptions
 * - lastMessageTimes: Map<string, number> - Tracks message timestamps
 * 
 * @example
 * const contacts = await contactManager.init(userPubkey);
 * await contactManager.addChannel(channelData);
 */