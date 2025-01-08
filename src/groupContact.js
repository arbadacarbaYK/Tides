document.addEventListener('DOMContentLoaded', () => {
  const { RELAYS, nostrCore, relayPool } = window;
  const NostrTools = window.NostrTools || nostrCore;

  // Create a new pool instance for groups
  const groupPool = new NostrTools.SimplePool();

  class GroupContactManager {
    constructor() {
      this.groups = new Map();
      this.leftGroups = new Set(); // Track groups we've left
      this.subscriptions = new Map();
      this.pool = groupPool;
    }

    async init() {
      try {
        await this.ensureAuth();
        const currentUser = await window.auth.getCurrentUser();
        if (!currentUser?.pubkey) {
          throw new Error('User not authenticated');
        }

        // Fetch initial groups
        const groups = await this.fetchUserGroups();
        
        // Set up subscriptions for group updates
        const connectedRelays = relayPool.getConnectedRelays();
        const filter = {
          kinds: [40, 41],
          '#p': [currentUser.pubkey.toLowerCase()]
        };

        const sub = this.pool.sub(connectedRelays, [filter]);
        sub.on('event', (event) => {
          if (this.validateGroupEvent(event)) {
            this.handleGroupUpdate(event);
          }
        });

        this.subscriptions.set('groups', sub);
        return groups;
      } catch (error) {
        console.error('Error initializing group manager:', error);
        throw error;
      }
    }

    async handleGroupUpdate(event) {
      try {
        console.log('Processing group event:', event);
        
        // Skip if this is a left group
        if (this.leftGroups.has(event.id)) {
          return;
        }

        let metadata = {};
        try {
          metadata = JSON.parse(event.content);
        } catch {
          metadata = { name: event.content || 'Unnamed Group' };
        }

        const groupId = event.kind === 40 ? event.id : 
                      event.tags.find(t => t[0] === 'e')?.[1] || event.id;

        // Get all members from p tags, ensuring lowercase
        let members = event.tags
          .filter(tag => tag[0] === 'p')
          .map(tag => tag[1].toLowerCase());

        // Get existing group if any
        const existingGroup = this.groups.get(groupId);
        
        // For kind 40 (creation), creator is always a member
        if (event.kind === 40) {
          const creatorPubkey = event.pubkey.toLowerCase();
          if (!members.includes(creatorPubkey)) {
            members.push(creatorPubkey);
          }
        }

        // If this is an update (kind 41), merge with existing members
        if (event.kind === 41 && existingGroup) {
          members = [...new Set([...existingGroup.members, ...members])];
        }

        // Handle picture URL
        let picture = 'icons/default-group.png';
        if (metadata.picture || metadata.image) {
          const picUrl = (metadata.picture || metadata.image).trim();
          if (picUrl && picUrl.match(/^https?:\/\/.+/)) {
            // Only use URLs that start with http(s)://
            picture = picUrl;
          }
        }

        const group = {
          id: groupId,
          name: metadata.name || metadata.title || 'Unnamed Group',
          about: metadata.about || metadata.description || '',
          picture,
          creator: event.kind === 40 ? event.pubkey.toLowerCase() : existingGroup?.creator,
          created_at: event.created_at,
          members: [...new Set(members)], // Deduplicate members
          lastMessage: existingGroup?.lastMessage || null,
          kind: event.kind,
          isGroup: true // Explicitly mark as group
        };

        console.log('Updated group data:', group);

        // Update the group in our map
        this.groups.set(groupId, group);

        // Trigger UI update
        if (typeof window.renderContactList === 'function') {
          const contacts = window.contactManager?.contacts ? 
            Array.from(window.contactManager.contacts.values()) : [];
          window.renderContactList(contacts);
        }
      } catch (error) {
        console.error('Error handling group update:', error);
      }
    }

    async ensureAuth() {
      let retries = 0;
      while (!window.auth && retries < 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }

      if (!window.auth) {
        throw new Error('Auth is not available');
      }

      if (window.auth.currentUser) {
        return;
      }

      if (window.auth.getStoredCredentials) {
        await window.auth.getStoredCredentials();
      } else {
        throw new Error('Auth is not properly initialized');
      }
    }

    async fetchUserGroups() {
      try {
        const currentUser = await window.auth.getCurrentUser();
        if (!currentUser?.pubkey) {
          throw new Error('User not authenticated');
        }

        // Fetch all group events for the user
        const filters = [
          // Group creation events
          {
            kinds: [40],
            '#p': [currentUser.pubkey.toLowerCase()]
          },
          // Group metadata events
          {
            kinds: [41],
            '#p': [currentUser.pubkey.toLowerCase()]
          },
          // Events by the user (to catch leave events)
          {
            kinds: [40, 41],
            authors: [currentUser.pubkey.toLowerCase()]
          }
        ];

        console.log('Fetching all user groups with filters:', filters);
        const events = await this.pool.list(relayPool.getConnectedRelays(), filters);
        console.log('Found', events.length, 'groups for user', currentUser.pubkey);
        console.log('Raw group events:', events);

        // First process leave events to build the leftGroups set
        events
          .filter(event => event.kind === 41)
          .forEach(event => {
            try {
              const content = JSON.parse(event.content);
              if (content.action === 'leave') {
                const groupId = event.tags.find(t => t[0] === 'e')?.[1];
                if (groupId) {
                  this.leftGroups.add(groupId);
                  console.log('Found leave event for group:', groupId);
                  // Also remove from groups if it exists
                  this.groups.delete(groupId);
                }
              }
            } catch (e) {
              console.warn('Error parsing leave event:', e);
            }
          });

        // Clear existing groups and rebuild from events
        this.groups.clear();

        // Process events in chronological order
        const validGroups = events
          .filter(event => this.validateGroupEvent(event))
          .filter(event => !this.leftGroups.has(event.id))
          .sort((a, b) => a.created_at - b.created_at);

        // Process each event to build up the groups map
        validGroups.forEach(event => {
          // Skip if this is a group we've left
          const groupId = event.kind === 40 ? event.id : 
                         event.tags.find(t => t[0] === 'e')?.[1] || event.id;
          if (this.leftGroups.has(groupId)) {
            return;
          }
          this.handleGroupUpdate(event);
        });

        console.log('Final groups in manager:', Array.from(this.groups.values()));
        return Array.from(this.groups.values());
      } catch (error) {
        console.error('Error fetching user groups:', error);
        throw error;
      }
    }

    validateGroupEvent(event) {
      try {
        console.log('Validating group event:', event);
        
        if (!event || typeof event !== 'object') {
          console.log('Invalid event: not an object');
          return false;
        }

        if (!event.id) {
          console.log('Invalid event: no id');
          return false;
        }
        
        if (!event.pubkey) {
          console.log('Invalid event: no pubkey');
          return false;
        }
        
        if (!event.created_at) {
          console.log('Invalid event: no created_at');
          return false;
        }
        
        if (![40, 41].includes(event.kind)) {
          console.log('Invalid event: wrong kind', event.kind);
          return false;
        }

        // For kind 40 (group creation), must have content
        if (event.kind === 40 && !event.content) {
          console.log('Invalid kind 40 event: no content');
          return false;
        }

        // For kind 41 (group metadata/leave), check for leave action
        if (event.kind === 41) {
          try {
            const content = JSON.parse(event.content);
            if (content.action === 'leave') {
              // Get all referenced group IDs from 'e' tags
              const groupIds = event.tags
                .filter(t => t[0] === 'e')
                .map(t => t[1]);
              
              if (groupIds.length > 0) {
                // Add all referenced groups to leftGroups set
                groupIds.forEach(groupId => {
                  this.leftGroups.add(groupId);
                  // Remove from groups map
                  this.groups.delete(groupId);
                  console.log('Group left:', groupId);
                  // Emit an event that the group was left
                  window.dispatchEvent(new CustomEvent('groupLeft', { detail: { groupId } }));
                });
                return false;
              }
            }
          } catch (e) {
            console.warn('Error parsing kind 41 content:', e);
          }

          const hasGroupRef = event.tags.some(t => t[0] === 'e');
          const hasMembers = event.tags.some(t => t[0] === 'p');
          if (!hasGroupRef && !hasMembers) {
            console.log('Invalid kind 41 event: neither group reference nor members found');
            return false;
          }
        }

        // For kind 40, creator is an implicit member
        // For kind 41, check for explicit members or creator
        if (event.kind === 40 || event.tags.some(t => t[0] === 'p')) {
          // Get all referenced group IDs from 'e' tags for this event
          const groupIds = event.tags
            .filter(t => t[0] === 'e')
            .map(t => t[1]);
          
          // Check if any of the referenced groups are in leftGroups
          if (groupIds.some(id => this.leftGroups.has(id))) {
            console.log('Skipping event for left group:', groupIds.join(', '));
            return false;
          }
          
          console.log('Event validated successfully');
          return true;
        }

        console.log('Invalid event: no members and not a creation event');
        return false;
      } catch (err) {
        console.error('Group event validation failed:', err);
        return false;
      }
    }

    async createGroup(name, about = '', members = [], picture = '') {
      const currentUser = await auth.getCurrentUser();
      if (!currentUser?.pubkey) {
        throw new Error('User not authenticated');
      }

      try {
        // For NIP-07, ensure we have permissions
        if (currentUser.type === 'NIP-07') {
          await window.nostr.enable();
        }

        const metadata = {
          name,
          about,
          picture: (picture || '').trim() || 'icons/default-group.png',
          created_at: Math.floor(Date.now() / 1000)
        };

        const event = {
          kind: 41, // Group metadata kind
          pubkey: currentUser.pubkey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['p', currentUser.pubkey], // Creator is always a member
            ...members.map(pubkey => ['p', pubkey.toLowerCase()]),
            ['client', 'tides']
          ],
          content: JSON.stringify(metadata)
        };

        event.id = NostrTools.getEventHash(event);
        
        if (currentUser.type === 'NIP-07') {
          event.sig = await window.nostr.signEvent(event);
        } else {
          event.sig = NostrTools.getSignature(event, currentUser.privkey);
        }

        const relays = relayPool.getConnectedRelays();
        await Promise.race([
          this.pool.publish(relays, event),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Publish timeout')), 5000))
        ]);

        const group = {
          id: event.id,
          name,
          about,
          picture: (picture || '').trim() || 'icons/default-group.png',
          creator: currentUser.pubkey,
          created_at: event.created_at,
          members: [currentUser.pubkey, ...members],
          lastMessage: null
        };

        this.groups.set(group.id, group);
        
        // Trigger UI update after successful group creation
        if (typeof window.renderContactList === 'function') {
          const contacts = window.contactManager?.contacts ? 
            Array.from(window.contactManager.contacts.values()) : [];
          window.renderContactList(contacts);
        }
        
        return group;
      } catch (error) {
        console.error('Error creating group:', error);
        throw error;
      }
    }

    async updateGroupMetadata(groupId, updates) {
      const group = this.groups.get(groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      const currentUser = await auth.getCurrentUser();
      if (!currentUser?.pubkey || currentUser.pubkey !== group.creator) {
        throw new Error('Only group creator can update metadata');
      }

      try {
        const metadata = {
          name: updates.name || group.name,
          about: updates.about || group.about,
          picture: updates.picture || group.picture,
          updated_at: Math.floor(Date.now() / 1000)
        };

        const event = {
          kind: 41,
          pubkey: currentUser.pubkey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ...group.members.map(pubkey => ['p', pubkey.toLowerCase()]),
            ['client', 'tides']
          ],
          content: JSON.stringify(metadata)
        };

        event.id = nostrCore.getEventHash(event);
        
        if (currentUser.type === 'NIP-07') {
          event.sig = await window.nostr.signEvent(event);
        } else {
          event.sig = nostrCore.getSignature(event, currentUser.privkey);
        }

        const relays = relayPool.getConnectedRelays();
        await Promise.race([
          this.pool.publish(relays, event),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Publish timeout')), 5000))
        ]);

        // Update local group data
        const updatedGroup = {
          ...group,
          ...updates,
          updated_at: event.created_at
        };

        this.groups.set(groupId, updatedGroup);
        return updatedGroup;
      } catch (error) {
        console.error('Error updating group metadata:', error);
        throw error;
      }
    }

    cleanup() {
      this.subscriptions.forEach(sub => sub.unsub());
      this.subscriptions.clear();
      this.groups.clear();
    }

    // Add method to check if a group is left
    isGroupLeft(groupId) {
      return this.leftGroups.has(groupId);
    }
  }

  // Create a single instance
  const groupContactManager = new GroupContactManager();

  // Make everything available on window
  window.groupContactManager = groupContactManager;
  window.fetchUserGroups = groupContactManager.fetchUserGroups.bind(groupContactManager);
  window.createGroup = groupContactManager.createGroup.bind(groupContactManager);
  window.updateGroupMetadata = groupContactManager.updateGroupMetadata.bind(groupContactManager);
  window.getGroups = () => Array.from(groupContactManager.groups.values());
});