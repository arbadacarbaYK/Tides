/**
 * @file popup.js
 * @description Main UI Controller for Tides Nostr Messenger
 * 
 * This file manages all user interface interactions including:
 * - Login and authentication flows
 * - Message display and sending
 * - Contact list management
 * - Media previews and embeds
 * - Zap (Lightning) interactions
 * - Sound effects and notifications
 * 
 * The UI is designed to be responsive and provide immediate feedback
 * while maintaining a clean, intuitive interface for users.
 * 
 * 🎨 "Where function meets form, and Bitcoin meets chat"
 */

import { auth } from './auth.js';
import { fetchContacts, setContacts, contactManager, getContact } from './contact.js';
import { pubkeyToNpub } from './shared.js';
import { getUserMetadata, getDisplayName, getAvatarUrl, storeMetadata } from './userMetadata.js';
import { messageManager } from './messages.js';
import { publishAppHandlerEvent } from './nip89.js';
import { toLowerCaseHex } from './utils.js';
import { soundManager } from './utils.js';
import { shortenIdentifier } from './shared.js';
import 'emoji-picker-element';
import { searchGifs, getTrendingGifs } from './services/giphy.js';
import { RELAYS } from './shared.js';
import qrcode from 'qrcode';
let currentChatPubkey = null;
let emojiButtonListener;
let emojiPickerListener;
let hasPlayedLoginSound = false;
let lastMessageTimestamp = 0;
let searchHistory = [];

function initializeGifButton() {
  const gifButton = document.getElementById('gifButton');
  if (!gifButton) return;

  // Remove existing listeners
  const newGifButton = gifButton.cloneNode(true);
  gifButton.parentNode.replaceChild(newGifButton, gifButton);

  newGifButton.addEventListener('click', async () => {
    console.log('GIF button clicked');
    const existingPicker = document.querySelector('.gif-picker');
    if (existingPicker) {
      existingPicker.remove();
      return;
    }

    const picker = document.createElement('div');
    picker.className = 'gif-picker';

    const searchContainer = document.createElement('div');
    searchContainer.className = 'gif-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search GIFs...';
    searchContainer.appendChild(searchInput);

    const gifGrid = document.createElement('div');
    gifGrid.className = 'gif-grid';

    picker.appendChild(searchContainer);
    picker.appendChild(gifGrid);
    document.querySelector('.message-input-container').appendChild(picker);

    try {
      const trending = await getTrendingGifs();
      renderGifs(trending, gifGrid);
    } catch (error) {
      console.error('Failed to load trending GIFs:', error);
    }

    let searchTimeout;
    searchInput.addEventListener('input', async (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(async () => {
        const query = e.target.value.trim();
        try {
          if (query) {
            const results = await searchGifs(query);
            renderGifs(results, gifGrid);
          } else {
            const trending = await getTrendingGifs();
            renderGifs(trending, gifGrid);
          }
        } catch (error) {
          console.error('GIF search failed:', error);
        }
      }, 300);
    });

    // Close picker when clicking outside
    setTimeout(() => {
      document.addEventListener('click', function closePickerHandler(e) {
        if (!picker.contains(e.target) && e.target !== newGifButton) {
          picker.remove();
          document.removeEventListener('click', closePickerHandler);
        }
      });
    }, 100);
  });
}

function showLoginScreen() {
  const loginScreen = document.getElementById('loginScreen');
  const mainContainer = document.getElementById('mainContainer');
  
  loginScreen.style.display = 'flex';
  mainContainer.style.display = 'none';
  
  // Keep header visible but hide user info
  document.getElementById('userInfo').style.visibility = 'hidden';
}

async function initializeUI() {
  const loginScreen = document.getElementById('loginScreen');
  const mainContainer = document.getElementById('mainContainer');
  const nsecInput = document.getElementById('nsecInput');
  const loginButton = document.getElementById('loginButton');
  
  // Load search history before initializing search input
  await loadSearchHistory();
  
  loginScreen.style.display = 'block';
  mainContainer.style.display = 'none';
  nsecInput.style.display = 'none';
  
  // Initialize search functionality
  const searchInput = document.getElementById('searchInput');
  const clearSearchButton = document.getElementById('clearSearch');
  
  searchInput.value = '';
  clearSearchButton.style.display = 'none';
  
  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();
    clearSearchButton.style.display = searchTerm ? 'block' : 'none';
    
    const filteredContacts = Array.from(contactManager.contacts.values())
      .filter(contact => {
        if (!searchTerm) return true;
        const displayName = (contact.displayName || '').toLowerCase();
        const npub = (contact.npub || '').toLowerCase();
        return displayName.includes(searchTerm) || npub.includes(searchTerm);
      });
      
    renderContactList(filteredContacts);
  });

  // Add Enter key listener for login
  nsecInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loginButton.click();
    }
  });
}

/**
 * Initialize the application when DOM content is loaded
 * Sets up event listeners, checks authentication status,
 * and prepares the UI for user interaction
 */
document.addEventListener('DOMContentLoaded', async () => {
  await loadSearchHistory();
  initializeSearchInput();
  initializeUI();
  initializeGifButton();
  const storedUser = await auth.getStoredCredentials();
  if (storedUser) {
    await handleSuccessfulLogin(storedUser); 
    return;
  }

  if (window.nostr) {
    try {
      const user = await auth.login('NIP-07');
      if (user) {
        await handleSuccessfulLogin(user);
        return;
      }
    } catch (e) {
      console.debug("NIP-07 not available:", e);
    }
  }

  document.getElementById('nsecInput').style.display = 'block';
  showLoginScreen();

  if (Notification.permission !== 'granted') {
    Notification.requestPermission();
  }
});

