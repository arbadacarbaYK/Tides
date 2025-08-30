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
    console.log('CONTACT INIT: Starting init method');
    const contacts = await fetchContacts(pubkey);
    console.log('CONTACT INIT: Got contacts array:', contacts?.length, 'contacts');
    console.log('CONTACT INIT: First few contacts:', contacts?.slice(0, 3));
    this.contacts = new Map(contacts.map(c => [c.pubkey, c]));
    console.log('CONTACT INIT: Successfully created contacts Map with', this.contacts.size, 'entries');
    
    try {
      console.log('CONTACT INIT: Starting try block');
      // Wait for authentication
      const currentUser = await auth.getCurrentUser();
      console.log('CONTACT INIT: Got current user:', currentUser?.pubkey?.slice(0,8));
      if (!currentUser) {
        console.error('User not authenticated');
        return Array.from(this.contacts.values());
      }
      console.log('CONTACT INIT: User authenticated, proceeding to message fetching');

      // Skip user relay fetching for now to avoid blocking the init process

      // Clear existing message times
      this.lastMessageTimes.clear();

      // Find DM conversations efficiently by querying for all DMs first
      console.log('Finding DM conversations efficiently...');
      try {
        // Query for all DMs involving the current user (no limits to catch old conversations)
        const dmFilters = [
          {
            kinds: [4, 14],
            authors: [currentUser.pubkey]
            // No limit - we want ALL DMs the user has ever sent
          },
          {
            kinds: [4, 14],
            '#p': [currentUser.pubkey]
            // No limit - we want ALL DMs the user has ever received
          }
        ];

        console.log('Fetching all DM events...');
        
        // Ensure we have at least one connected relay before proceeding
        const connectedRelays = relayPool.getConnectedRelays();
        if (connectedRelays.length === 0) {
          console.log('No connected relays available, attempting to connect...');
          const connected = await relayPool.ensureConnection();
          if (!connected) {
            console.error('Failed to connect to any relays');
            return Array.from(this.contacts.values());
          }
        }
        
        const dmEvents = await pool.list(relayPool.getConnectedRelays(), dmFilters);
        console.log(`Found ${dmEvents.length} total DM events`);

        // Group DMs by conversation partner
        const conversationMap = new Map();
        
        for (const event of dmEvents) {
          let partnerPubkey;
          
          if (event.pubkey === currentUser.pubkey) {
            // Sent by current user - find recipient in p tags
            const pTag = event.tags.find(tag => tag[0] === 'p');
            if (pTag && pTag[1]) {
              partnerPubkey = pTag[1];
            }
          } else {
            // Received by current user - sender is the partner
            partnerPubkey = event.pubkey;
          }
          
          if (partnerPubkey && partnerPubkey !== currentUser.pubkey) {
            // Simply add to conversation map without content filtering
            // (Content filtering will happen during individual conversation display)
            if (!conversationMap.has(partnerPubkey) || event.created_at > conversationMap.get(partnerPubkey)) {
              conversationMap.set(partnerPubkey, event.created_at);
            }
          }
        }

        console.log(`Found ${conversationMap.size} DM conversations`);
        
        // Debug: Check for missing expected contacts
        const expectedContacts = [
          '5fe000e4791c11ff7e898b360964fd3cf194e6976fb79a75b20be54aaf7b0a79', // Jan
          '00aa61fe312f3d565247b9beeff478d571c9565da38b24a3b2d442488fb86427', // Mikih  
          '6c2d68ba016c291417fd18ea7c06b737ec143f7d56d78fdd44a5b248846525ec'  // Quillie
        ];
        
        for (const expectedPubkey of expectedContacts) {
          if (!conversationMap.has(expectedPubkey)) {
            console.log(`MISSING: Expected contact ${expectedPubkey.slice(0,8)} not found in DM conversations`);
            
            // Check if they're in our contact list
            if (this.contacts.has(expectedPubkey)) {
              console.log(`Contact ${expectedPubkey.slice(0,8)} IS in contact list but NO DM conversation found`);
              
              // Try individual fetching for missing expected contacts
              console.log(`Attempting individual fetch for missing contact ${expectedPubkey.slice(0,8)}`);
              try {
                const individualMessages = await messageManager.fetchMessages(expectedPubkey);
                if (individualMessages && individualMessages.length > 0) {
            // Find the most recent message
                  const lastMessage = individualMessages.reduce((latest, msg) => {
              if (!latest || msg.created_at > latest.created_at) {
                return msg;
              }
              return latest;
            }, null);
            
            if (lastMessage) {
                    conversationMap.set(expectedPubkey, lastMessage.created_at);
                    console.log(`Individual fetch SUCCESS: Found ${individualMessages.length} messages for ${expectedPubkey.slice(0,8)}, latest: ${lastMessage.created_at}`);
                  }
                } else {
                  console.log(`Individual fetch FAILED: No messages found for ${expectedPubkey.slice(0,8)}`);
                }
              } catch (error) {
                console.error(`Error in individual fetch for ${expectedPubkey.slice(0,8)}:`, error);
              }
            } else {
              console.log(`Contact ${expectedPubkey.slice(0,8)} is NOT in contact list at all`);
            }
          } else {
            console.log(`FOUND: Expected contact ${expectedPubkey.slice(0,8)} has DM conversation`);
          }
        }
        
        // Get current follow list to filter out unfollowed contacts
        let currentFollowList = [];
        try {
          const followListEvents = await pool.list(relayPool.getConnectedRelays(), [
            {
              kinds: [3],
              authors: [currentUser.pubkey],
              limit: 1
            }
          ]);
          
          if (followListEvents.length > 0) {
            currentFollowList = followListEvents[0].tags
              .filter(tag => tag[0] === 'p')
              .map(tag => tag[1]);
          }
        } catch (error) {
          console.error('Error fetching follow list:', error);
        }
        
        // Get current mute list to filter out muted contacts
        let currentMuteList = [];
        try {
          const muteEvents = await pool.list(relayPool.getConnectedRelays(), [
            {
              kinds: [10000],
              authors: [currentUser.pubkey],
              limit: 1
            }
          ]);
          
          if (muteEvents.length > 0) {
            currentMuteList = muteEvents[0].tags
              .filter(tag => tag[0] === 'p')
              .map(tag => tag[1]);
          }
          console.log(`Found ${currentMuteList.length} muted contacts`);
          
                  // Load blocked contacts from storage FIRST (before processing mute list)
        try {
          const blockedResult = await chrome.storage.local.get('blockedContacts');
          if (blockedResult.blockedContacts && blockedResult.blockedContacts.length > 0) {
            if (!window.blockedContacts) {
              window.blockedContacts = new Set();
            }
            // Don't clear - ADD to existing blocked contacts
            blockedResult.blockedContacts.forEach(pubkey => window.blockedContacts.add(pubkey));
            console.log(`Loaded ${window.blockedContacts.size} blocked contacts from storage:`, Array.from(window.blockedContacts));
          } else {
            if (!window.blockedContacts) {
              window.blockedContacts = new Set();
            }
          }
        } catch (error) {
          console.error('Error loading blocked contacts from storage:', error);
          if (!window.blockedContacts) {
            window.blockedContacts = new Set();
          }
        }
        
        // Now add muted contacts from relays to the existing blocked contacts
        currentMuteList.forEach(pubkey => window.blockedContacts.add(pubkey));
        console.log(`Added ${currentMuteList.length} muted contacts from relays. Total blocked: ${window.blockedContacts.size}`);
        
        // Persist blocked contacts to storage for persistence across reloads
        try {
          await chrome.storage.local.set({
            blockedContacts: Array.from(window.blockedContacts)
          });
          console.log(`Persisted ${window.blockedContacts.size} blocked contacts to storage`);
        } catch (error) {
          console.error('Error persisting blocked contacts:', error);
        }
        } catch (error) {
          console.error('Error fetching mute list:', error);
        }
        
        // Only filter out contacts that were explicitly unfollowed via the unfollow button
        // Don't remove all contacts not in follow list - they might be DM conversations
        console.log(`Follow list contains ${currentFollowList.length} contacts`);
        console.log(`Contact map has ${this.contacts.size} contacts before filtering`);
        
        // Filter out muted contacts from the contacts Map entirely
        for (const [pubkey, contact] of this.contacts.entries()) {
          if (currentMuteList.includes(pubkey)) {
            console.log(`Removing muted contact ${pubkey.slice(0,8)} from contacts`);
            this.contacts.delete(pubkey);
          }
        }
        
        // Filter out blocked contacts from the contacts Map
        if (window.blockedContacts) {
          for (const [pubkey, contact] of this.contacts.entries()) {
            if (window.blockedContacts.has(pubkey)) {
              console.log(`Removing blocked contact ${pubkey.slice(0,8)} from contacts`);
              this.contacts.delete(pubkey);
            }
          }
        }
        
        // Also filter out locally unfollowed contacts from storage
        try {
          // First check if window.unfollowedContacts is already loaded
          let unfollowedSet = new Set();
          
          if (window.unfollowedContacts) {
            unfollowedSet = window.unfollowedContacts;
            console.log(`Using window.unfollowedContacts with ${unfollowedSet.size} entries`);
          } else {
            // Fallback to loading from storage
            const result = await chrome.storage.local.get('unfollowedContacts');
            if (result.unfollowedContacts) {
              unfollowedSet = new Set(result.unfollowedContacts);
              console.log(`Loaded ${unfollowedSet.size} unfollowed contacts from storage`);
            }
          }
          
          // Filter out unfollowed contacts
          for (const [pubkey, contact] of this.contacts.entries()) {
            if (unfollowedSet.has(pubkey)) {
              console.log(`Removing unfollowed contact ${pubkey.slice(0,8)} from contacts`);
              this.contacts.delete(pubkey);
            }
          }
          
          // Also filter out blocked contacts that might have been added back
          if (window.blockedContacts) {
            for (const [pubkey, contact] of this.contacts.entries()) {
              if (window.blockedContacts.has(pubkey)) {
                console.log(`Removing blocked contact ${pubkey.slice(0,8)} from contacts (double-check)`);
                this.contacts.delete(pubkey);
              }
            }
          }
        } catch (error) {
          console.error('Error loading unfollowed contacts:', error);
        }
        
        // Update lastMessageTimes for contacts who have conversations AND are still followed
        for (const [partnerPubkey, lastMessageTime] of conversationMap.entries()) {
          if (this.contacts.has(partnerPubkey)) {
            // Skip nostrmarket contact (known spam)
            if (partnerPubkey === '244c2c9ace2675a8500cd57a0bc5eb44fb806e4af57682008606a29e80087b4e') {
              console.log(`Skipping nostrmarket contact ${partnerPubkey.slice(0,8)}`);
              continue;
            }
            
            // No need to check follow list again - already filtered above
            this.lastMessageTimes.set(partnerPubkey, lastMessageTime);
            console.log(`Set message time for contact ${partnerPubkey.slice(0,8)}: ${lastMessageTime}`);
          }
        }
        
      } catch (error) {
        console.error('Error finding DM conversations:', error);
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

    // Collect contact pubkeys from both contact lists and message events
    const contactPubkeys = new Set();
    
    // Add contacts from kind 3 contact list
    const pTags = contactEvent.tags.filter(tag => tag[0] === 'p');
    pTags.forEach(tag => {
      if (tag[1]) {
        contactPubkeys.add(tag[1]);
      }
    });
    
    // Also fetch kind 4 message events to discover contacts from messages
    const messageFilter = {
      kinds: [4, 14],
      '#p': [pubkey]
    };
    
    const messageEvents = await pool.list(relays, [messageFilter]);
    messageEvents.forEach(event => {
      if (event.pubkey && event.pubkey !== pubkey) {
        contactPubkeys.add(event.pubkey);
      }
    });

    console.log(`Found contact pubkeys: ${contactPubkeys.size}`);

    const contacts = await Promise.all(
      Array.from(contactPubkeys).map(async (pubkey) => {
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
    // Check if this contact was previously unfollowed or blocked
    if (window.unfollowedContacts && window.unfollowedContacts.has(pubkey)) {
      console.log(`Skipping creation of unfollowed contact ${pubkey.slice(0,8)}`);
      return null;
    }
    
    // TODO: Also check network-level blocking (NIP-25) here if needed
    // For now, local unfollowed list covers both cases
    
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