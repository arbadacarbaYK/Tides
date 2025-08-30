console.log('🚨 groupContact.js LOADING STARTED!');

// Initialize immediately when script loads
console.log('🚨 groupContact.js LOADING STARTED!');

// Check if required dependencies exist
if (!window.RELAYS || !window.nostrCore || !window.relayPool) {
  console.error('❌ Required dependencies missing for groupContact.js:', {
    RELAYS: !!window.RELAYS,
    nostrCore: !!window.nostrCore,
    relayPool: !!window.relayPool
  });
  // Don't initialize if dependencies are missing
} else {
  const { RELAYS, nostrCore, relayPool } = window;
  const NostrTools = window.NostrTools || nostrCore;

  class GroupContactManager {
    constructor() {
      console.log('🚨 GroupContactManager constructor called!');
      this.groups = new Map();
      this.leftGroups = new Set(); // Track groups we've left
      this.subscriptions = new Map();
      this.pool = window.pool;
    }

    async init() {
      try {
        await this.ensureAuth();
        // Ensure relay connections are established for subscriptions
        await relayPool.ensureConnection();
        const currentUser = await window.auth.getCurrentUser();
        if (!currentUser?.pubkey) {
          throw new Error('User not authenticated');
        }

        // Fetch initial groups
        const groups = await this.fetchUserGroups();
        
        // Set up subscriptions for group updates
        const connectedRelays = relayPool.getConnectedRelays();
        
        // CRITICAL FIX: Subscribe to BOTH events where user is tagged AND events created by user
        const filters = [
          // Events where user is tagged as member
          {
            kinds: [40, 41],
            '#p': [currentUser.pubkey.toLowerCase()]
          },
          // Events created by the user (for group creation)
          {
            kinds: [40, 41],
            authors: [currentUser.pubkey.toLowerCase()]
          }
        ];

        console.log('🔧 Setting up group subscriptions with filters:', filters);
        const sub = this.pool.sub(connectedRelays, filters);
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

        let metadata = {};
        try {
          metadata = JSON.parse(event.content);
        } catch {
          metadata = { name: event.content || 'Unnamed Group' };
        }

        // Determine group ID based on event kind
        let groupId;
        if (event.kind === 40) {
          // For creation events, use the event ID as the group ID
          groupId = event.id;
        } else if (event.kind === 41) {
          // For update events, look for group reference in 'e' tags
          groupId = event.tags.find(t => t[0] === 'e')?.[1];
          if (!groupId) {
            console.log('Kind 41 event has no group reference, using event ID');
            groupId = event.id;
          }
        }

        // Now that we have a groupId, skip updates for groups we've left
        if (groupId && this.leftGroups.has(groupId)) {
          console.log('Skipping event for left group:', groupId);
          return;
        }

        if (!groupId) {
          console.log('No valid group ID found for event');
          return;
        }

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
          console.log('✅ Processing group creation event for group:', groupId);
        } else if (event.kind === 41) {
          console.log('✅ Processing group update event for group:', groupId);
          // If this is an update, merge with existing members
          if (existingGroup) {
            members = [...new Set([...existingGroup.members, ...members])];
          }
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

        // UI update will be handled by popup.js when it detects the group update
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
        // Ensure relay connections before listing
        await relayPool.ensureConnection();
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
        console.log('🔍 Processing leave events to build leftGroups set...');
        events
          .filter(event => event.kind === 41)
          .forEach(event => {
            try {
              const content = JSON.parse(event.content);
              if (content.action === 'leave') {
                const groupId = event.tags.find(t => t[0] === 'e')?.[1];
                if (groupId) {
                  this.leftGroups.add(groupId);
                  console.log('🚫 Found leave event for group:', groupId);
                  // Also remove from groups if it exists
                  this.groups.delete(groupId);
                }
              }
            } catch (e) {
              console.warn('Error parsing leave event:', e);
            }
          });

        console.log('📋 Left groups set:', Array.from(this.leftGroups));

        // Clear existing groups and rebuild from events
        this.groups.clear();

        // Process events in chronological order, filtering out left groups
        const validGroups = events
          .filter(event => this.validateGroupEvent(event))
          .sort((a, b) => a.created_at - b.created_at);

        console.log('✅ Valid groups to process:', validGroups.length);

        // Process each event to build up the groups map
        validGroups.forEach(event => {
          // Determine group ID for this event
          let groupId;
          if (event.kind === 40) {
            groupId = event.id;
          } else if (event.kind === 41) {
            groupId = event.tags.find(t => t[0] === 'e')?.[1] || event.id;
          }

          // Skip if this is a group we've left
          if (groupId && this.leftGroups.has(groupId)) {
            console.log('🚫 Skipping left group:', groupId);
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

        // For kind 40 (group creation), must have content and be a valid creation event
        if (event.kind === 40) {
          if (!event.content) {
            console.log('Invalid kind 40 event: no content');
            return false;
          }
          
          // Must have at least one member (creator)
          const hasMembers = event.tags.some(t => t[0] === 'p');
          if (!hasMembers) {
            console.log('Invalid kind 40 event: no members found');
            return false;
          }
          
          console.log('✅ Kind 40 (creation) event validated successfully');
          return true;
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
                return false; // Don't process leave events as regular group events
              }
            }
          } catch (e) {
            console.warn('Error parsing kind 41 content:', e);
          }

          // For kind 41 updates, must have either group reference or members
          const hasGroupRef = event.tags.some(t => t[0] === 'e');
          const hasMembers = event.tags.some(t => t[0] === 'p');
          if (!hasGroupRef && !hasMembers) {
            console.log('Invalid kind 41 event: neither group reference nor members found');
            return false;
          }
          
          // Check if any referenced groups are in leftGroups
          if (hasGroupRef) {
            const groupIds = event.tags
              .filter(t => t[0] === 'e')
              .map(t => t[1]);
            
            if (groupIds.some(id => this.leftGroups.has(id))) {
              console.log('Skipping event for left group:', groupIds.join(', '));
              return false;
            }
          }
          
          console.log('✅ Kind 41 (update) event validated successfully');
          return true;
        }

        console.log('Invalid event: unexpected kind', event.kind);
        return false;
      } catch (err) {
        console.error('Group event validation failed:', err);
        return false;
      }
    }

    async createGroup(name, about = '', members = [], picture = '') {
      // CRITICAL: Immediate logging to confirm method is called
      console.log('🎯 createGroup called with:', { name, about, members, picture });
      console.log('🎯 This is the REAL createGroup method from groupContact.js!');
      console.log('🎯 Method execution started at:', new Date().toISOString());
      // Avoid logging sensitive user details
      const cu = await auth.getCurrentUser();
      console.log('🎯 Current user present:', !!cu?.pubkey);
      console.log('🎯 THIS METHOD SHOULD BE BOUND TO THE INSTANCE!');
      
      // CRITICAL: Add error handling to catch any issues
      try {
        console.log('🔐 Starting authentication check...');
        const currentUser = await auth.getCurrentUser();
        if (!currentUser?.pubkey) {
          throw new Error('User not authenticated');
        }
        
        console.log('✅ User authenticated:', currentUser.pubkey);
        console.log('✅ User type:', currentUser.type);
        console.log('✅ User pubkey:', currentUser.pubkey);

        // For NIP-07, ensure we have permissions
        if (currentUser.type === 'NIP-07') {
          console.log('🔐 NIP-07 user, checking permissions...');
          await window.nostr.enable();
          console.log('✅ NIP-07 permissions granted');
        }

        const metadata = {
          name,
          about,
          picture: (picture || '').trim() || 'icons/default-group.png',
          created_at: Math.floor(Date.now() / 1000)
        };

        // Create the group creation event (kind 40)
        const event = {
          kind: 40, // Group creation kind - MUST be 40 for new groups
          pubkey: currentUser.pubkey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['p', currentUser.pubkey], // Creator is always a member
            ...members.map(pubkey => ['p', pubkey.toLowerCase()]),
            ['client', 'tides']
          ],
          content: JSON.stringify(metadata)
        };

        // Preparing to sign group creation event

        if (currentUser.type === 'NIP-07') {
          // Signing with NIP-07...
          const signed = await window.nostr.signEvent(event);
          event.id = signed.id;
          event.sig = signed.sig;
          event.pubkey = signed.pubkey;
          // Event signed with NIP-07
        } else {
          // Signing with private key...
          event.id = NostrTools.getEventHash(event);
          event.sig = NostrTools.getSignature(event, currentUser.privkey);
          // Event signed with private key
        }

        // Publishing group creation event

        // Ensure connections and use the main shared pool
        await relayPool.ensureConnection();
        const relays = relayPool.getConnectedRelays();
        // Filter out known read-only or restricted relays
        const writableRelays = relays.filter(url => !/nostr\.wine|nostr\.band|primal|nostr\.watch|relay\.nostr\.net|inbox\.azzamo\.net/i.test(url));
        console.log('📡 Publishing to relays (writable filtered):', writableRelays);
        
        if (writableRelays.length === 0) {
          throw new Error('No relays connected');
        }

        console.log('⏳ Waiting for publish ack...');
        await new Promise((resolve, reject) => {
          let settled = false;
          const timeout = setTimeout(() => {
            if (!settled) reject(new Error('Publish timeout'));
          }, 10000);
          try {
            const pub = window.pool.publish(writableRelays, event);
            pub.on('ok', (relay) => {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                console.log('✅ Relay ok:', relay?.url || relay);
                resolve(true);
              }
            });
            pub.on('seen', (relay) => {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                console.log('✅ Relay seen:', relay?.url || relay);
                resolve(true);
              }
            });
            pub.on('failed', (relay, reason) => {
              console.warn('⚠️ Publish failed:', relay?.url || relay, reason);
              // wait for other relays or timeout
            });
          } catch (e) {
            clearTimeout(timeout);
            reject(e);
          }
        });

        console.log('✅ Group creation ack received');

        const group = {
          id: event.id,
          name,
          about,
          picture: (picture || '').trim() || 'icons/default-group.png',
          creator: currentUser.pubkey,
          created_at: event.created_at,
          members: [currentUser.pubkey, ...members],
          lastMessage: null,
          kind: 40 // Explicitly mark as creation event
        };

        this.groups.set(group.id, group);
        console.log('✅ Group added to local groups map:', group);
        
        // UI update will be handled by popup.js when it detects the new group
        
        console.log('🎉 Group creation completed successfully!');
        return group;
      } catch (error) {
        console.error('❌ Error creating group:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Error name:', error.name);
        console.error('❌ Error message:', error.message);
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

        if (currentUser.type === 'NIP-07') {
          const signed = await window.nostr.signEvent(event);
          event.id = signed.id;
          event.sig = signed.sig;
          event.pubkey = signed.pubkey;
        } else {
          event.id = nostrCore.getEventHash(event);
          event.sig = nostrCore.getSignature(event, currentUser.privkey);
        }

        const relays = relayPool.getConnectedRelays();
        const writableRelays = relays.filter(url => !/nostr\.wine|nostr\.band|primal|nostr\.watch|relay\.nostr\.net|inbox\.azzamo\.net/i.test(url));
        await new Promise((resolve, reject) => {
          let settled = false;
          const timeout = setTimeout(() => {
            if (!settled) reject(new Error('Publish timeout'));
          }, 10000);
          try {
            const pub = window.pool.publish(writableRelays, event);
            pub.on('ok', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(true); } });
            pub.on('seen', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(true); } });
            pub.on('failed', () => { /* wait for other relays */ });
          } catch (e) {
            clearTimeout(timeout);
            reject(e);
          }
        });

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

    async leaveGroup(groupId) {
      console.log('🚪 Leaving group:', groupId);
      
      const currentUser = await auth.getCurrentUser();
      if (!currentUser?.pubkey) {
        throw new Error('User not authenticated');
      }

      const group = this.groups.get(groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      try {
        // For NIP-07, ensure we have permissions
        if (currentUser.type === 'NIP-07') {
          await window.nostr.enable();
        }

        const metadata = {
          action: 'leave',
          updated_at: Math.floor(Date.now() / 1000)
        };

        console.log('📝 Creating leave event with metadata:', metadata);

        const event = {
          kind: 41, // Group metadata kind - MUST be 41 for updates/leaves
          pubkey: currentUser.pubkey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', groupId], // Reference to the group being left
            ['p', currentUser.pubkey], // User leaving
            ['client', 'tides']
          ],
          content: JSON.stringify(metadata)
        };

        event.id = NostrTools.getEventHash(event);
        
        if (currentUser.type === 'NIP-07') {
          const signed = await window.nostr.signEvent(event);
          event.id = signed.id;
          event.sig = signed.sig;
          event.pubkey = signed.pubkey;
        } else {
          event.id = NostrTools.getEventHash(event);
          event.sig = NostrTools.getSignature(event, currentUser.privkey);
        }

        console.log('📡 Publishing leave event:', event);

        // Use the main shared pool instead of the group-specific pool
        // This ensures the event can be published without being filtered
        const relays = relayPool.getConnectedRelays();
        const writableRelays = relays.filter(url => !/nostr\.wine|nostr\.band|primal|nostr\.watch|relay\.nostr\.net|inbox\.azzamo\.net/i.test(url));
        console.log('📡 Publishing to relays:', writableRelays);
        
        console.log('⏳ Waiting for leave event publish to complete...');
        await new Promise((resolve, reject) => {
          let settled = false;
          const timeout = setTimeout(() => {
            if (!settled) reject(new Error('Publish timeout'));
          }, 10000);
          try {
            const pub = window.pool.publish(writableRelays, event);
            pub.on('ok', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(true); } });
            pub.on('seen', () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(true); } });
            pub.on('failed', () => { /* ignore, wait for others or timeout */ });
          } catch (e) {
            clearTimeout(timeout);
            reject(e);
          }
        });

        console.log('✅ Leave event published successfully');

        // Mark group as left locally
        this.leftGroups.add(groupId);
        console.log('🚫 Group marked as left locally:', groupId);
        
        // Remove from active groups
        this.groups.delete(groupId);
        console.log('🗑️ Group removed from active groups');
        
        // UI update will be handled by popup.js when it detects the group leave
        
        console.log('🎉 Group leave completed successfully');
        return true;
      } catch (error) {
        console.error('❌ Error leaving group:', error);
        throw error;
      }
    }
  }

  // Create a single instance
  const groupContactManager = new GroupContactManager();
  
  // Make everything available on window
  window.groupContactManager = groupContactManager;
  
  // CRITICAL: Force the correct createGroup method and prevent overrides
  const originalCreateGroup = groupContactManager.createGroup;
  
  // First, verify this is the right method
  if (!originalCreateGroup.toString().includes('🎯 createGroup called with:')) {
    console.error('❌ CRITICAL: Wrong createGroup method found during binding!');
    throw new Error('Wrong createGroup method found during binding!');
  }
  
  // CRITICAL: Override the PROTOTYPE method to prevent it from being used
  const prototype = Object.getPrototypeOf(groupContactManager);
  Object.defineProperty(prototype, 'createGroup', {
    value: originalCreateGroup,
    writable: false,
    configurable: false
  });
  
  // Force bind the correct method to the instance
  const boundCreateGroup = originalCreateGroup.bind(groupContactManager);
  
  // Replace the instance method with our bound version
  groupContactManager.createGroup = boundCreateGroup;
  
  // Now protect the instance method from being overridden
  Object.defineProperty(groupContactManager, 'createGroup', {
    value: boundCreateGroup,
    writable: false,
    configurable: false
  });
  
  // Also protect the window object version
  Object.defineProperty(window.groupContactManager, 'createGroup', {
    value: boundCreateGroup,
    writable: false,
    configurable: false
  });
  
  // CRITICAL: Add a final protection that runs AFTER everything else
  setTimeout(() => {
    // Check if our method was overridden
    const currentMethod = window.groupContactManager.createGroup;
    if (!currentMethod.toString().includes('🎯 createGroup called with:')) {
      console.error('❌ CRITICAL: Method was overridden after protection! Forcing again...');
      window.groupContactManager.createGroup = boundCreateGroup;
      Object.defineProperty(window.groupContactManager, 'createGroup', {
        value: boundCreateGroup,
        writable: false,
        configurable: false
      });
    }
  }, 100);
  
  window.fetchUserGroups = groupContactManager.fetchUserGroups.bind(groupContactManager);
  window.updateGroupMetadata = groupContactManager.updateGroupMetadata.bind(groupContactManager);
  window.leaveGroup = groupContactManager.leaveGroup.bind(groupContactManager);
  window.getGroups = () => Array.from(groupContactManager.groups.values());
}