/**
 * Handle successful user login
 * Sets up the main UI, loads user data, and initializes
 * real-time message handling
 * @param {Object} user - User credentials and metadata
 * @returns {Promise<void>}
 */
async function handleSuccessfulLogin(user) {
  try {
    document.getElementById('loadingIndicator').style.display = 'block';
    await loadUserData(user);
    
    document.getElementById('mainContainer').style.display = 'grid';
    document.getElementById('rightPanel').style.display = 'grid';
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('userInfo').style.visibility = 'visible';
    
    if (!hasPlayedLoginSound) {
      soundManager.play('login');
      hasPlayedLoginSound = true;
    }
    
  } catch (error) {
    console.error('Login failed:', error);
    showErrorMessage('Login failed: ' + error.message);
  } finally {
    document.getElementById('loadingIndicator').style.display = 'none';
  }
}

function playLoginSound() {
  soundManager.play('login', true);
}

document.getElementById('loginButton').addEventListener('click', async () => {
  const nsecInput = document.getElementById('nsecInput').value.trim();
  
  try {
    if (!nsecInput) {
      showErrorMessage('Please enter your nsec key');
      return;
    }

    const user = await auth.login('NSEC', nsecInput);
    if (!user) {
      showErrorMessage('Login failed - invalid credentials');
      return;
    }

    await handleSuccessfulLogin(user);

  } catch (error) {
    console.error('Login error:', error);
    showErrorMessage(error.message);
  }
});

async function loadUserData(user) {
  const loadingIndicator = document.getElementById('loadingIndicator');
  try {
    loadingIndicator.style.display = 'block';
    
    // Only fetch contacts - channels will come through contact events
    const contacts = await fetchContacts(user.pubkey);
    setContacts(contacts);
    renderContactList(contacts);

    const metadata = await getUserMetadata(user.pubkey);
    if (metadata) {
      updateUIWithMetadata(metadata);
    }
  } catch (error) {
    console.error('Error loading user data:', error);
    showErrorMessage('Failed to load user data. Please try again.');
    throw error;
  } finally {
    loadingIndicator.style.display = 'none';
  }
}

/**
 * Display the main application interface
 * Handles UI state transitions and animations
 */
function showMainScreen() {
  document.body.classList.remove('login-screen');
  document.body.classList.add('main-screen');
}

/**
 * Display error messages to the user
 * Messages auto-hide after 3 seconds
 * @param {string} message - Error message to display
 */
function showErrorMessage(message) {
  const errorDiv = document.getElementById('errorMessage');
  if (!errorDiv) {
    const div = document.createElement('div');
    div.id = 'errorMessage';
    div.className = 'error-message';
    document.body.appendChild(div);
  }
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 3000);
}

/**
 * Process and display new messages
 * Handles notifications and sound effects
 * @param {Object} message - Nostr message event
 */
function handleNewMessage(message) {
  const contact = getContact(message.pubkey);
  const notification = new Notification(
    contact?.displayName || shortenIdentifier(message.pubkey), 
    { 
      body: message.content,
      icon: contact?.avatarUrl || 'icons/default-avatar.png'
    }
  );

  // Check if the message is new
  if (message.timestamp > lastMessageTimestamp) {
    soundManager.play('message');
    lastMessageTimestamp = message.timestamp;
  }
}

/**
 * Update UI with user metadata
 * Displays user avatar, name, and other profile information
 * @param {Object} metadata - User profile metadata
 */
function updateUIWithMetadata(metadata) {
  console.log('Updating UI with metadata:', metadata);
  const userDisplay = document.getElementById('userDisplay');
  const userNpub = document.getElementById('userNpub');
  const avatar = document.getElementById('userAvatar');
  
  if (userDisplay) {
    userDisplay.textContent = metadata.name || metadata.displayName || 'Anonymous';
  }
  if (userNpub) {
    userNpub.style.display = 'none';
  }
  if (avatar) {
    avatar.onerror = () => {
      avatar.src = '/icons/default-avatar.png';
    };
    avatar.src = metadata.picture || '/icons/default-avatar.png';
  }
}

