import { pool, relayPool, RELAYS, nostrCore, shortenIdentifier } from './shared.js';
import { getUserMetadata } from './userMetadata.js';
import { toLowerCaseHex } from './utils.js';
import { generateCredentialFormats } from './utils.js';
import { messageManager } from './messages.js';

class ContactManager {
  constructor() {
    this.contacts = new Map();
    this.channels = new Map();
    this.subscriptions = new Map();
  }

  async init(pubkey) {
    const contacts = await fetchContacts(pubkey);
    this.contacts = new Map(contacts.map(c => [c.pubkey, c]));
    return Array.from(this.contacts.values());
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
      contactPubkeys.map(pubkey => processContactMetadata(pubkey))
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

async function processContactMetadata(pubkey) {
  try {
    const metadata = await getUserMetadata(pubkey);
    const hasMessages = await messageManager.hasMessages(pubkey);
    console.log(`Processing contact ${pubkey}, hasMessages:`, hasMessages);
    
    // Get existing contact if any
    let contact = contactManager.contacts.get(pubkey);
    
    // Create a default contact object first
    const defaultContact = {
      pubkey,
      npub: nostrCore.nip19.npubEncode(pubkey),
      displayName: shortenIdentifier(nostrCore.nip19.npubEncode(pubkey)),
      avatarUrl: '/icons/default-avatar.png',
      isOnline: contact?.isOnline || false,
      hasMessages: hasMessages // Set from actual check
    };

    // Only update fields if metadata exists and is valid
    if (metadata) {
      defaultContact.displayName = metadata.name || defaultContact.displayName;
      defaultContact.avatarUrl = metadata.picture || defaultContact.avatarUrl;
      if (metadata.about) defaultContact.about = metadata.about;
    }

    // Merge with any existing contact data, preserving hasMessages if true in either
    contact = {
      ...(contact || {}),
      ...defaultContact,
      hasMessages: hasMessages || contact?.hasMessages || false
    };

    console.log(`Updated contact ${pubkey}:`, contact);

    // Store in contacts map and notify update
    contactManager.contacts.set(pubkey, contact);
    contactManager.notifyUpdate(contact);
    return contact;
  } catch (error) {
    console.error(`Error processing metadata for ${pubkey}:`, error);
    // Still create a basic contact even if metadata fails
    const npub = nostrCore.nip19.npubEncode(pubkey);
    const hasMessages = await messageManager.hasMessages(pubkey).catch(() => false);
    const contact = {
      pubkey,
      npub,
      displayName: shortenIdentifier(npub),
      avatarUrl: '/icons/default-avatar.png',
      isOnline: false,
      hasMessages
    };
    contactManager.contacts.set(pubkey, contact);
    contactManager.notifyUpdate(contact);
    return contact;
  }
}

// Add this function to periodically check message status
async function updateContactsMessageStatus() {
  console.log('Updating contacts message status...');
  const contacts = Array.from(contactManager.contacts.values());
  for (const contact of contacts) {
    try {
      const hasMessages = await messageManager.hasMessages(contact.pubkey);
      console.log(`Checking messages for ${contact.pubkey}:`, hasMessages);
      if (hasMessages !== contact.hasMessages) {
        contact.hasMessages = hasMessages;
        contactManager.notifyUpdate(contact);
        console.log(`Updated hasMessages for ${contact.pubkey} to ${hasMessages}`);
      }
    } catch (error) {
      console.error(`Failed to check messages for ${contact.pubkey}:`, error);
    }
  }
}

// Call updateContactsMessageStatus periodically
setInterval(updateContactsMessageStatus, 60000); // Check every minute

// Listen for new messages using chrome.runtime.onMessage
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'NEW_MESSAGE') {
    const contact = contactManager.contacts.get(message.data.pubkey);
    if (contact && !contact.hasMessages) {
      contact.hasMessages = true;
      contactManager.notifyUpdate(contact);
      console.log(`Updated hasMessages for ${message.data.pubkey} due to new message`);
    }
  }
  return true;
});
