document.addEventListener('DOMContentLoaded', () => {
  const { pool, RELAYS, nostrCore, relayPool } = window;
  const { auth } = window;
  const { validateEvent } = window;
  const NostrTools = window.NostrTools || nostrCore;
  const { soundManager } = window;
  const { getUserMetadata } = window;
  const { shortenIdentifier } = window;
  const { showZapModal } = window;
  const qrcode = window.qrcode;

  // Define linkifyText function at the top level
  function linkifyText(text) {
    if (!text) return '';
    return text
      .replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s]|[a-zA-Z0-9][a-zA-Z0-9-]+\.[a-zA-Z]{2,}\b(?:\/[^\s<]*)?)/g, (url) => {
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        return `<a href="${fullUrl}" target="_blank" rel="noopener">${url}</a>`;
      });
  }

  class GroupMessageManager {
    constructor() {
      this.subscriptions = new Map();
      this.messageCache = new Map();
      this.pool = new NostrTools.SimplePool();
      this.currentGroupId = null;
      this.currentSubscription = null;
      
      // Bind all methods to this instance
      this.linkifyText = this.linkifyText.bind(this);
      this.handleIncomingGroupMessage = this.handleIncomingGroupMessage.bind(this);
      this.validateEvent = this.validateEvent.bind(this);
      this.subscribeToGroup = this.subscribeToGroup.bind(this);
      this.fetchGroupMessages = this.fetchGroupMessages.bind(this);
      this.sendGroupMessage = this.sendGroupMessage.bind(this);
      this.storeMessage = this.storeMessage.bind(this);
      this.cleanup = this.cleanup.bind(this);
    }

    linkifyText(text) {
      if (!text) return '';
      
      // URL regex pattern
      const urlPattern = /(https?:\/\/[^\s]+)/g;
      
      // Replace URLs with clickable links
      return text.replace(urlPattern, (url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      });
    }

    async subscribeToGroup(groupId) {
      // Set current group ID when subscribing
      this.currentGroupId = groupId;

      if (this.subscriptions.has(groupId)) {
        return;
      }

      const connectedRelays = relayPool.getConnectedRelays();
      const filter = {
        kinds: [42],
        '#e': [groupId]
      };

      const sub = this.pool.sub(connectedRelays, [filter]);
      sub.on('event', (event) => {
        if (this.validateEvent(event)) {
          this.handleIncomingGroupMessage(event);
        }
      });

      this.subscriptions.set(groupId, sub);
    }

    async fetchGroupMessages(groupId) {
      const currentUser = await auth.getCurrentUser();
      if (!currentUser?.pubkey) {
        throw new Error('User not authenticated');
      }

      try {
        await relayPool.ensureConnection();
        const connectedRelays = relayPool.getConnectedRelays();
        
        // Subscribe to real-time updates for this group
        await this.subscribeToGroup(groupId);

        // Create filter for all group messages (kind 42)
        const filters = [
          {
            kinds: [42],
            '#e': [groupId],
            since: 0
          }
        ];

        const events = await this.pool.list(connectedRelays, filters);

        // Process messages
        const messages = await Promise.all(
          events
            .filter(event => this.validateEvent(event))
            .sort((a, b) => a.created_at - b.created_at)
            .map(async (event) => {
              try {
                return {
                  id: event.id,
                  pubkey: event.pubkey,
                  content: event.content,
                  created_at: event.created_at,
                  tags: event.tags,
                  groupId: event.tags.find(t => t[0] === 'e')?.[1],
                  type: 'group'
                };
              } catch (error) {
                return null;
              }
            })
        );

        return messages.filter(Boolean);
      } catch (err) {
        throw err;
      }
    }

    validateEvent(event) {
      try {
        // Basic validation
        if (!event || 
            typeof event !== 'object' || 
            !event.id || 
            !event.pubkey || 
            !event.created_at || 
            !event.content) {
          return false;
        }

        // Strict kind check for group messages
        if (event.kind !== 42) {
          return false;
        }

        // Must have group reference tag
        const groupTag = event.tags.find(t => t[0] === 'e');
        if (!groupTag || !groupTag[1]) {
          return false;
        }

        // Must NOT have DM-specific tags
        if (event.tags.some(t => t[0] === 'p' && !t[2])) {
          return false;
        }

        return true;
      } catch (err) {
        return false;
      }
    }

    async handleIncomingGroupMessage(event) {
      try {
        const currentUser = await auth.getCurrentUser();
        if (!currentUser) return;

        // Validate event and ensure it's a group message
        if (!this.validateEvent(event)) return;

        // Get the group ID
        const groupId = event.tags.find(t => t[0] === 'e')?.[1];
        if (!groupId) return;

        // Only process messages for the current group
        if (groupId !== this.currentGroupId) return;

        // Check if message already exists in DOM or cache
        const existingMessage = document.querySelector(`[data-message-id="${event.id}"]`);
        const cachedMessages = this.messageCache.get(groupId) || [];
        const existsInCache = cachedMessages.some(m => m.id === event.id);

        if (existingMessage || existsInCache) return;

        // Store the message in cache first
        const groupMessage = {
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          tags: event.tags,
          groupId: groupId,
          type: 'group'
        };

        try {
          await this.storeMessage(groupMessage);
        } catch (error) {
          // Continue even if storage fails
        }

        // Clear message input if this is a sent message
        const isSent = event.pubkey === currentUser.pubkey;
        if (isSent) {
          const messageInput = document.getElementById('messageInput');
          if (messageInput) {
            messageInput.value = '';
          }
        }

        // Add message to UI
        try {
          const messageElement = document.createElement('div');
          messageElement.className = `message group-message ${isSent ? 'sent' : 'received'}`;
          messageElement.setAttribute('data-message-id', event.id);
          messageElement.setAttribute('data-pubkey', event.pubkey);
          messageElement.setAttribute('data-timestamp', event.created_at);
          messageElement.setAttribute('data-group-id', groupId);
          messageElement.setAttribute('data-type', 'group');

          // Add author name for received messages
          if (!isSent) {
            try {
              const authorMetadata = await getUserMetadata(event.pubkey);
              const authorName = authorMetadata?.name || authorMetadata?.displayName || shortenIdentifier(event.pubkey);
              const authorDiv = document.createElement('div');
              authorDiv.className = 'group-message-author';
              authorDiv.textContent = authorName;
              messageElement.appendChild(authorDiv);
            } catch (error) {
              console.debug('Failed to add author info:', error);
              // Continue without author info if it fails
            }
          }

          // For own messages, only add zap amount display if there are zaps
          if (event.zapAmount) {
            const zapContainer = document.createElement('div');
            zapContainer.className = 'zap-container received-only';
            zapContainer.innerHTML = `<span class="zap-amount">${event.zapAmount}</span>`;
            messageElement.style.position = 'relative';
            messageElement.appendChild(zapContainer);
          }

          const bubbleElement = document.createElement('div');
          bubbleElement.className = 'message-bubble';

          // Check for GIF/media content first
          const content = event.content;
          const gifMatch = content.match(/https:\/\/[^\s]+\.(gif|giphy\.com|tenor\.com|media\.nostr\.build|image\.nostr\.build|cdn\.azzamo\.net|instagram\.com|tiktok\.com)[^\s]*/i);
          
          if (gifMatch) {
            try {
              const cleanGifUrl = gifMatch[0].split('?')[0].replace(/[.,!?]$/, '');
              const mediaContainer = document.createElement('div');
              mediaContainer.className = 'media-container';
              mediaContainer.innerHTML = `<img src="${cleanGifUrl}" class="message-media" loading="lazy" alt="Media">`;
              bubbleElement.appendChild(mediaContainer);

              // Add remaining text if any
              const remainingText = content.replace(gifMatch[0], '').trim();
              if (remainingText) {
                const textDiv = document.createElement('div');
                textDiv.className = 'message-text';
                textDiv.innerHTML = this.linkifyText(remainingText);
                bubbleElement.appendChild(textDiv);
              }
            } catch (error) {
              console.debug('Failed to add media content:', error);
              // Fallback to showing as text
              const textDiv = document.createElement('div');
              textDiv.className = 'message-text';
              textDiv.innerHTML = this.linkifyText(content);
              bubbleElement.appendChild(textDiv);
            }
          } else {
            // Add preview container for other types of previews
            const previewContainer = document.createElement('div');
            previewContainer.className = 'message-preview';
            bubbleElement.appendChild(previewContainer);

            // Add text content
            const textContent = document.createElement('div');
            textContent.className = 'message-text';
            textContent.innerHTML = this.linkifyText(content);
            bubbleElement.appendChild(textContent);
          }
          
          messageElement.appendChild(bubbleElement);

          const messageList = document.querySelector('.message-list');
          if (messageList) {
            messageList.appendChild(messageElement);
            messageList.scrollTop = messageList.scrollHeight;
            
            // Play sound only if it's not our own message
            if (!isSent && soundManager) {
              try {
                soundManager.play('message');
              } catch (error) {
                console.debug('Failed to play sound:', error);
              }
            }

            // Process other link previews if not a GIF/media
            if (!gifMatch && typeof window.loadLinkPreviews === 'function') {
              try {
                await window.loadLinkPreviews();
              } catch (error) {
                console.debug('Failed to load link previews:', error);
              }
            }
          }
        } catch (error) {
          console.debug('Failed to create message element:', error);
        }
      } catch (error) {
        // Only log critical errors that affect functionality
        if (error.message?.includes('TypeError') || error.message?.includes('null')) {
          console.debug('Non-critical error handling group message:', error);
        }
      }
    }

    async init(groupId) {
      this.currentGroupId = groupId;
      
      // Clear any existing subscription
      if (this.currentSubscription) {
        this.currentSubscription.unsub();
      }

      // Set up subscription for real-time messages
      const filter = {
        kinds: [42], // Group message events
        '#e': [groupId],
        since: Math.floor(Date.now() / 1000) - 1 // Only get messages from now on
      };

      this.currentSubscription = this.pool.sub(RELAYS, [filter]);
      this.currentSubscription.on('event', (event) => {
        if (this.validateEvent(event)) {
          this.handleIncomingGroupMessage(event);
        }
      });

      return this.fetchGroupMessages(groupId);
    }

    async cleanup() {
      if (this.currentSubscription) {
        this.currentSubscription.unsub();
        this.currentSubscription = null;
      }
      this.currentGroupId = null;
    }

    async sendGroupMessage(groupId, content) {
      if (!content.trim()) return;
      
      const currentUser = await auth.getCurrentUser();
      if (!currentUser?.pubkey) {
        throw new Error('User not authenticated');
      }

      try {
        await relayPool.ensureConnection();
        const connectedRelays = relayPool.getConnectedRelays();

        // For NIP-07, ensure we have permissions
        if (currentUser.type === 'NIP-07') {
          await window.nostr.enable();
        }

        const event = {
          kind: 42,
          pubkey: currentUser.pubkey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', groupId],
            ['client', 'tides']
          ],
          content: content.trim()
        };

        // Use NostrTools for event hash and signing
        event.id = NostrTools.getEventHash(event);
        if (currentUser.type === 'NIP-07') {
          event.sig = await window.nostr.signEvent(event);
        } else {
          event.sig = NostrTools.getSignature(event, currentUser.privkey);
        }

        await this.pool.publish(connectedRelays, event);

        // Clear input field immediately after sending
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
          messageInput.value = '';
        }

        // Create a properly formatted group message object
        const groupMessage = {
          id: event.id,
          pubkey: event.pubkey,
          content: content.trim(),
          created_at: event.created_at,
          tags: event.tags,
          groupId: groupId,
          type: 'group'
        };

        // Store the message immediately
        await this.storeMessage(groupMessage);
        return groupMessage;
      } catch (error) {
        throw error;
      }
    }

    async storeMessage(message) {
      if (!message.type || message.type !== 'group') {
        throw new Error('Invalid message type. Only group messages can be stored here.');
      }

      if (!message.groupId) {
        throw new Error('Missing groupId for group message');
      }

      // Store in message cache
      const key = message.groupId;
      if (!this.messageCache.has(key)) {
        this.messageCache.set(key, []);
      }

      // Check if message already exists to prevent duplicates
      if (!this.messageCache.get(key).some(m => m.id === message.id)) {
        this.messageCache.get(key).push(message);
        // Sort messages by timestamp
        this.messageCache.get(key).sort((a, b) => a.created_at - b.created_at);
      }
    }
  }

  // Create a single instance
  const groupMessageManager = new GroupMessageManager();

  // Make everything available on window
  window.groupMessageManager = groupMessageManager;
  window.sendGroupMessage = groupMessageManager.sendGroupMessage.bind(groupMessageManager);
  window.fetchGroupMessages = groupMessageManager.fetchGroupMessages.bind(groupMessageManager);
  // Also make linkifyText available globally if needed
  window.linkifyText = linkifyText;
}); 