async function renderContactList(contacts) {
  const contactList = document.getElementById('contactList');
  contactList.innerHTML = '';
  
  // Create streams section
  const streamSection = document.createElement('div');
  streamSection.className = 'contact-section';
  
  const streamHeader = document.createElement('div');
  streamHeader.className = 'section-header';
  streamHeader.dataset.section = 'streams';
  streamHeader.innerHTML = '<h3>Streams</h3><span class="collapse-icon">▼</span>';
  
  const streamContent = document.createElement('div');
  streamContent.className = 'section-content';
  streamContent.id = 'streamsContent';
  
  // Add hardcoded stream
  const streamData = await initializeStreamSection();
  const streamElement = createContactElement(streamData);
  streamContent.appendChild(streamElement);
  
  streamSection.appendChild(streamHeader);
  streamSection.appendChild(streamContent);
  contactList.appendChild(streamSection);

  // Rest of the contacts section remains the same
  if (contacts && contacts.length > 0) {
    // Split contacts into active and inactive
    const activeContacts = contacts.filter(c => c.hasMessages);
    const inactiveContacts = contacts.filter(c => !c.hasMessages);
    
    // Active Contacts Section
    if (activeContacts.length > 0) {
      const activeSection = document.createElement('div');
      activeSection.className = 'contact-section';
      
      const activeHeader = document.createElement('div');
      activeHeader.className = 'section-header';
      activeHeader.dataset.section = 'active-contacts';
      activeHeader.innerHTML = '<h3>Recent Chats</h3><span class="collapse-icon">▼</span>';
      
      const activeContent = document.createElement('div');
      activeContent.className = 'section-content';
      activeContent.id = 'activeContactsContent';
      
      activeContacts.forEach(contact => {
        const contactElement = createContactElement(contact);
        activeContent.appendChild(contactElement);
      });
      
      activeSection.appendChild(activeHeader);
      activeSection.appendChild(activeContent);
      contactList.appendChild(activeSection);
    }
    
    // Other Contacts Section
    if (inactiveContacts.length > 0) {
      const inactiveSection = document.createElement('div');
      inactiveSection.className = 'contact-section';
      
      const inactiveHeader = document.createElement('div');
      inactiveHeader.className = 'section-header';
      inactiveHeader.dataset.section = 'inactive-contacts';
      inactiveHeader.innerHTML = '<h3>Other Contacts</h3><span class="collapse-icon">▼</span>';
      
      const inactiveContent = document.createElement('div');
      inactiveContent.className = 'section-content';
      inactiveContent.id = 'inactiveContactsContent';
      
      inactiveContacts.forEach(contact => {
        const contactElement = createContactElement(contact);
        inactiveContent.appendChild(contactElement);
      });
      
      inactiveSection.appendChild(inactiveHeader);
      inactiveSection.appendChild(inactiveContent);
      contactList.appendChild(inactiveSection);
    }
  }
}

function createContactElement(contact) {
  const element = document.createElement('div');
  element.className = 'contact-item';
  element.dataset.pubkey = contact.pubkey;
  if (contact.streamUrl) {
    element.dataset.streamUrl = contact.streamUrl;
  }
  
  if (currentChatPubkey === contact.pubkey) {
    element.classList.add('selected');
  }
  
  const img = document.createElement('img');
  img.className = 'contact-avatar';
  img.alt = contact.displayName;
  
  // Handle image load errors
  img.onerror = function() {
    // Check if the failed URL was from Twitter/X
    if (this.src.includes('twimg.com')) {
      // Try to load the image without _400x400 suffix
      const newUrl = this.src.replace(/_400x400/, '');
      if (newUrl !== this.src) {
        this.src = newUrl;
        return;
      }
    }
    // If all else fails, use default avatar
    this.src = '/icons/default-avatar.png';
    // Remove onerror handler to prevent loops
    this.onerror = null;
  };
  
  img.src = contact.avatarUrl || '/icons/default-avatar.png';

  const contactInfo = document.createElement('div');
  contactInfo.className = 'contact-info';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'contact-name';
  nameSpan.textContent = contact.displayName;
  contactInfo.appendChild(nameSpan);

  if (!contact.isChannel) {
    const indicator = document.createElement('div');
    indicator.className = `online-indicator ${contact.isOnline ? 'online' : ''}`;
    contactInfo.appendChild(indicator);
  }

  element.appendChild(img);
  element.appendChild(contactInfo);
  
  // Add click handler
  element.addEventListener('click', async () => {
    const chatHeader = document.getElementById('chatHeader');
    const chatContainer = document.getElementById('chatContainer');
    const messageInputContainer = document.querySelector('.message-input-container');
    
    // Remove all previous selections
    document.querySelectorAll('.contact-item').forEach(el => {
      el.classList.remove('selected');
    });
    element.classList.add('selected');
    
    // Reset chat container
    chatContainer.innerHTML = '';
    
    if (contact.isChannel) {
      messageInputContainer.style.display = 'none';
      await handleStreamChat(contact.pubkey, chatHeader, chatContainer);
    } else {
      messageInputContainer.style.display = 'flex';
      currentChatPubkey = contact.pubkey;
      await initializeChat(contact.pubkey);
    }
  });
  
  return element;
}

async function selectContact(pubkey) {
  await initializeChat(pubkey);
}

async function initializeChat(pubkey) {
  currentChatPubkey = pubkey;
  const chatContainer = document.getElementById('chatContainer');
  const chatHeader = document.getElementById('chatHeader');
  
  if (!chatContainer || !chatHeader) return;
  
  // Get all input elements and buttons once
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const emojiButton = document.getElementById('emojiButton');
  const gifButton = document.getElementById('gifButton');
  
  // Update chat header
  const contact = await getContact(pubkey);
  if (contact) {
    updateChatHeader(chatHeader, contact);
  }
  
  chatContainer.innerHTML = '<div class="message-list"><div class="loading-messages">Loading messages...</div></div>';
  
  const messages = await messageManager.fetchMessages(pubkey);
  if (messages && messages.length > 0) {
    await renderMessages(messages);
  } else {
    chatContainer.querySelector('.message-list').innerHTML = '<div class="no-messages">No messages yet</div>';
  }

  // Enable input for regular chats
  messageInput.disabled = false;
  sendButton.disabled = false;

  // Add message handlers here
  messageInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await sendMessage();
    }
  });

  sendButton.addEventListener('click', sendMessage);
  
  // Initialize emoji picker
  if (emojiButton && messageInput) {
    initializeEmojiPicker(emojiButton, messageInput);
  }

  // Initialize GIF button
  initializeGifButton();
}

function resetChatUI() {
  const chatHeader = document.getElementById('chatHeader');
  const chatContainer = document.getElementById('chatContainer');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const emojiButton = document.getElementById('emojiButton');
  const gifButton = document.getElementById('gifButton');

  chatHeader.innerHTML = '';
  chatContainer.innerHTML = '<div class="no-chat-selected">Select a contact to start chatting</div>';
  messageInput.value = '';
  messageInput.disabled = true;
  sendButton.disabled = true;
  emojiButton.disabled = true;
  gifButton.disabled = true;
}

