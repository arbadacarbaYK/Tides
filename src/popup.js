console.log('popup.js loaded');

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

let currentChatPubkey = null;
let emojiButtonListener;
let emojiPickerListener;
let hasPlayedLoginSound = false;
let lastMessageTimestamp = 0;

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

function initializeUI() {
  const loginScreen = document.getElementById('loginScreen');
  const mainContainer = document.getElementById('mainContainer');
  const nsecInput = document.getElementById('nsecInput');
  const loginButton = document.getElementById('loginButton');
  
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
    
    // Handle clear button visibility
    clearSearchButton.style.display = searchTerm ? 'block' : 'none';
    
    // Handle contact filtering
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
  initializeUI();
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

  // Rest of the contacts section remains the same
  if (contacts && contacts.length > 0) {
    const contactSection = document.createElement('div');
    contactSection.className = 'contact-section';
    
    const contactHeader = document.createElement('div');
    contactHeader.className = 'section-header';
    contactHeader.dataset.section = 'contacts';
    contactHeader.innerHTML = '<h3>Contacts</h3><span class="collapse-icon">▼</span>';
    
    const contactContent = document.createElement('div');
    contactContent.className = 'section-content';
    contactContent.id = 'contactsContent';
    
    contacts.forEach(contact => {
      const contactElement = createContactElement(contact);
      contactContent.appendChild(contactElement);
    });
    
    contactSection.appendChild(contactHeader);
    contactSection.appendChild(contactContent);
    contactList.appendChild(contactSection);
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
  
  const avatarSrc = contact.avatarUrl || (contact.isChannel ? '/icons/default-channel.png' : '/icons/default-avatar.png');
  
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

  if (!contact.isChannel) {
    const indicator = document.createElement('div');
    indicator.className = `online-indicator ${contact.isOnline ? 'online' : ''}`;
    contactInfo.appendChild(indicator);
  }

  element.appendChild(img);
  element.appendChild(contactInfo);
  
  // Add click handler
  element.addEventListener('click', async () => {
    if (contact.isChannel) {
      // For streams/channels, allow selection and initialize stream
      element.classList.add('selected');
      await initializeChat(contact.pubkey);
    } else {
      // For regular contacts, don't remove stream selection
      document.querySelectorAll('.contact-item').forEach(el => {
        if (!el.dataset.streamUrl) {
          el.classList.remove('selected');
        }
      });
      element.classList.add('selected');
      await initializeChat(contact.pubkey);
    }
  });
  
  return element;
}

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'NEW_MESSAGE':
      handleNewMessage(message.data);
      break;
    case 'CONTACT_UPDATED':
      updateContactInList(message.data);
      break;
    case 'INIT_COMPLETE':
      console.log('Initialization complete');
      break;
    case 'INIT_ERROR':
      showErrorMessage(message.error);
      break;
  }
  return true;
});

async function selectContact(pubkey) {
  await initializeChat(pubkey);
}

async function initializeChat(pubkey) {
  const chatHeader = document.getElementById('chatHeader');
  const chatContainer = document.getElementById('chatContainer');
  const messageInputContainer = document.querySelector('.message-input-container');
  
  if (!pubkey) {
    resetChatUI();
    return;
  }

  currentChatPubkey = pubkey;
  
  try {
    const streamElement = document.querySelector(`[data-pubkey="${pubkey}"][data-stream-url]`);
    if (streamElement) {
      handleStreamChat(pubkey, chatHeader, chatContainer);
      messageInputContainer.style.display = 'none';
      return;
    }

    // Regular contact chat
    messageInputContainer.style.display = 'flex';
    const contact = getContact(pubkey);
    if (!contact) return;

    updateChatHeader(chatHeader, contact);
    
    // Clear existing messages first
    chatContainer.innerHTML = '<div class="message-list"></div>';
    
    // Fetch and render messages
    const messages = await messageManager.fetchMessages(pubkey);
    if (messages && messages.length > 0) {
      renderMessages(messages);
    } else {
      chatContainer.querySelector('.message-list').innerHTML = '<div class="no-messages">No messages yet</div>';
    }

  } catch (error) {
    console.error('Failed to initialize chat:', error);
    showErrorMessage('Failed to load chat');
  }
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

function renderMessages(messages) {
  const messageList = document.querySelector('.message-list');
  if (!messageList) return;
  
  messageList.innerHTML = '';
  
  messages
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach(async message => {
      if (!message.decrypted) return;
      
      const messageElement = document.createElement('div');
      const currentUser = await auth.getCurrentUser();
      const isSent = message.pubkey === currentUser?.pubkey;
      messageElement.className = `message ${isSent ? 'sent' : 'received'}`;
      
      const bubbleElement = document.createElement('div');
      bubbleElement.className = 'message-bubble';
      
      await renderMessageContent(message, bubbleElement);
      messageElement.appendChild(bubbleElement);
      messageList.appendChild(messageElement);
    });

  // Scroll to bottom after rendering
  const chatContainer = document.getElementById('chatContainer');
  if (chatContainer) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

// Setup message input handlers
messageInput.addEventListener('keypress', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    await sendMessage();
  }
});

