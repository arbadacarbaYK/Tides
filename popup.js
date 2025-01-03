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

/**
 * Global state variables for managing UI interactions and message handling
 * @type {string|null} currentChatPubkey - Currently selected chat pubkey
 * @type {Function|null} emojiButtonListener - Event listener for emoji picker
 * @type {Function|null} emojiPickerListener - Event listener for emoji selection
 * @type {boolean} hasPlayedLoginSound - Track login sound playback
 * @type {number} lastMessageTimestamp - Most recent message timestamp
 * @type {Array} searchHistory - User's search term history
 */

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

/**
 * Manages the visibility and state of the login screen
 * Hides main container and shows login form while keeping header visible
 */
function showLoginScreen() {
  const loginScreen = document.getElementById('loginScreen');
  const mainContainer = document.getElementById('mainContainer');
  
  loginScreen.style.display = 'flex';
  mainContainer.style.display = 'none';
  
  // Keep header visible but hide user info
  document.getElementById('userInfo').style.visibility = 'hidden';
}

/**
 * Initializes the extension's user interface
 * - Sets up search functionality
 * - Initializes input handlers
 * - Manages login screen state
 * - Sets up event listeners for user interactions
 */
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
 * Loads user-specific data after successful authentication
 * - Fetches and displays contacts
 * - Loads user metadata
 * - Updates UI with user information
 */