async function renderMessages(messages) {
  const messageList = document.querySelector('.message-list');
  if (!messageList) return;
  
  messageList.innerHTML = '';
  const currentUser = await auth.getCurrentUser();
  
  // Sort messages by timestamp
  const sortedMessages = messages.sort((a, b) => a.created_at - b.created_at);
  
  // Create a document fragment for better performance
  const fragment = document.createDocumentFragment();
  
  for (const message of sortedMessages) {
    const messageElement = document.createElement('div');
    const isSent = message.pubkey === currentUser?.pubkey;
    messageElement.className = `message ${isSent ? 'sent' : 'received'}`;
    messageElement.setAttribute('data-message-id', message.id);
    
    const bubbleElement = document.createElement('div');
    bubbleElement.className = 'message-bubble';
    
    // Render message content (text, media, etc)
    await renderMessageContent(message, bubbleElement);
    
    // Add zap container for received messages
    if (!isSent) {
      const metadata = await getUserMetadata(message.pubkey);
      if (metadata?.lud16 || metadata?.lightning) {
        const zapContainer = document.createElement('div');
        zapContainer.className = 'zap-container';
        zapContainer.innerHTML = `
          <button class="zap-button" title="Send Zap">⚡</button>
          <span class="zap-amount">${message.zapAmount || ''}</span>
        `;
        
        bubbleElement.style.position = 'relative';
        
        const zapButton = zapContainer.querySelector('.zap-button');
        zapButton.addEventListener('click', async (e) => {
          e.stopPropagation();
          await showZapModal(message, metadata, zapContainer);
        });
        
        bubbleElement.appendChild(zapContainer);
      }
    }
    
    messageElement.appendChild(bubbleElement);
    fragment.appendChild(messageElement);
  }

  // Append all messages at once
  messageList.appendChild(fragment);
  
  // Call loadLinkPreviews after messages are rendered
  await loadLinkPreviews();
  
  // Scroll to bottom
  const lastMessage = messageList.lastElementChild;
  if (lastMessage) {
    lastMessage.scrollIntoView({ block: 'end', inline: 'nearest' });
  }
}

function renderStreamContent(channel) {
  const container = document.createElement('div');
  container.className = 'stream-container';
  
  const streamInfo = document.createElement('div');
  streamInfo.className = 'stream-info';
  
  const avatar = document.createElement('img');
  avatar.src = channel.avatarUrl || 'icons/default-avatar.png';
  avatar.alt = channel.displayName;
  avatar.className = 'stream-avatar';
  
  const details = document.createElement('div');
  details.className = 'stream-details';
  
  const link = document.createElement('a');
  link.href = 'https://radio.noderunners.org';
  link.target = '_blank';
  link.className = 'stream-link';
  link.textContent = 'Open Noderunners Radio';
  
  details.innerHTML = `
    <h3>${channel.displayName}</h3>
    <p>${channel.about}</p>`;
  
  details.appendChild(link);
  
  streamInfo.appendChild(avatar);
  streamInfo.appendChild(details);
  container.appendChild(streamInfo);
  
  return container;
}

function handleStreamChat(pubkey, header, container) {
  const channel = contactManager.channels.get(pubkey);
  if (!channel) {
    container.innerHTML = '<div class="error-message">Stream not available</div>';
    return;
  }

  container.innerHTML = '';
  container.appendChild(renderStreamContent(channel));
  updateChatHeader(header, channel);
}

async function subscribeToChannelEvents(channelPubkey) {
  const filter = {
    kinds: [42],
    '#e': [channelPubkey]
  };
  
  await relayPool.ensureConnection();
  const sub = pool.sub(RELAYS.map(relay => ({
    relay,
    filter: [filter]
  })));

  sub.on('event', (event) => {
    if (validateEvent(event)) {
      messageManager.handleIncomingMessage(event);
    }
  });

  return sub;
}

function updateChatHeader(header, contact) {
  header.innerHTML = `
    <img src="${contact.avatarUrl || '/icons/default-avatar.png'}" 
         alt="${contact.displayName}" 
         class="contact-avatar">
    <span>${contact.displayName}</span>
    ${contact.isChannel && contact.about ? `<div class="channel-description">${contact.about}</div>` : ''}
  `;
}

function initializeMessageHandlers(messageInput, sendButton, emojiButton) {
  messageInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await sendMessage();
    }
  });

  sendButton.addEventListener('click', sendMessage);
  initializeEmojiPicker(emojiButton, messageInput);
}

async function sendMessage() {
  const messageInput = document.getElementById('messageInput');
  const content = messageInput.value.trim();
  
  if (!content || !currentChatPubkey) return;
  
  try {
    messageInput.value = '';
    const messageList = document.querySelector('.message-list');
    if (!messageList) return;
    
    const currentUser = await auth.getCurrentUser();
    const messageElement = document.createElement('div');
    messageElement.className = 'message sent';
    const bubbleElement = document.createElement('div');
    bubbleElement.className = 'message-bubble';
    
    // Immediate preview for all content types
    if (content.match(/\.(gif|jpe?g|png)$/i)) {
      bubbleElement.innerHTML = `
        <div class="media-container">
          <img src="${content}" class="message-media" loading="lazy">
        </div>`;
    } else {
      bubbleElement.innerHTML = `<div class="message-text">${linkifyText(content)}</div>`;
      // Add link preview handling for new messages
      setTimeout(() => loadLinkPreviews(), 100);
    }
    
    messageElement.appendChild(bubbleElement);
    messageList.appendChild(messageElement);
    messageElement.scrollIntoView({ behavior: 'smooth' });
    
    // Ensure proper scrolling after sending
    setTimeout(() => {
      messageList.scrollTop = messageList.scrollHeight;
    }, 100);
    
    await messageManager.sendMessage(currentChatPubkey, content);
  } catch (error) {
    console.error('Failed to send message:', error);
    showErrorMessage('Failed to send message');
  }
}