sendButton.addEventListener('click', sendMessage);
    
emojiButtonListener = () => {
  // Remove any existing picker
  const existingPicker = document.querySelector('emoji-picker');
  if (existingPicker) {
    existingPicker.remove();
    return; // Toggle behavior - if picker exists, just remove it
  }

  const picker = document.createElement('emoji-picker');
  picker.classList.add('emoji-picker');
  
  if (emojiPickerListener) {
    picker.removeEventListener('emoji-click', emojiPickerListener);
  }
  
  emojiPickerListener = (event) => {
    messageInput.value += event.detail.unicode;
    picker.remove();
  };
  
  picker.addEventListener('emoji-click', emojiPickerListener);
  
  // Position the picker above the input area
  const inputContainer = document.querySelector('.message-input-container');
  inputContainer.appendChild(picker);
  
  // Ensure picker is visible within viewport
  const pickerRect = picker.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  
  if (pickerRect.top < 0) {
    // If picker would go above viewport, position it below the input instead
    picker.style.bottom = 'auto';
    picker.style.top = '100%';
    picker.style.marginTop = '8px';
    picker.style.marginBottom = '0';
  }
  
  // Handle clicks outside the picker
  const handleOutsideClick = (e) => {
    if (!picker.contains(e.target) && e.target !== emojiButton) {
      picker.remove();
      document.removeEventListener('click', handleOutsideClick);
    }
  };
  
  // Add slight delay to prevent immediate closure
  setTimeout(() => {
    document.addEventListener('click', handleOutsideClick);
  }, 100);
};

emojiButton.addEventListener('click', emojiButtonListener);

// Add GIF button functionality (placeholder)
gifButton.addEventListener('click', () => {
  alert('GIF functionality coming soon!');
});

async function handleStreamChat(pubkey, header, container) {
  const channel = contactManager.channels.get(pubkey);
  if (!channel) return;

  header.innerHTML = `
    <img src="${channel.avatarUrl}" alt="${channel.displayName}" class="contact-avatar">
    <span>${channel.displayName}</span>
  `;

  container.innerHTML = `
    <div class="video-container">
      <iframe 
        src="https://zap.stream/${channel.streamUrl}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        style="width: 100%; height: 100%; border: none;">
      </iframe>
    </div>
  `;
}