async function handleSuccessfulLogin(user) {
  try {
    document.getElementById('loadingIndicator').style.display = 'block';
    
    // First send login success to background and wait for initialization
    await chrome.runtime.sendMessage({ type: 'LOGIN_SUCCESS', data: { user } });
    
    // Wait a bit for metadata to be fetched through background events
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Then load user data
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

/**
 * Handles sound effects for successful login
 * Uses soundManager utility for consistent audio playback
 */
function playLoginSound() {
  soundManager.play('login', true);
}

/**
 * Processes user login attempts
 * - Validates nsec key input
 * - Authenticates user
 * - Handles success/failure states
 */
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

/**
 * Loads user-specific data after successful authentication
 * - Fetches and displays contacts
 * - Loads user metadata
 * - Updates UI with user information
 */
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

function showMainScreen() {
  document.body.classList.remove('login-screen');
  document.body.classList.add('main-screen');
}

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
 * Processes incoming messages
 * - Shows desktop notifications
 * - Plays notification sounds
 * - Updates UI with new messages
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

  if (contacts && contacts.length > 0) {
    // Get all messages for each contact first
    const contactsWithMessages = await Promise.all(contacts.map(async (contact) => {
      const messages = await messageManager.fetchMessages(contact.pubkey);
      const lastMessage = messages && messages.length > 0 
        ? messages.reduce((latest, msg) => msg.created_at > latest.created_at ? msg : latest)
        : null;
      return {
        ...contact,
        lastMessageTime: lastMessage ? lastMessage.created_at : null
      };
    }));

    // Split contacts into recent and other based on message existence
    const recentContacts = contactsWithMessages.filter(c => c.lastMessageTime !== null);
    const otherContacts = contactsWithMessages.filter(c => c.lastMessageTime === null);

    console.log('Recent contacts:', recentContacts.length);
    console.log('Other contacts:', otherContacts.length);

    // Sort recent contacts by last message time
    recentContacts.sort((a, b) => b.lastMessageTime - a.lastMessageTime);

    // Create Recent Chats section if there are any
    if (recentContacts.length > 0) {
      const recentSection = document.createElement('div');
      recentSection.className = 'contact-section';
      
      const recentHeader = document.createElement('div');
      recentHeader.className = 'section-header';
      recentHeader.dataset.section = 'recent';
      recentHeader.innerHTML = '<h3>Recent Chats</h3><span class="collapse-icon">▼</span>';
      
      const recentContent = document.createElement('div');
      recentContent.className = 'section-content';
      recentContent.id = 'recentContent';
      
      recentContacts.forEach(contact => {
        const contactElement = createContactElement(contact);
        if (contact.isTemporary) {
          contactElement.classList.add('non-contact');
        }
        recentContent.appendChild(contactElement);
      });
      
      recentSection.appendChild(recentHeader);
      recentSection.appendChild(recentContent);
      contactList.appendChild(recentSection);
    }

    // Create Other Contacts section if there are any
    if (otherContacts.length > 0) {
      const otherSection = document.createElement('div');
      otherSection.className = 'contact-section';
      
      const otherHeader = document.createElement('div');
      otherHeader.className = 'section-header';
      otherHeader.dataset.section = 'other';
      otherHeader.innerHTML = '<h3>Other Contacts</h3><span class="collapse-icon">▼</span>';
      
      const otherContent = document.createElement('div');
      otherContent.className = 'section-content';
      otherContent.id = 'otherContent';
      
      // Sort other contacts alphabetically by display name
      otherContacts.sort((a, b) => a.displayName.localeCompare(b.displayName));
      
      otherContacts.forEach(contact => {
        const contactElement = createContactElement(contact);
        otherContent.appendChild(contactElement);
      });
      
      otherSection.appendChild(otherHeader);
      otherSection.appendChild(otherContent);
      contactList.appendChild(otherSection);
    }
  }
}

// Add search functionality
document.getElementById('searchInput').addEventListener('input', function(e) {
  const searchTerm = e.target.value.toLowerCase();
  const contacts = Array.from(contactManager.contacts.values());
  
  if (searchTerm) {
    const filteredContacts = contacts.filter(contact => 
      contact.displayName.toLowerCase().includes(searchTerm) ||
      contact.npub.toLowerCase().includes(searchTerm)
    );
    renderContactList(filteredContacts);
  } else {
    renderContactList(contacts);
  }
});

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
  
  const avatarSrc = contact.avatarUrl || (contact.isChannel ? '/icons/default-avatar.png' : '/icons/default-avatar.png');
  
  // Create elements directly instead of using innerHTML
  const img = document.createElement('img');
  img.src = avatarSrc;
  img.alt = contact.displayName;
  img.className = 'contact-avatar';

  const contactInfo = document.createElement('div');
  contactInfo.className = 'contact-info';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'contact-name';
  nameSpan.textContent = contact.displayName;
  contactInfo.appendChild(nameSpan);

  // Add last message time if available
  const lastMessageTime = contactManager.lastMessageTimes.get(contact.pubkey);
  if (lastMessageTime) {
    const timeSpan = document.createElement('span');
    timeSpan.className = 'last-message-time';
    timeSpan.textContent = formatTime(lastMessageTime);
    contactInfo.appendChild(timeSpan);
  }

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

function formatTime(timestamp) {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now - date;
  
  // If less than 24 hours ago, show time
  if (diff < 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  // If less than 7 days ago, show day of week
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  
  // Otherwise show date
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
  
  // Show loading spinner
  chatContainer.innerHTML = `
    <div class="message-container">
      <div class="message-list">
        <div class="chat-loading-spinner">
          <div class="spinner"></div>
        </div>
      </div>
    </div>`;
    
  const messages = await messageManager.fetchMessages(pubkey);
  if (messages && messages.length > 0) {
    // Update last message time for the contact
    const lastMessage = messages.reduce((latest, msg) => 
      msg.created_at > latest.created_at ? msg : latest
    );
    
    // Only update the specific contact's last message time
    const currentTime = contactManager.lastMessageTimes.get(pubkey);
    if (!currentTime || lastMessage.created_at > currentTime) {
      contactManager.updateLastMessageTime(pubkey, lastMessage.created_at);
    }
    
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

    if (messageList.innerHTML == '<div class="no-messages">No messages yet</div>')
    {
      messageList.innerHTML = '';
    }
    
    messageElement.appendChild(bubbleElement);
    messageList.appendChild(messageElement);
    messageElement.scrollIntoView({ behavior: 'smooth' });
    
    const result = await messageManager.sendMessage(currentChatPubkey, content);
    
    // Update last message time and re-render contact list
    contactManager.updateLastMessageTime(currentChatPubkey, result.created_at);
    renderContactList(Array.from(contactManager.contacts.values()));
    
  } catch (error) {
    console.error('Failed to send message:', error);
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

// Replace the hardcoded streams array with a function to fetch stream data
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

async function loadLinkPreviews() {
  // First handle regular link previews (keep existing code)
  const links = document.querySelectorAll('.message-text a');
  const mediaLinks = Array.from(links).filter(link => {
    const content = link.href || link.textContent;
    return content.includes('youtube.com') || 
           content.includes('youtu.be') ||
           content.includes('twitter.com') ||
           content.includes('x.com') ||
           content.includes('twitch.tv') ||
           content.includes('instagram.com') ||
           content.includes('tiktok.com') ||
           content.includes('iris.to') ||
           // Match both direct identifiers and nostr: protocol
           content.match(/(?:nostr:)?(?:note|nevent|npub|nprofile|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+/);
  });

  for (const link of mediaLinks) {
    try {
      const url = link.href;
      if (link.nextElementSibling?.classList.contains('link-preview')) continue;

      const previewContainer = document.createElement('div');
      previewContainer.className = 'link-preview';
      const previewContent = document.createElement('div');
      previewContent.className = 'link-preview-content';

      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const videoId = url.includes('youtube.com') ? 
          url.split('v=')[1]?.split('&')[0] : 
          url.split('youtu.be/')[1]?.split('?')[0];
          
        if (videoId) {
          previewContent.innerHTML = `
            <div class="video-preview">
              <iframe width="100%" height="200" 
                src="https://www.youtube.com/embed/${videoId}" 
                frameborder="0" allowfullscreen>
              </iframe>
            </div>`;
        }
      } else if (url.includes('twitch.tv')) {
        const channelName = url.split('twitch.tv/')[1]?.split('/')[0];
        if (channelName) {
          previewContent.innerHTML = `
            <div class="stream-embed">
              <iframe
                src="https://player.twitch.tv/?channel=${channelName}&parent=${location.hostname}&muted=true"
                height="300"
                width="100%"
                allowfullscreen="true"
                frameborder="0">
              </iframe>
            </div>`;
        }
      } else if (url.includes('twitter.com') || url.includes('x.com')) {
        const tweetId = url.split('/status/')[1]?.split('?')[0];
        if (tweetId) {
          previewContent.innerHTML = `
            <div class="social-preview">
              <iframe width="100%" 
                src="https://platform.twitter.com/embed/Tweet.html?id=${tweetId}" 
                frameborder="0">
              </iframe>
            </div>`;
        }
      } else if (url.includes('iris.to')) {
        // Handle iris.to links
        const npubMatch = url.match(/npub1[a-zA-Z0-9]+/);
        if (npubMatch) {
          try {
            const pubkey = NostrTools.nip19.decode(npubMatch[0]).data;
            const metadata = await getUserMetadata(pubkey);
            previewContent.innerHTML = `
              <div class="nostr-preview">
                <div class="nostr-author">
                  <img src="${metadata?.picture || '/icons/default-avatar.png'}" alt="Avatar" class="avatar">
                  <span>${metadata?.name || metadata?.displayName || shortenIdentifier(pubkey)}</span>
                </div>
                ${metadata?.about ? `<div class="nostr-content">${metadata.about}</div>` : ''}
              </div>`;
          } catch (error) {
            console.warn('Failed to decode iris.to npub:', error);
          }
        }
      } else if (url.match(/(?:nostr:)?(?:note|nevent|npub|nprofile|naddr)1/) || url.match(/^(?:note|nevent|npub|nprofile|naddr)1/)) {
        // Handle both direct identifiers and nostr: protocol
        const nostrId = url.includes('nostr:') ? 
          url.split('nostr:')[1] : 
          (url.match(/(?:note|nevent|npub|nprofile|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+/)?.[0] || url);

        try {
          const decoded = NostrTools.nip19.decode(nostrId);
          if (decoded.type === 'note' || decoded.type === 'nevent') {
            const eventId = decoded.type === 'note' ? decoded.data : decoded.data.id;
            const event = await pool.get(RELAYS, { ids: [eventId] });
            if (event) {
              const metadata = await getUserMetadata(event.pubkey);
              previewContent.innerHTML = `
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
            previewContent.innerHTML = `
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
        }

      }

      if (previewContent.innerHTML) {
        previewContainer.appendChild(previewContent);
        link.parentNode.insertBefore(previewContainer, link.nextSibling);
      }
    } catch (error) {
      console.warn('Failed to create media preview:', error);
    }
  }

  // Then handle raw nostr identifiers
  const messageTexts = document.querySelectorAll('.message-text');
  for (const messageText of messageTexts) {
    await handleRawNostrIdentifiers(messageText);
  }
}

async function showZapModal(message, metadata, zapContainer) {
  const modal = document.createElement('div');
  modal.className = 'modal zap-modal';
  
  modal.innerHTML = `
    <div class="modal-content zap-modal-content">
      <h3>Send Zap</h3>
      <div class="zap-input-container">
        <input type="number" id="zapAmount" min="1" value="100" />
      </div>
      <pre id="zapError" class="error-message" style="display: none; margin: 10px 0; padding: 10px; background: rgba(255,0,0,0.1); border-radius: 4px; white-space: pre-wrap; word-break: break-word; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto;"></pre>
      <div class="button-container">
        <button id="sendZapButton" class="primary-button">Send Zap</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const sendButton = modal.querySelector('#sendZapButton');
  const amountInput = modal.querySelector('#zapAmount');
  const errorDiv = modal.querySelector('#zapError');

  sendButton.addEventListener('click', async () => {
    const amount = parseInt(amountInput.value);
    if (amount > 0) {
      try {
        errorDiv.style.display = 'none';
        sendButton.disabled = true;
        sendButton.textContent = 'Processing...';

        const response = await chrome.runtime.sendMessage({
          type: 'GET_ZAP_INVOICE',
          data: {
            lightningAddress: metadata.lud16 || metadata?.lightning,
            amount,
            zapRequest: {
              kind: 9734,
              pubkey: (await auth.getCurrentUser()).pubkey,
              created_at: Math.floor(Date.now() / 1000),
              content: "Zapped a DM",
              tags: [
                ['p', message.pubkey],
                ['e', message.id],
                ['amount', amount.toString()],
                ['relays', ...RELAYS]
              ]
            }
          }
        });

        if (response.error) {
          errorDiv.textContent = `Error Details:\n${response.error}`;
          errorDiv.style.display = 'block';
          throw new Error(response.error);
        }

        await showQRModal(response.invoice);
        modal.remove();
      } catch (error) {
        console.error('Zap failed:', error);
        errorDiv.textContent = `Error Details:\n${error.message}`;
        errorDiv.style.display = 'block';
        sendButton.disabled = false;
        sendButton.textContent = 'Send';
      }
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

async function handleZap(message, metadata, amount, zapContainer) {
  try {
    const currentUser = await auth.getCurrentUser();
    const zapRequest = {
      kind: 9734,
      pubkey: currentUser.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      content: "Zapped a DM",
      tags: [
        ['p', message.pubkey],
        ['e', message.id],
        ['amount', amount.toString()],
        ['relays', ...RELAYS]
      ]
    };

    const invoice = await createZapInvoice(metadata, amount, zapRequest);
    await showQRModal(invoice);

  } catch (error) {
    console.error('Zap failed:', error);
    showErrorMessage(error.message);
  }
}

async function createZapInvoice(metadata, amount, zapRequest) {
  const lightningAddress = metadata.lud16 || metadata?.lightning;
  if (!lightningAddress) throw new Error('No lightning address found');

  try {
    // Send request to background script to handle LNURL fetching
    const response = await chrome.runtime.sendMessage({
      type: 'GET_ZAP_INVOICE',
      data: {
        lightningAddress,
        amount,
        zapRequest
      }
    });

    if (!response) {
      throw new Error('No response received from background script');
    }

    if (response.error) {
      throw new Error(response.error);
    }

    if (!response.invoice) {
      throw new Error('No invoice in response');
    }

    return response.invoice;
  } catch (error) {
    console.error('Failed to create invoice:', error);
    throw error; // Pass through the original error instead of wrapping it
  }
}

async function showQRModal(invoice) {
  const modal = document.createElement('div');
  modal.className = 'qr-modal';
  
  modal.innerHTML = `<div class="qr-modal-content"><div class="qr-container"><div id="qrcode-container"></div><div class="invoice-text">${invoice}</div><div class="modal-buttons"><button class="copy-button">Copy Invoice</button><button class="close-button">Close</button></div></div></div>`;
  
  document.body.appendChild(modal);

  if (typeof window.qrcode === 'undefined') {
    throw new Error('QR code library not loaded');
  }
  
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
      showErrorMessage('Failed to copy invoice');
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
  return !!(metadata?.lud16 || metadata?.lightning);
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

// Add message listener for incoming messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NEW_MESSAGE') {
    const { pubkey, created_at } = message.data;
    
    // Update last message time and re-render contact list
    contactManager.updateLastMessageTime(pubkey, created_at);
    renderContactList(Array.from(contactManager.contacts.values()));
    
    // If this is the current chat, render the new message
    if (currentChatPubkey === pubkey) {
      renderMessages(messageManager.fetchMessages(pubkey));
    }
  }
});

/**
 * @file popup.js
 * @description Main UI controller for the Nostr Messenger Chrome Extension
 * 
 * Core features:
 * - User authentication and login flow
 * - Contact list management and display
 * - Chat interface and message handling
 * - Stream/channel integration
 * - Search functionality
 * - UI state management
 * 
 * UI Components:
 * - Login screen with NIP-07/NSEC support
 * - Contact list with search
 * - Chat interface with emoji/GIF support
 * - Message preview system
 * - Stream embedding
 * 
 * State Management:
 * - Current chat tracking
 * - Message timestamps
 * - Search history
 * - UI element listeners
 * 
 * @requires auth
 * @requires contactManager
 * @requires messageManager
 * @requires userMetadata
 */