async function renderMessage(message, metadata) {
  // If metadata wasn't passed, try to fetch it
  if (!metadata) {
    metadata = await getUserMetadata(message.pubkey);
  }
  
  const messageElement = document.createElement('div');
  messageElement.className = 'message';
  messageElement.setAttribute('data-message-id', message.id);
  
  const bubbleElement = document.createElement('div');
  bubbleElement.className = `message-bubble ${message.isSent ? 'sent' : 'received'}`;
  
  await renderMessageContent(message, bubbleElement);
  messageElement.appendChild(bubbleElement);
  
  return messageElement;
}

async function renderMessageContent(message, bubbleElement) {
  const currentUser = await auth.getCurrentUser();
  const content = message.content;
  
  if (!content) {
    console.error('No content in message:', message);
    bubbleElement.innerHTML = '<div class="message-text error">Message could not be decrypted</div>';
    return;
  }

  // Check if content is a GIF URL from Giphy
  if (typeof content === 'string' && content.includes('giphy.com')) {
    bubbleElement.innerHTML = `
      <div class="media-container">
        <img src="${content}" class="message-media" loading="lazy">
      </div>`;
    
    // Add load event listener to update scroll position
    const img = bubbleElement.querySelector('img');
    if (img) {
      img.addEventListener('load', () => {
        const messageList = document.querySelector('.message-list');
        if (messageList) {
          messageList.scrollTop = messageList.scrollHeight;
        }
      });
    }
    return;
  }

  // Plain text messages
  bubbleElement.innerHTML = `<div class="message-text">${linkifyText(content)}</div>`;

  // Add zap container if message is received
  if (message.pubkey !== currentUser?.pubkey) {
    const metadata = await getUserMetadata(message.pubkey);
    if (metadata?.lud16 || metadata?.lightning) {
      const zapContainer = document.createElement('div');
      zapContainer.className = 'zap-container';
      zapContainer.innerHTML = `
        <button class="zap-button" title="Send Zap">⚡</button>
        <span class="zap-amount">${message.zapAmount || ''}</span>
      `;
      
      // Ensure container is positioned correctly
      bubbleElement.style.position = 'relative';
      
      const zapButton = zapContainer.querySelector('.zap-button');
      zapButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        await showZapModal(message, metadata, zapContainer);
      });
      
      bubbleElement.appendChild(zapContainer);
    }
  }
}

function linkifyText(text) {
  return text
    .replace(/\n/g, '<br>')
    .replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s]|[a-zA-Z0-9][a-zA-Z0-9-]+\.[a-zA-Z]{2,}\b(?:\/[^\s<]*)?)/g, (url) => {
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      return `<a href="${fullUrl}" target="_blank" rel="noopener">${url}</a>`;
    });
}

document.getElementById('clearSearch').addEventListener('click', () => {
  const searchInput = document.getElementById('searchInput');
  searchInput.value = '';
  renderContactList(Array.from(contactManager.contacts.values()));
});

function updateContactInList(contact) {
  const existingContact = document.querySelector(`[data-pubkey="${contact.pubkey}"]`);
  if (existingContact) {
    const newContactElement = createContactElement(contact);
    existingContact.replaceWith(newContactElement);
  }
}

function renderGifs(gifs, container) {
  container.innerHTML = '';
  
  gifs.forEach(gif => {
    const item = document.createElement('div');
    item.className = 'gif-item';
    item.style.position = 'relative';
    item.style.paddingBottom = '75%';
    
    const img = document.createElement('img');
    img.src = gif.previewUrl;
    img.loading = 'lazy';
    img.alt = 'GIF';
    img.style.position = 'absolute';
    img.style.top = '0';
    img.style.left = '0';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '8px';
    
    // Add click handler with cleaned URL
    item.addEventListener('click', () => {
      const messageInput = document.getElementById('messageInput');
      // Clean the URL by removing query parameters
      const cleanUrl = gif.url.split('?')[0];
      messageInput.value = cleanUrl;
      messageInput.focus();
      
      // Remove the GIF picker
      const picker = document.querySelector('.gif-picker');
      if (picker) {
        picker.remove();
      }
    });
    
    item.appendChild(img);
    container.appendChild(item);
  });
}

function initializeEmojiPicker(emojiButton, messageInput) {
  if (!emojiButton || !messageInput) return;
  
  // Remove any existing listeners
  const newEmojiButton = emojiButton.cloneNode(true);
  emojiButton.parentNode.replaceChild(newEmojiButton, emojiButton);
  
  newEmojiButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    let existingPicker = document.querySelector('emoji-picker');
    if (existingPicker) {
      existingPicker.remove();
      return;
    }

    const picker = document.createElement('emoji-picker');
    picker.style.position = 'absolute';
    picker.style.bottom = '60px';
    picker.style.right = '0';
    picker.style.zIndex = '1000';
    
    const inputContainer = document.querySelector('.message-input-container');
    inputContainer.appendChild(picker);
    
    picker.addEventListener('emoji-click', (event) => {
      messageInput.value += event.detail.unicode;
      messageInput.focus();
      picker.remove();
    });

    // Close picker when clicking outside
    setTimeout(() => {
      document.addEventListener('click', function closePickerHandler(e) {
        if (!picker.contains(e.target) && e.target !== newEmojiButton) {
          picker.remove();
          document.removeEventListener('click', closePickerHandler);
        }
      });
    }, 100);
  });
}