function updateChatHeader(header, contact) {
  header.innerHTML = `
    <img src="${contact.avatarUrl || (contact.isChannel ? '/icons/default-channel.png' : '/icons/default-avatar.png')}" 
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
    }
    
    messageElement.appendChild(bubbleElement);
    messageList.appendChild(messageElement);
    messageElement.scrollIntoView({ behavior: 'smooth' });
    
    // Background send
    await messageManager.sendMessage(currentChatPubkey, content);
    
  } catch (error) {
    console.error('Failed to send message:', error);
    showErrorMessage('Failed to send message');
  }
}

async function renderMessageContent(message, bubbleElement) {
  const currentUser = await auth.getCurrentUser();
  
  // Handle decrypted message content
  const content = message.decrypted;
  
  // Handle different message types
  if (typeof content === 'object' && content.type) {
    switch (content.type) {
      case 'market-order':
        bubbleElement.innerHTML = `
          <div class="market-order">
            <div class="order-header">Order #${content.content.shipping_id}</div>
            <div class="order-items">
              ${content.content.items.map(item => 
                `<div class="order-item">
                  <span class="quantity">${item.quantity}x</span>
                  <span class="name">${item.name}</span>
                  <span class="price">${item.price}</span>
                </div>`
              ).join('')}
            </div>
            ${content.content.message ? 
              `<div class="order-message">${content.content.message}</div>` : 
              ''}
          </div>`;
        break;

      case 'media':
        const isVideo = content.mediaUrl?.match(/\.(mp4|webm|mov|ogg)$/i);
        bubbleElement.innerHTML = `
          <div class="media-container">
            ${isVideo ? 
              `<video src="${content.mediaUrl}" controls class="message-media"></video>` :
              `<img src="${content.mediaUrl}" class="message-media" loading="lazy">`
            }
            ${content.content ? 
              `<div class="message-text">${linkifyText(content.content)}</div>` : 
              ''}
          </div>`;
        break;

      default:
        bubbleElement.innerHTML = `<div class="message-text">${linkifyText(content.content)}</div>`;
    }
  } else {
    // Plain text messages
    bubbleElement.innerHTML = `<div class="message-text">${linkifyText(content)}</div>`;
  }
}

function linkifyText(text) {
  return text
    .replace(/\n/g, '<br>')
    .replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s]|[a-zA-Z0-9][a-zA-Z0-9-]+\.[a-zA-Z]{2,}\b(?:\/[^\s<]*)?)/g, (url) => {
      if (url.match(/\.(jpg|jpeg|gif|png|mpwebm|mov|ogg)$/i)) {
        return ''; // Don't show media URLs in text
      }
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      return `<a href="${fullUrl}" target="_blank" rel="noopener">${url.replace(/^https?:\/\//, '')}</a>`;
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
    
    const img = document.createElement('img');
    img.src = gif.previewUrl;
    img.loading = 'lazy';
    
    item.appendChild(img);
    item.addEventListener('click', () => {
      const messageInput = document.getElementById('messageInput');
      const cleanUrl = gif.url.split('&ct=g')[0];
      messageInput.value += ` ${cleanUrl} `;
      messageInput.focus();
      container.closest('.gif-picker').remove();
    });
    
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
    pubkey: 'npub1ua6fxn9ktc4jncanf79jzvklgjftcdrt5etverwzzg0lgpmg3hsq2gh6v6',
    displayName: 'Noderunners Radio',
    isChannel: true,
    avatarUrl: 'https://image.nostr.build/9a9c9e5dba5ed17361f2f593dda02bd2ba85a14e69db1f251b27423f43864efe.webp',
    streamUrl: 'naddr1qqjrvvt9vdjkzc3c943nxdmr956rqc3k95urjdps95crqdmrvd3nxvtxvdskxqghwaehxw309aex2mrp0yhxummnw3ezucnpdejz7qgewaehxw309aex2mrp0yh8xmn0wf6zuum0vd5kzmp0qy88wumn8ghj7mn0wvhxcmmv9uq32amnwvaz7tmjv4kxz7fwv3sk6atn9e5k7tcpz9mhxue69uhkummnw3ezumrpdejz7qg7waehxw309ahx7um5wgkhqatz9emk2mrvdaexgetj9ehx2ap0qyghwumn8ghj7mn0wd68ytnhd9hx2tcpz4mhxue69uhhyetvv9ujumn0wd68ytnzvuhsz9thwden5te0dehhxarj9ehhsarj9ejx2a30qgsv73dxhgfk8tt76gf6q788zrfyz9dwwgwfk3aar6l5gk82a76v9fgrqsqqqan8acwaac'
  };

  const channel = {
    ...streamData,
    id: streamData.pubkey
  };
  
  contactManager.channels.set(channel.pubkey, channel);
  return channel;
}

document.getElementById('extensionLoginButton').addEventListener('click', async () => {
  try {
    if (!window.nostr) {
      showErrorMessage('No Nostr extension found.');
      return;
    }
    
    const user = await auth.login('NIP-07');
    if (user) {
      await handleSuccessfulLogin(user);
    }
  } catch (error) {
    console.error('Extension login error:', error);
    showErrorMessage('Extension login failed: ' + error.message);
  }
});

async function loadLinkPreviews() {
  const links = document.querySelectorAll('.message-text a');
  
  for (const link of links) {
    try {
      const url = link.href;
      if (link.nextElementSibling?.classList.contains('link-preview') || 
          url.match(/\.(jpg|jpeg|gif|png|mp4|webm|mov|ogg)$/i)) {
        continue;
      }

      const previewContainer = document.createElement('div');
      previewContainer.className = 'link-preview';

      const previewContent = document.createElement('div');
      previewContent.className = 'link-preview-content';

      try {
        const response = await fetch(url);
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const title = doc.querySelector('meta[property="og:title"]')?.content || 
                     doc.querySelector('title')?.textContent || 
                     new URL(url).hostname;
                     
        const description = doc.querySelector('meta[property="og:description"]')?.content || 
                           doc.querySelector('meta[name="description"]')?.content || '';
                           
        const image = doc.querySelector('meta[property="og:image"]')?.content;

        previewContent.innerHTML = `
          ${image ? `<img src="${image}" alt="${title}" loading="lazy">` : ''}
          <div class="preview-title">${title}</div>
          ${description ? `<div class="preview-description">${description}</div>` : ''}
        `;
      } catch (err) {
        console.warn('Failed to fetch preview:', err);
        previewContent.innerHTML = `
          <div class="preview-title">${new URL(url).hostname}</div>
        `;
      }

      previewContainer.appendChild(previewContent);
      link.parentNode.insertBefore(previewContainer, link.nextSibling);

    } catch (err) {
      console.warn('Failed to create preview:', err);
    }
  }
}