/**
 * Initialize the stream section with Noderunners Radio
 * @returns {Promise<Object>} Channel configuration
 */
async function initializeStreamSection() {
  const streamData = {
    pubkey: 'noderunnersradio',
    displayName: 'Noderunners Radio',
    isChannel: true,
    avatarUrl: 'https://image.nostr.build/9a9c9e5dba5ed17361f2f593dda02bd2ba85a14e69db1f251b27423f43864efe.webp',
    streamUrl: 'noderunnersradio'
  };

  const channel = {
    ...streamData,
    id: streamData.pubkey,
    embedUrl: `https://player.twitch.tv/?channel=${streamData.streamUrl}&parent=${location.hostname}&muted=true`,
    about: ''
  };

  contactManager.channels.set(channel.id, channel);
  return channel;
}

/**
 * Handle extension-based login attempts
 * Supports NIP-07 compatible extensions like Alby and nos2x
 */
document.getElementById('extensionLoginButton').addEventListener('click', async () => {
  try {
    // Check if window.nostr exists after a short delay to allow extension injection
    setTimeout(async () => {
      if (typeof window.nostr === 'undefined') {
        showErrorMessage('No Nostr extension found. Please install Alby or nos2x.');
        return;
      }
      await handleSuccessfulLogin(user);
      try {
        await window.nostr.enable();
        const user = await auth.login('NIP-07');
        if (user) {
          await handleSuccessfulLogin(user);
        }
      } catch (error) {
        console.error('Extension login error:', error);
        showErrorMessage('Extension login failed: ' + error.message);
      }
    }, 500);
  } catch (error) {
    console.error('Extension login error:', error);
    showErrorMessage('Extension login failed: ' + error.message);
  }
});

/**
 * Create a Lightning invoice for zaps
 * @param {Object} metadata - User metadata containing lightning address
 * @param {number} amount - Payment amount in millisatoshis
 * @param {Object} zapRequest - NIP-57 zap request object
 * @returns {Promise<string>} BOLT11 invoice
 * @throws {Error} If invoice creation fails
 */
async function createZapInvoice(metadata, amount, zapRequest) {
  const lightningAddress = metadata.lud16 || metadata?.lightning;
  if (!lightningAddress) {
    throw new Error('No lightning address found');
  }

  try {
    console.debug('Creating zap invoice for:', lightningAddress);
    
    const response = await chrome.runtime.sendMessage({
      type: 'GET_ZAP_INVOICE',
      data: {
        lightningAddress,
        amount,
        zapRequest
      }
    });

    if (!response) {
      throw new Error('No response from lightning service');
    }

    if (response.error) {
      throw new Error(response.error);
    }

    if (!response.invoice) {
      throw new Error('No invoice received');
    }

    return response.invoice;

  } catch (error) {
    console.debug('Failed to create invoice:', error);
    if (error.message.includes('404')) {
      throw new Error('Lightning address not found or invalid');
    }
    if (error.message.includes('500')) {
      throw new Error('Lightning service is temporarily unavailable');
    }
    throw error;
  }
}

async function showQRModal(invoice) {
  try {
    const modal = document.createElement('div');
    modal.className = 'qr-modal';
    
    modal.innerHTML = `
      <div class="qr-modal-content">
        <div class="qr-container">
          <div id="qrcode-container"></div>
          <div class="invoice-text">${invoice}</div>
          <div class="modal-buttons">
            <button class="copy-button">Copy Invoice</button>
            <button class="close-button">Close</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);

    // Generate QR code
    const qr = qrcode(0, "M");
    qr.addData(`lightning:${invoice}`);
    qr.make();
    
    const qrContainer = modal.querySelector('#qrcode-container');
    qrContainer.innerHTML = qr.createImgTag(4);
    
    const copyButton = modal.querySelector('.copy-button');
    const closeButton = modal.querySelector('.close-button');
    
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(invoice);
        copyButton.textContent = 'Copied!';
        copyButton.classList.add('copied');
        
        setTimeout(() => {
          copyButton.textContent = 'Copy Invoice';
          copyButton.classList.remove('copied');
        }, 2000);
      } catch (error) {
        console.error('Failed to copy invoice:', error);
        showError('Failed to copy invoice');
      }
    });
    
    closeButton.addEventListener('click', () => {
      modal.remove();
    });
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  } catch (error) {
    console.debug('Failed to show QR modal:', error);
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ZAP_RECEIVED') {
    const { messageId, amount } = message.data;
    updateZapAmount(messageId, amount);
  }
  return true;  // Important for Chrome message listeners
});

function updateZapAmount(messageId, amount) {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageElement) {
    const zapAmount = messageElement.querySelector('.zap-amount');
    const zapButton = messageElement.querySelector('.zap-button');
    
    if (zapAmount && zapButton) {
      zapAmount.textContent = amount;
      zapButton.classList.add('zap-received');
      setTimeout(() => {
        zapButton.classList.remove('zap-received');
      }, 500);
    }
  }
}

function hasLightningAddress(metadata) {
  // Check for either lud16 (Lightning address) or lightning (LNURL) field
  const address = metadata?.lud16 || metadata?.lightning;
  if (!address) return false;
  
  // Validate format in correct order
  return address.includes('@') || // Lightning address (e.g., yvette@lnaddress.com)
         address.toLowerCase().startsWith('lnurl') || // LNURL format
         address.toLowerCase().startsWith('https://') || // Direct HTTPS URL
         address.toLowerCase().startsWith('http://'); // Direct HTTP URL (fallback)
}

// Function to load search history
async function loadSearchHistory() {
  try {
    const result = await chrome.storage.local.get('searchHistory');
    searchHistory = result.searchHistory || [];
  } catch (error) {
    console.error('Failed to load search history:', error);
    searchHistory = [];
  }
}

// Function to save search history
async function saveSearchHistory(term) {
  try {
    // First get the current history
    const result = await chrome.storage.local.get('searchHistory');
    let currentHistory = result.searchHistory || [];
    
    // Only add if term isn't already in history
    if (!currentHistory.includes(term)) {
      currentHistory.unshift(term);
      if (currentHistory.length > 5) currentHistory.pop();
      
      // Save the updated history
      await chrome.storage.local.set({ searchHistory: currentHistory });
      // Update the global searchHistory variable
      searchHistory = currentHistory;
    }
  } catch (error) {
    console.error('Failed to save search history:', error);
  }
}

// Modify the search input event listeners
function initializeSearchInput() {
  const searchInput = document.getElementById('searchInput');
  const clearSearchButton = document.getElementById('clearSearch');
  const datalist = document.getElementById('search-history');
  
  // Populate datalist with existing history
  datalist.innerHTML = searchHistory
    .map(term => `<option value="${term}">`)
    .join('');
  
  searchInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const searchTerm = searchInput.value.toLowerCase().trim();
      if (searchTerm) {
        await saveSearchHistory(searchTerm);
        // Update datalist with new history
        datalist.innerHTML = searchHistory
          .map(term => `<option value="${term}">`)
          .join('');
      }
    }
  });
}

async function fetchMessages(pubkey) {
  try {
    // Clean up any existing subscriptions first
    if (this.currentSubscription) {
      await this.currentSubscription.unsub();
      this.currentSubscription = null;
    }
    
    // Create new subscription
    this.currentSubscription = pool.sub(relays, [{
      kinds: [4],
      authors: [pubkey],
      limit: 50
    }]);

    // Rest of the fetch logic...
  } catch (error) {
    console.error('Error fetching messages:', error);
    throw error;
  }
}

/**
 * Process and display Nostr link previews
 * @param {string} url - Nostr URL or identifier
 * @returns {Promise<string|null>} HTML preview content
 */
async function handleNostrLink(url) {
  // Import pool from shared
  const { pool, RELAYS } = await import('./shared.js');
  
  // Extract nostr ID from various formats
  let nostrId;
  
  if (url.startsWith('nostr:')) {
    nostrId = url.split('nostr:')[1];
  } 
  else if (url.match(/^(npub|note|nevent)1[023456789acdefghjklmnpqrstuvwxyz]+$/)) {
    nostrId = url;
  }
  else {
    const matches = url.match(/\/(npub|note|nevent)1[023456789acdefghjklmnpqrstuvwxyz]+/);
    if (matches) {
      nostrId = matches[0].substring(1);
    }
  }

  if (!nostrId) return null;

  try {
    const decoded = NostrTools.nip19.decode(nostrId);
    if (decoded.type === 'note' || decoded.type === 'nevent') {
      const eventId = decoded.type === 'note' ? decoded.data : decoded.data.id;
      const event = await pool.get(RELAYS, { ids: [eventId] });
      if (event) {
        const metadata = await getUserMetadata(event.pubkey);
        return `
          <div class="nostr-preview">
            <div class="nostr-author">
              <img src="${metadata?.picture || '/icons/default-avatar.png'}" alt="Avatar" class="avatar">
              <span>${metadata?.name || metadata?.displayName || shortenIdentifier(event.pubkey)}</span>
            </div>
            <div class="nostr-content">${event.content}</div>
          </div>`;
      }
    } else if (decoded.type === 'npub' || decoded.type === 'nprofile') {
      const pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey;
      const metadata = await getUserMetadata(pubkey);
      return `
        <div class="nostr-preview">
          <div class="nostr-author">
            <img src="${metadata?.picture || '/icons/default-avatar.png'}" alt="Avatar" class="avatar">
            <span>${metadata?.name || metadata?.displayName || shortenIdentifier(pubkey)}</span>
          </div>
          ${metadata?.about ? `<div class="nostr-content">${metadata.about}</div>` : ''}
        </div>`;
    }
  } catch (error) {
    console.warn('Failed to decode nostr link:', error);
    return null;
  }
}

async function handleRawNostrIdentifiers(messageText) {
  // Find raw nostr identifiers in text content
  const text = messageText.textContent;
  const identifierMatches = text.match(/(?:nostr:)?(?:note|nevent|npub|nprofile|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+/g);
  
  if (!identifierMatches) return;

  for (const identifier of identifierMatches) {
    // Skip if it's a regular link (these are handled by the normal preview logic)
    if (messageText.querySelector(`a[href*="${identifier}"]`)) continue;
    
    // Skip if preview already exists
    if (messageText.querySelector(`[data-nostr-id="${identifier}"]`)) continue;

    try {
      const nostrId = identifier.replace('nostr:', '');
      const decoded = NostrTools.nip19.decode(nostrId);
      
      const previewContainer = document.createElement('div');
      previewContainer.className = 'link-preview';
      previewContainer.setAttribute('data-nostr-id', identifier);

      const previewContent = await handleNostrLink(nostrId);
      if (previewContent) {
        previewContainer.innerHTML = previewContent;
        messageText.appendChild(previewContainer);
      }
    } catch (error) {
      console.warn('Failed to handle raw nostr identifier:', error);
    }
  }
}

async function decryptMessage(event) {
  try {
    const currentUser = await auth.getCurrentUser();
    const privateKey = await auth.getPrivateKey();
    
    if (!privateKey || !event?.content) {
      return null;
    }

    // Skip invalid messages
    if (typeof event.content !== 'string' || !event.tags) {
      return null;
    }

    let decrypted;
    const isSender = event.pubkey === currentUser.pubkey;
    const recipientPubkey = isSender ? event.tags.find(tag => tag[0] === 'p')?.[1] : event.pubkey;

    if (!recipientPubkey) {
      return null;
    }

    try {
      if (privateKey === window.nostr) {
        decrypted = await window.nostr.nip04.decrypt(
          isSender ? recipientPubkey : event.pubkey,
          event.content
        );
      } else {
        decrypted = await NostrTools.nip04.decrypt(
          privateKey,
          isSender ? recipientPubkey : event.pubkey,
          event.content
        );
      }

      if (!decrypted) {
        return null;
      }

      return decrypted;
    } catch (decryptError) {
      // Silently ignore decryption errors
      console.debug('Message decryption failed:', decryptError);
      return null;
    }
  } catch (error) {
    // Silently log decryption errors as debug
    console.debug('Message decryption failed:', error);
    return null;
  }
}

/**
 * Process message content for link previews
 * @param {HTMLElement} messageElement - Message container element
 * @returns {Promise<void>}
 */
async function handleMessagePreview(messageElement) {
  try {
    const content = messageElement.textContent;
    if (!content) return;

    // Process message content for previews
    const nostrIds = content.match(
      /(?:nostr:)?(?:note|nevent|npub|nprofile|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+/g
    );

    if (!nostrIds) return;

    for (const id of nostrIds) {
      // Skip if preview already exists
      if (messageElement.querySelector(`[data-nostr-id="${id}"]`)) {
        continue;
      }

      try {
        const previewContent = await generateNostrPreview(id);
        if (previewContent) {
          const previewElement = document.createElement('div');
          previewElement.className = 'link-preview';
          previewElement.setAttribute('data-nostr-id', id);
          previewElement.innerHTML = previewContent;
          messageElement.appendChild(previewElement);
        }
      } catch (previewError) {
        console.debug('Preview generation failed:', previewError);
        // Continue with other previews
      }
    }
  } catch (error) {
    console.debug('Message preview processing failed:', error);
  }
}

/**
 * Generate a Lightning payment URL
 * @param {Object} contact - Contact metadata with lightning info
 * @param {number} amount - Payment amount in millisatoshis
 * @param {Object} zapRequest - NIP-57 zap request details
 * @returns {Promise<string>} BOLT11 invoice
 * @throws {Error} If invoice generation fails
 */
async function getLightningUrl(contact, amount, zapRequest) {
  const lightningAddress = contact.lud16 || contact?.lightning;
  if (!lightningAddress) {
    throw new Error('No lightning address found');
  }

  try {
    console.log('Creating zap invoice for:', lightningAddress);
    const response = await chrome.runtime.sendMessage({
      type: 'GET_ZAP_INVOICE',
      data: {
        lightningAddress,
        amount,
        zapRequest
      }
    });

    if (!response) {
      throw new Error('No response from lightning service');
    }

    if (response.error) {
      if (response.error.includes('500')) {
        throw new Error('Lightning service is currently unavailable. Please try again later.');
      }
      throw new Error(response.error);
    }

    if (!response.invoice) {
      throw new Error('Invalid invoice response format');
    }

    return response.invoice;
  } catch (error) {
    console.error('Failed to create invoice:', error);
    if (error.message.includes('500')) {
      throw new Error('Lightning service is currently unavailable. Please try again later.');
    }
    throw new Error(error.message || 'Could not generate Lightning invoice');
  }
}

function showError(message) {
  // Check if this is an expected error that shouldn't be shown in extension errors
  const isExpectedError = 
    message.includes('padding') || // Decryption errors
    message.includes('Service unavailable') || // Zap service errors
    message.includes('Failed to decrypt message') || // Decryption errors
    message.includes('Invalid invoice response format') || // Zap errors
    message.includes('Service does not support zaps') || // Zap support errors
    message.includes('Lightning service is temporarily unavailable') || // Lightning service errors
    message.includes('Zap invoice error'); // General zap errors

  if (isExpectedError) {
    // Log expected errors as debug only
    console.debug('Expected error:', message);
    return;
  }

  // Only show unexpected errors in the extension's error section
  const errorMessage = document.getElementById('errorMessage');
  if (!errorMessage) {
    const div = document.createElement('div');
    div.id = 'errorMessage';
    div.className = 'error-message';
    document.body.appendChild(div);
  }

  console.error('Extension error:', message);
  
  const formattedMessage = message.includes('500') ? 
    'Lightning service is temporarily unavailable. Please try again later.' :
    message.includes('padding') ?
    'Unable to decrypt message. The message may be corrupted.' :
    message;

  errorMessage.textContent = formattedMessage;
  errorMessage.style.display = 'block';
  
  // Add animation class
  errorMessage.classList.add('show');
  
  setTimeout(() => {
    errorMessage.classList.remove('show');
    setTimeout(() => {
      errorMessage.style.display = 'none';
    }, 300); // Match this with CSS transition duration
  }, 3000);
}

