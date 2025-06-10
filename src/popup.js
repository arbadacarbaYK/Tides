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
import { nostrCore, pool, relayPool } from './shared.js';

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
let currentGroupId = null; 

function initializeGifButton() {
  const gifButton = document.getElementById('gifButton');
  if (!gifButton) return;

  // Remove existing listeners
  const newGifButton = gifButton.cloneNode(true);
  gifButton.parentNode.replaceChild(newGifButton, gifButton);

  newGifButton.addEventListener('click', async () => {
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
      showErrorMessage('Failed to load GIFs');
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
          showErrorMessage('GIF search failed');
        }
      }, 300);
    });

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
  initializeCreateGroupButton();
  
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
      if (window.nostr) {
        showErrorMessage('NIP-07 login failed');
      }
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
    
    // Initialize contacts
    const contacts = await fetchContacts(user.pubkey);
    setContacts(contacts);

    // Initialize groups
    if (window.groupContactManager) {
      console.log('Initializing group manager...');
      await window.groupContactManager.init();
      console.log('Groups after init:', Array.from(window.groupContactManager.groups.values()));
    } else {
      console.error('groupContactManager not available');
    }

    // Render both contacts and groups
    await renderContactList(contacts);

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
  const userInfo = document.getElementById('userInfo');
  
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

  // Add click handler for profile popup
  if (userInfo) {
    userInfo.style.cursor = 'pointer';
    userInfo.addEventListener('click', async () => {
      const currentUser = await auth.getCurrentUser();
      const npub = pubkeyToNpub(currentUser.pubkey);
      
      const modal = document.createElement('div');
      modal.className = 'modal profile-modal';
      
      modal.innerHTML = `
        <div class="modal-content profile-modal-content">
          <div class="profile-header">
            <img src="${metadata.picture || '/icons/default-avatar.png'}" alt="Profile" class="profile-avatar">
            <h3>${metadata.name || metadata.displayName || 'Anonymous'}</h3>
          </div>
          <div class="profile-details">
            <div class="profile-field">
              <label>Npub</label>
              <div class="copyable-field">
                <input type="text" readonly value="${npub}">
                <button class="copy-button" data-value="${npub}" title="Copy">📋</button>
              </div>
            </div>
            ${metadata.nip05 ? `
              <div class="profile-field">
                <label>NIP-05</label>
                <div class="copyable-field">
                  <input type="text" readonly value="${metadata.nip05}">
                  <button class="copy-button" data-value="${metadata.nip05}" title="Copy">📋</button>
                </div>
              </div>
            ` : ''}
            ${metadata.lud16 ? `
              <div class="profile-field">
                <label>Lightning Address</label>
                <div class="copyable-field">
                  <input type="text" readonly value="${metadata.lud16}">
                  <button class="copy-button" data-value="${metadata.lud16}" title="Copy">📋</button>
                </div>
              </div>
            ` : ''}
            ${metadata.about ? `
              <div class="profile-field">
                <label>About</label>
                <div class="about-text">${metadata.about}</div>
              </div>
            ` : ''}
          </div>
          <div class="modal-buttons">
            <button class="copy-button">Copy</button>
            <button class="close-button">Close</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);

      // Add copy functionality
      const copyButtons = modal.querySelectorAll('.copy-button');
      copyButtons.forEach(button => {
        button.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(button.dataset.value);
            const originalText = button.textContent;
            button.textContent = '✓';
            button.classList.add('copied');
            setTimeout(() => {
              button.textContent = '📋';
              button.classList.remove('copied');
            }, 2000);
          } catch (error) {
            console.error('Failed to copy:', error);
            showErrorMessage('Failed to copy to clipboard');
          }
        });
      });

      // Add close functionality
      const closeButton = modal.querySelector('.close-button');
      closeButton.addEventListener('click', () => {
        modal.remove();
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
      });
    });
  }
}

async function renderContactList(contacts) {
  const contactList = document.getElementById('contactList');
  if (!contactList) return;
  
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

  // Create groups section
  const groupSection = document.createElement('div');
  groupSection.className = 'contact-section';
  
  const groupHeader = document.createElement('div');
  groupHeader.className = 'section-header';
  groupHeader.dataset.section = 'groups';
  groupHeader.innerHTML = '<h3>Groups</h3><span class="collapse-icon">▼</span>';
  
  const groupContent = document.createElement('div');
  groupContent.className = 'section-content';
  groupContent.id = 'groupsContent';

  // Add create group button
  const createGroupButton = document.createElement('button');
  createGroupButton.className = 'create-group-button';
  createGroupButton.innerHTML = '<span>Create New Group</span>';
  groupContent.appendChild(createGroupButton);

  // Initialize the create group button right after creating it
  initializeCreateGroupButton();

  // Add user's groups
  if (window.groupContactManager) {
    const userGroups = Array.from(window.groupContactManager.groups.values())
      .filter(group => {
        // Double check that the group is not in leftGroups
        const isLeft = window.groupContactManager.leftGroups.has(group.id);
        console.log('Group:', group.id, 'isLeft:', isLeft);
        return !isLeft;
      })
      .sort((a, b) => {
        const timeA = a.lastMessage?.created_at || a.created_at;
        const timeB = b.lastMessage?.created_at || b.created_at;
        return timeB - timeA;
      });

    console.log('Filtered groups:', userGroups);

    if (userGroups && userGroups.length > 0) {
      userGroups.forEach(group => {
        const groupElement = createContactElement({
          pubkey: group.id,
          id: group.id,
          displayName: group.name || 'Unnamed Group',
          avatarUrl: (group.picture || '').trim() || 'icons/default-group.png',
          about: group.about || '',
          created_at: group.created_at,
          isGroup: true,
          members: group.members || [],
          creator: group.creator,
          name: group.name || 'Unnamed Group',
          picture: (group.picture || '').trim() || 'icons/default-group.png'
        });
        groupContent.appendChild(groupElement);
      });
    } else {
      const noGroupsMessage = document.createElement('div');
      noGroupsMessage.className = 'no-groups-message';
      noGroupsMessage.textContent = 'No groups yet';
      groupContent.appendChild(noGroupsMessage);
    }
  }
  
  groupSection.appendChild(groupHeader);
  groupSection.appendChild(groupContent);
  contactList.appendChild(groupSection);

  if (contacts && contacts.length > 0) {
    // Get all messages for each contact first, including temporary contacts
    const contactsWithMessages = await Promise.all(contacts.map(async (contact) => {
      try {
        const messages = await messageManager.fetchMessages(contact.pubkey);
        // Filter out group messages to only consider DMs
        const dmMessages = messages.filter(msg => !msg.groupId && msg.type !== 'group');
        const lastMessage = dmMessages && dmMessages.length > 0 
          ? dmMessages.reduce((latest, msg) => msg.created_at > latest.created_at ? msg : latest)
          : null;
        return {
          ...contact,
          lastMessageTime: lastMessage ? lastMessage.created_at : null
        };
      } catch (error) {
        console.error('Error fetching messages for contact:', contact.pubkey, error);
        return {
          ...contact,
          lastMessageTime: null
        };
      }
    }));

    // Split contacts into recent and other based on message existence
    const recentContacts = contactsWithMessages.filter(c => c.lastMessageTime !== null);
    const otherContacts = contactsWithMessages.filter(c => c.lastMessageTime === null);

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

    // Create Other Contacts section
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
    otherContacts.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    
    otherContacts.forEach(contact => {
      const contactElement = createContactElement(contact);
      otherContent.appendChild(contactElement);
    });
    
    otherSection.appendChild(otherHeader);
    otherSection.appendChild(otherContent);
    contactList.appendChild(otherSection);
  }

  // Add section collapse functionality
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      const content = document.getElementById(`${header.dataset.section}Content`);
      const icon = header.querySelector('.collapse-icon');
      if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.textContent = '▼';
      } else {
        content.style.display = 'none';
        icon.textContent = '▶';
      }
    });
  });
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
  element.className = `contact-item ${contact.isChannel ? 'channel' : ''} ${contact.isGroup ? 'group' : ''}`;
  element.dataset.pubkey = contact.pubkey || contact.id;
  
  const img = document.createElement('img');
  img.className = contact.isGroup ? 'group-avatar' : 'contact-avatar';
  img.src = contact.avatarUrl || '/icons/default-avatar.png';
  img.onerror = () => {
    if (contact.isGroup) {
      // Create text-based avatar for groups
      img.style.display = 'flex';
      img.style.alignItems = 'center';
      img.style.justifyContent = 'center';
      img.style.backgroundColor = 'var(--border-color)';
      img.style.color = 'var(--text-color)';
      img.style.fontSize = '18px';
      img.textContent = (contact.name || 'Group').substring(0, 2).toUpperCase();
    } else {
      img.src = '/icons/default-avatar.png';
    }
  };
  
  const contactInfo = document.createElement('div');
  contactInfo.className = contact.isGroup ? 'group-info' : 'contact-info';
  
  const nameSpan = document.createElement('span');
  nameSpan.className = contact.isGroup ? 'group-name' : 'contact-name';
  nameSpan.textContent = contact.displayName || shortenIdentifier(contact.pubkey || contact.id);
  contactInfo.appendChild(nameSpan);

  if (contact.isGroup) {
    const membersSpan = document.createElement('span');
    membersSpan.className = 'group-members';
    membersSpan.textContent = `${contact.members?.length || 0} members`;
    contactInfo.appendChild(membersSpan);
  } else if (!contact.isChannel) {
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
    } else if (contact.isGroup) {
      messageInputContainer.style.display = 'flex';
      await initializeGroupChat(contact.id);
    } else {
      messageInputContainer.style.display = 'flex';
      currentChatPubkey = contact.pubkey;
      await initializeChat(contact.pubkey);
    }
  });

  // Add context menu handler
  element.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    
    // Remove any existing context menus
    document.querySelectorAll('.context-menu').forEach(menu => menu.remove());
    
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';

    if (contact.isGroup) {
      const currentUser = await auth.getCurrentUser();
      // Ensure we're comparing lowercase pubkeys
      const isCreator = currentUser && 
                       contact.creator?.toLowerCase() === currentUser.pubkey?.toLowerCase();
      
      contextMenu.innerHTML = `
        <div class="context-menu-item" data-action="info">Group Info</div>
        ${isCreator ? '<div class="context-menu-item" data-action="edit">Edit Group</div>' : ''}
        <div class="context-menu-item" data-action="leave">Leave Group</div>
      `;
    } else {
      contextMenu.innerHTML = `
        <div class="context-menu-item" data-action="profile">See Profile</div>
      `;
    }
    
    // Position the menu at cursor
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;

    document.body.appendChild(contextMenu);

    // Adjust position if menu goes off screen
    const rect = contextMenu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    if (rect.right > windowWidth) {
      contextMenu.style.left = `${windowWidth - rect.width - 5}px`;
    }
    if (rect.bottom > windowHeight) {
      contextMenu.style.top = `${windowHeight - rect.height - 5}px`;
    }
    
    // Handle menu item clicks with direct event delegation
    const menuItems = contextMenu.querySelectorAll('.context-menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        if (!action) return;

        switch (action) {
          case 'info':
            await showGroupInfoModal(contact);
            break;
          case 'edit':
            const currentUser = await auth.getCurrentUser();
            if (currentUser && contact.creator === currentUser.pubkey) {
              await showGroupEditModal(contact);
            }
            break;
          case 'leave':
            await showLeaveGroupModal(contact);
            break;
          case 'profile':
            const metadata = await getUserMetadata(contact.pubkey);
            showProfileModal(contact.pubkey, metadata);
            break;
        }
        contextMenu.remove();
      });
    });
    
    // Close menu when clicking outside
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!contextMenu.contains(e.target) && e.target !== element) {
          contextMenu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);
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
  // Clear group context and set DM context
  currentChatPubkey = pubkey;
  currentGroupId = null;
  
  // Also clear group context in group message manager
  if (window.groupMessageManager) {
    window.groupMessageManager.currentGroupId = null;
  }

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
  
  // Filter out any group messages that might have gotten mixed in
  const dmMessages = messages.filter(msg => !msg.groupId && msg.type === 'dm');
  
  // Sort messages by timestamp
  const sortedMessages = dmMessages.sort((a, b) => a.created_at - b.created_at);
  
  // Create a document fragment for better performance
  const fragment = document.createDocumentFragment();
  
  for (const message of sortedMessages) {
    const messageElement = document.createElement('div');
    const isSent = message.pubkey === currentUser?.pubkey;
    messageElement.className = `message ${isSent ? 'sent' : 'received'}`;
    messageElement.setAttribute('data-message-id', message.id);
    messageElement.setAttribute('data-pubkey', message.pubkey);
    messageElement.setAttribute('data-timestamp', message.created_at);
    messageElement.setAttribute('data-type', 'dm');
    
    const bubbleElement = document.createElement('div');
    bubbleElement.className = 'message-bubble';
    
    // Render message content (text, media, etc)
    await renderMessageContent(message, bubbleElement);
    
    messageElement.appendChild(bubbleElement);
    fragment.appendChild(messageElement);
  }
  
  messageList.appendChild(fragment);
  
  // Process link previews for all messages
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
         class="${contact.isGroup ? 'group-avatar' : 'contact-avatar'}">
    <div class="${contact.isGroup ? 'group-header-info' : 'contact-info'}">
      <span class="${contact.isGroup ? 'group-header-name' : 'contact-name'}">${contact.displayName}</span>
      ${contact.isGroup 
        ? `<span class="group-header-members">${contact.members?.length || 0} members</span>`
        : contact.isChannel && contact.about 
          ? `<span class="contact-status">${contact.about}</span>`
          : ''}
    </div>
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
  
  if (!content) return;
  
  try {
    const selectedContact = document.querySelector('.contact-item.selected');
    if (!selectedContact) {
      throw new Error('No chat selected');
    }

    const isGroup = selectedContact.classList.contains('group');
    const targetId = selectedContact.dataset.pubkey;

    // Store content and clear input immediately
    messageInput.value = '';

    if (isGroup) {
      // Use the stored groupId for sending group messages
      if (!currentGroupId) {
        throw new Error('No group context found');
      }
      await sendGroupMessage(currentGroupId, content);
      return;
    }

    // DM handling only from here
    const message = await messageManager.sendMessage(targetId, content);
    if (!message) {
      throw new Error('Failed to send DM');
      messageInput.value = content; // Restore content if failed
      return;
    }

    const messageList = document.querySelector('.message-list');
    if (messageList) {
      const messageElement = document.createElement('div');
      messageElement.className = 'message sent';  // No group-message class for DMs
      messageElement.setAttribute('data-message-id', message.id);
      messageElement.setAttribute('data-pubkey', message.pubkey);
      messageElement.setAttribute('data-timestamp', Math.floor(Date.now() / 1000));
      messageElement.setAttribute('data-type', 'dm');  // Explicitly mark as DM
      messageElement.setAttribute('data-recipient', targetId);  // Add recipient for DMs

      const bubbleElement = document.createElement('div');
      bubbleElement.className = 'message-bubble';

      await renderMessageContent({ 
        content: content,
        pubkey: (await auth.getCurrentUser()).pubkey,
        recipientPubkey: targetId,
        type: 'dm'
      }, bubbleElement);

      messageElement.appendChild(bubbleElement);
      messageList.appendChild(messageElement);

      // Process link previews for the new message
      await loadLinkPreviews();
    }
  } catch (error) {
    console.error('Error sending message:', error);
    showErrorMessage('Failed to send message: ' + error.message);
    // Restore the message input if sending failed
    messageInput.value = content;
  }
}

/**
 * Sends a message to a group chat
 * @param {string} groupId - The ID of the group to send the message to
 */
async function sendGroupMessage(groupId, content) {
  if (!content) return;
  
  const messageInput = document.getElementById('messageInput');
  
  try {
    // Send the message through the group message manager
    const message = await window.groupMessageManager.sendGroupMessage(groupId, content);
    
    // Add message to UI immediately
    const messageList = document.querySelector('.message-list');
    if (messageList) {
      const messageElement = document.createElement('div');
      messageElement.className = 'message group-message sent';
      messageElement.setAttribute('data-message-id', message.id);
      messageElement.setAttribute('data-pubkey', message.pubkey);
      messageElement.setAttribute('data-group-id', groupId);
      messageElement.setAttribute('data-type', 'group');
      messageElement.setAttribute('data-timestamp', message.created_at);

      const bubbleElement = document.createElement('div');
      bubbleElement.className = 'message-bubble';

      // Check for GIF/media content first
      const gifMatch = content.match(/https:\/\/[^\s]+\.(gif|giphy\.com|tenor\.com|media\.nostr\.build|image\.nostr\.build|cdn\.azzamo\.net|instagram\.com|tiktok\.com)[^\s]*/i);
      
      if (gifMatch) {
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
          textDiv.innerHTML = linkifyText(remainingText);
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
        textContent.innerHTML = linkifyText(content);
        bubbleElement.appendChild(textContent);
      }

      messageElement.appendChild(bubbleElement);
      messageList.appendChild(messageElement);

      // Process other link previews if not a GIF/media
      if (!gifMatch && typeof loadLinkPreviews === 'function') {
        await loadLinkPreviews();
      }
    }
  } catch (error) {
    console.error('Error sending group message:', error);
    showErrorMessage('Failed to send message');
    messageInput.value = content; // Restore content if failed
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
    bubbleElement.innerHTML = '<div class="message-text error">Message could not be decrypted</div>';
    return;
  }

  // Strict message type validation
  if (!message.type) {
    if (message.groupId) {
      message.type = 'group';
    } else if (message.recipientPubkey) {
      message.type = 'dm';
    } else {
      return;
    }
  }

  // Validate message type matches context
  if ((message.type === 'dm' && message.groupId) || 
      (message.type === 'group' && !message.groupId)) {
    return;
  }

  // Extract URLs from the content
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = content.match(urlRegex);
  
  if (urls) {
    // Check each URL for GIFs or media
    for (const url of urls) {
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.match(/\.(gif|giphy\.com|tenor\.com)/i) ||
          decodedUrl.includes('image.nostr.build') || 
          decodedUrl.includes('cdn.azzamo.net')) {
        
        // Extract the base URL without query parameters and clean it
        const baseUrl = decodedUrl.split('#')[0].split('?')[0];
        // Remove any trailing punctuation or text
        const cleanUrl = baseUrl.replace(/[.,!?]$/, '');
        
        // Split content into parts around the URL
        const parts = content.split(url);
        
        // Build the message content with text and media
        let messageHtml = '';
        
        // Add text before media if exists and it's not a media URL
        const textBefore = parts[0].trim();
        if (textBefore && !textBefore.match(/https?:\/\/(media[0-9]*\.)?/)) {
          messageHtml += `<div class="message-text">${linkifyText(textBefore)}</div>`;
        }
        
        // Add the media
        messageHtml += `
          <div class="media-container">
            <img src="${cleanUrl}" class="message-media" loading="lazy" alt="Media content" onerror="this.style.display='none'">
          </div>`;
        
        // Add text after media if exists and it's not a media URL
        const remainingText = parts.slice(1).join(url).trim();
        if (remainingText && !remainingText.match(/https?:\/\/(media[0-9]*\.)?/)) {
          messageHtml += `<div class="message-text">${linkifyText(remainingText)}</div>`;
        }
        
        bubbleElement.innerHTML = messageHtml;

        // Add zap container for received messages
        if (message.pubkey !== currentUser?.pubkey) {
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
        return;
      }
    }
  }

  // Regular text message
  bubbleElement.innerHTML = `<div class="message-text">${linkifyText(content)}</div>`;

  // Add zap container for received messages
  if (message.pubkey !== currentUser?.pubkey) {
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
      // Add space before GIF URL if there's existing text
      const currentText = messageInput.value;
      messageInput.value = currentText + (currentText && !currentText.endsWith(' ') ? ' ' : '') + cleanUrl;
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
           content.match(/(?:nostr:)?(?:note|nevent|npub|nprofile|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+/) ||
           content.includes('media.nostr.build') ||
           content.includes('image.nostr.build') ||
           content.includes('cdn.azzamo.net');
  });

  for (const link of mediaLinks) {
    try {
      if (link.nextElementSibling?.classList.contains('link-preview')) continue;

      const url = link.href;
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
      }

      if (previewContent.innerHTML) {
        previewContainer.appendChild(previewContent);
        link.parentNode.insertBefore(previewContainer, link.nextSibling);
      }
    } catch (error) {
      continue;
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
              content: message.type === 'group' ? "Zapped a group message" : "Zapped a DM",
              tags: [
                ['p', message.pubkey],
                ['e', message.id],
                ['amount', amount.toString()],
                ['relays', ...RELAYS],
                // Add group context if it's a group message
                ...(message.type === 'group' && message.groupId ? [['e', message.groupId, '', 'root']] : [])
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
        
        // Show success message
        showErrorMessage(`Zap invoice created for ${amount} sats! Scan the QR code to pay.`, 'success');
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
  
  modal.innerHTML = `
    <div class="qr-modal-content">
      <div class="qr-container">
        <div id="qrcode-container"></div>
        <div class="invoice-text">${invoice}</div>
        <div class="modal-buttons">
          <button class="copy-button">Copy</button>
          <button class="close-button">Close</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);

  // Use the global qrcode object
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
        copyButton.textContent = 'Copy';
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
      const currentAmount = parseInt(zapAmount.textContent) || 0;
      const newAmount = currentAmount + parseInt(amount);
      zapAmount.textContent = newAmount;
      
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

// Add function to show profile modal
async function showProfileModal(pubkey, metadata) {
  const npub = pubkeyToNpub(pubkey);
  
  const modal = document.createElement('div');
  modal.className = 'modal profile-modal';
  
  modal.innerHTML = `
    <div class="modal-content profile-modal-content">
      <div class="profile-header">
        <img src="${metadata.picture || '/icons/default-avatar.png'}" alt="Profile" class="profile-avatar">
        <h3>${metadata.name || metadata.displayName || 'Anonymous'}</h3>
      </div>
      <div class="profile-details">
        <div class="profile-field">
          <label>Npub</label>
          <div class="copyable-field">
            <input type="text" readonly value="${npub}">
            <button class="copy-button" data-value="${npub}" title="Copy">📋</button>
          </div>
        </div>
        ${metadata.nip05 ? `
          <div class="profile-field">
            <label>NIP-05</label>
            <div class="copyable-field">
              <input type="text" readonly value="${metadata.nip05}">
              <button class="copy-button" data-value="${metadata.nip05}" title="Copy">📋</button>
            </div>
          </div>
        ` : ''}
        ${metadata.lud16 ? `
          <div class="profile-field">
            <label>Lightning Address</label>
            <div class="copyable-field">
              <input type="text" readonly value="${metadata.lud16}">
              <button class="copy-button" data-value="${metadata.lud16}" title="Copy">📋</button>
            </div>
          </div>
        ` : ''}
        ${metadata.about ? `
          <div class="profile-field">
            <label>About</label>
            <div class="about-text">${metadata.about}</div>
          </div>
        ` : ''}
      </div>
      <div class="modal-buttons">
        <button class="copy-button">Copy</button>
        <button class="close-button">Close</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);

  // Add copy functionality
  const copyButtons = modal.querySelectorAll('.copy-button');
  copyButtons.forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.value);
        button.textContent = '✓';
        button.classList.add('copied');
        setTimeout(() => {
          button.textContent = '📋';
          button.classList.remove('copied');
        }, 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
        showErrorMessage('Failed to copy to clipboard');
      }
    });
  });

  // Add close functionality
  const closeButton = modal.querySelector('.close-button');
  closeButton.addEventListener('click', () => {
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

async function initializeGroupChat(groupId) {
  // Set the current group ID and clear DM context
  currentGroupId = groupId;
  currentChatPubkey = null;
  
  // Also set group context in group message manager
  if (window.groupMessageManager) {
    window.groupMessageManager.currentGroupId = groupId;
  }

  const chatContainer = document.getElementById('chatContainer');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const emojiButton = document.getElementById('emojiButton');
  const gifButton = document.getElementById('gifButton');

  // Clear existing chat and show loading spinner
  chatContainer.innerHTML = `
    <div class="message-container">
      <div class="message-list">
        <div class="chat-loading-spinner">
          <div class="spinner"></div>
        </div>
      </div>
    </div>
  `;

  // Get group info
  const group = groupContactManager.groups.get(groupId);
  if (!group) {
    console.error('Group not found:', groupId);
    return;
  }

  // Update header
  const chatHeader = document.getElementById('chatHeader');
  chatHeader.innerHTML = `
    <div class="group-header">
      <img src="${(group.picture || '').trim() || 'icons/default-group.png'}" 
           alt="${group.name || 'Group'}" 
           onerror="this.src='icons/default-group.png'" 
           class="group-avatar">
      <div class="group-header-info">
        <div class="group-header-name">${group.name || 'Unnamed Group'}</div>
        <div class="group-header-members">${group.members?.length || 0} members</div>
      </div>
    </div>
  `;

  // Fetch and render messages
  const messages = await groupMessageManager.fetchGroupMessages(groupId);
  if (messages && messages.length > 0) {
    // Update last message time for the group
    const lastMessage = messages.reduce((latest, msg) => 
      msg.created_at > latest.created_at ? msg : latest
    );
    
    group.lastMessage = lastMessage;
    await renderGroupMessages(messages, groupId);
  } else {
    chatContainer.querySelector('.message-list').innerHTML = '<div class="no-messages">No messages yet</div>';
  }

  // Enable input for group chat
  messageInput.disabled = false;
  sendButton.disabled = false;
  emojiButton.disabled = false;
  gifButton.disabled = false;

  // Add message handlers
  messageInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const content = messageInput.value.trim();
      if (content) {
        await sendGroupMessage(currentGroupId, content);
      }
    }
  });

  sendButton.addEventListener('click', async () => {
    const content = messageInput.value.trim();
    if (content) {
      await sendGroupMessage(currentGroupId, content);
    }
  });
  
  // Initialize emoji picker and GIF button
  if (emojiButton && messageInput) {
    initializeEmojiPicker(emojiButton, messageInput);
  }
  initializeGifButton();
}

async function renderGroupMessages(messages, groupId) {
  const chatContainer = document.getElementById('chatContainer');
  const messageList = chatContainer.querySelector('.message-list');
  messageList.innerHTML = '';

  const currentUser = await auth.getCurrentUser();
  if (!currentUser) return;

  // Filter messages for this specific group and deduplicate by message ID
  const uniqueMessages = messages.reduce((acc, msg) => {
    if (msg.groupId === groupId && !acc.find(m => m.id === msg.id)) {
      acc.push(msg);
    }
    return acc;
  }, []);
  
  const sortedMessages = [...uniqueMessages].sort((a, b) => a.created_at - b.created_at);
  
  // Create a document fragment for better performance
  const fragment = document.createDocumentFragment();
  
  for (const message of sortedMessages) {
    const messageElement = document.createElement('div');
    const isSent = message.pubkey === currentUser.pubkey;
    messageElement.className = `message group-message ${isSent ? 'sent' : 'received'}`;
    messageElement.setAttribute('data-message-id', message.id);
    messageElement.setAttribute('data-pubkey', message.pubkey);
    messageElement.setAttribute('data-group-id', groupId);
    messageElement.setAttribute('data-timestamp', message.created_at);
    messageElement.setAttribute('data-type', 'group');  // Explicitly mark as group message
    
    // Add author name only for received messages
    if (!isSent) {
      const authorMetadata = await getUserMetadata(message.pubkey);
      const authorName = authorMetadata?.name || authorMetadata?.displayName || shortenIdentifier(message.pubkey);
      const authorDiv = document.createElement('div');
      authorDiv.className = 'group-message-author';
      authorDiv.textContent = authorName;
      messageElement.appendChild(authorDiv);

      // Remove the zap container addition here since it's added in renderMessageContent
    }
    
    const bubbleElement = document.createElement('div');
    bubbleElement.className = 'message-bubble';
    
    // Use renderMessageContent for consistent rendering
    await renderMessageContent({ 
      content: message.content,
      pubkey: message.pubkey,
      groupId: groupId,
      type: 'group',  // Explicitly mark as group message
      zapAmount: message.zapAmount  // Pass zap amount to renderMessageContent
    }, bubbleElement);
    
    messageElement.appendChild(bubbleElement);
    fragment.appendChild(messageElement);
  }

  // Append all messages at once
  messageList.appendChild(fragment);

  // Process link previews for all messages after rendering
  await loadLinkPreviews();
}

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

async function initializeApp() {
  try {
    await auth.init();
    const currentUser = await auth.getCurrentUser();
    
    if (currentUser) {
      // Initialize contacts
      const contacts = await contactManager.init(currentUser.pubkey);
      
      // Initialize groups
      if (window.groupContactManager) {
        await window.groupContactManager.init();
      } else {
        console.error('groupContactManager not initialized');
      }

      // Render contacts and groups
      await renderContactList(contacts);
      
      hideLoadingIndicator();
      hideLoginScreen();
    } else {
      showLoginScreen();
    }
  } catch (error) {
    console.error('Initialization error:', error);
    showErrorMessage('Failed to initialize app');
  }
}

// Add these functions at the appropriate location in popup.js
async function showGroupInfoModal(group) {
  console.log('Opening info modal for group:', group);
  const modal = document.createElement('div');
  modal.className = 'modal group-modal';
  
  const name = group.name || group.displayName || 'Unnamed Group';
  const picture = group.picture || group.avatarUrl || 'icons/default-group.png';
  const about = group.about || '';
  const memberCount = Array.isArray(group.members) ? group.members.length : 0;
  const createdDate = group.created_at ? new Date(group.created_at * 1000).toLocaleString() : 'Unknown';
  const npub = window.NostrTools.nip19.npubEncode(group.id);
  
  modal.innerHTML = `
    <div class="modal-content profile-modal-content">
      <div class="profile-header">
        <img src="${picture}" alt="${name}" class="profile-avatar">
        <h3>${name}</h3>
        ${about ? `<p class="group-about">${about}</p>` : ''}
      </div>
      <div class="profile-details">
        <div class="profile-field">
          <label>Group ID</label>
          <div class="copyable-field">
            <input type="text" readonly value="${npub}">
            <button class="copy-button" data-value="${npub}" title="Copy">📋</button>
          </div>
        </div>
        <div class="profile-field">
          <label>Created</label>
          <div class="group-about">${createdDate}</div>
        </div>
        <div class="profile-field">
          <label>Members (${memberCount})</label>
          <div class="group-members-list">
            ${await Promise.all(group.members.map(async (member) => {
              const metadata = await getUserMetadata(member);
              const isCreator = member.toLowerCase() === group.creator?.toLowerCase();
              return `
                <div class="group-${isCreator ? 'creator' : 'member'}">
                  <img src="${metadata?.picture || 'icons/default-avatar.png'}" 
                       alt="${metadata?.name || 'Member'}" 
                       class="member-avatar">
                  <span>${metadata?.name || metadata?.displayName || shortenIdentifier(member)}</span>
                  ${isCreator ? '<span class="creator-badge">👑 Creator</span>' : ''}
                </div>
              `;
            })).then(members => members.join(''))}
          </div>
        </div>
      </div>
      <div class="modal-buttons">
        <button class="copy-button">Copy</button>
        <button class="close-button">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  // Add copy functionality
  const copyButtons = modal.querySelectorAll('.copy-button');
  copyButtons.forEach(button => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.value);
        const originalText = button.textContent;
        button.textContent = '✓';
        button.classList.add('copied');
        setTimeout(() => {
          button.textContent = '📋';
          button.classList.remove('copied');
        }, 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
        showErrorMessage('Failed to copy to clipboard');
      }
    });
  });
  
  const closeBtn = modal.querySelector('.close-button');
  closeBtn.onclick = () => modal.remove();
  
  window.onclick = (event) => {
    if (event.target === modal) {
      modal.remove();
    }
  };
}

async function showGroupEditModal(group) {
  console.log('Opening edit modal for group:', group);
  const modal = document.createElement('div');
  modal.className = 'modal group-modal';
  
  const name = group.name || group.displayName || '';
  const picture = group.picture || group.avatarUrl || '';
  const about = group.about || '';
  
  modal.innerHTML = `
    <div class="modal-content profile-modal-content">
      <div class="profile-header">
        <img src="${picture || 'icons/default-group.png'}" alt="${name}" class="profile-avatar">
        <h3>Edit Group</h3>
      </div>
      <form id="edit-group-form" class="profile-details">
        <div class="profile-field">
          <label for="group-name">Name</label>
          <div class="copyable-field">
            <input type="text" id="group-name" value="${name}" required>
          </div>
        </div>
        <div class="profile-field">
          <label for="group-about">About</label>
          <div class="copyable-field">
            <textarea id="group-about" rows="3">${about}</textarea>
          </div>
        </div>
        <div class="profile-field">
          <label for="group-picture">Picture URL</label>
          <div class="copyable-field">
            <input type="url" id="group-picture" value="${picture}">
          </div>
        </div>
        <div class="modal-buttons">
          <button type="button" class="close-button">Cancel</button>
          <button type="submit" class="primary-button">Save Changes</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
  
  const form = modal.querySelector('#edit-group-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const newName = form.querySelector('#group-name').value;
    const newAbout = form.querySelector('#group-about').value;
    const newPicture = form.querySelector('#group-picture').value;
    
    try {
      const event = {
        kind: 41,
        content: JSON.stringify({ 
          name: newName, 
          about: newAbout, 
          picture: newPicture,
          updated_at: Math.floor(Date.now() / 1000)
        }),
        tags: [
          ['e', group.id],
          ...group.members.map(m => ['p', m])
        ]
      };
      
      await window.pool.publish(event);
      modal.remove();
    } catch (error) {
      console.error('Error updating group:', error);
      alert('Failed to update group');
    }
  };
  
  const closeBtn = modal.querySelector('.close-button');
  closeBtn.onclick = () => modal.remove();
  
  window.onclick = (event) => {
    if (event.target === modal) {
      modal.remove();
    }
  };
}

async function leaveGroup(groupId) {
  try {
    const group = window.groupContactManager.groups.get(groupId);
    if (!group) {
      console.error('Group not found:', groupId);
      return;
    }

    const currentUser = await window.auth.getCurrentUser();
    if (!currentUser?.pubkey) {
      console.error('User not authenticated');
      return;
    }

    // Check if we have connected relays
    const relays = window.relayPool.getConnectedRelays();
    if (!relays || relays.length === 0) {
      console.error('No connected relays');
      return;
    }

    // Create leave event
    const event = {
      kind: 41,
      pubkey: currentUser.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', groupId], // Reference to the group
        ['p', currentUser.pubkey], // Reference to self
        ['client', 'tides']
      ],
      content: JSON.stringify({
        action: 'leave',
        updated_at: Math.floor(Date.now() / 1000)
      })
    };

    // Sign the event
    event.id = nostrCore.getEventHash(event);
    if (currentUser.type === 'NIP-07') {
      event.sig = await window.nostr.signEvent(event);
    } else {
      event.sig = nostrCore.getSignature(event, currentUser.privkey);
    }

    console.log('Publishing leave event:', event);

    // Publish to all connected relays
    try {
      await Promise.race([
        window.groupContactManager.pool.publish(relays, event),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Publish timeout')), 5000))
      ]);
      console.log('Leave event published successfully');

      // Add to leftGroups set and remove from groups map
      window.groupContactManager.leftGroups.add(groupId);
      window.groupContactManager.groups.delete(groupId);

      // Clear chat if it's the current group
      const currentChat = document.querySelector('.chat-container');
      if (currentChat && currentChat.dataset.id === groupId) {
        clearChat();
      }

      // Remove any open modals
      document.querySelectorAll('.leave-group-modal').forEach(modal => modal.remove());
      document.querySelectorAll('.modal').forEach(modal => modal.remove());

      // Update only the groups section
      const groupContent = document.getElementById('groupsContent');
      if (groupContent) {
        // Clear existing content
        groupContent.innerHTML = '';

        // Add create group button
        const createGroupButton = document.createElement('button');
        createGroupButton.className = 'create-group-button';
        createGroupButton.innerHTML = '<span>Create New Group</span>';
        groupContent.appendChild(createGroupButton);

        // Initialize the create group button
        initializeCreateGroupButton();

        // Add remaining groups
        if (window.groupContactManager) {
          const userGroups = Array.from(window.groupContactManager.groups.values())
            .filter(group => !window.groupContactManager.leftGroups.has(group.id))
            .sort((a, b) => {
              const timeA = a.lastMessage?.created_at || a.created_at;
              const timeB = b.lastMessage?.created_at || b.created_at;
              return timeB - timeA;
            });

          if (userGroups && userGroups.length > 0) {
            userGroups.forEach(group => {
              const groupElement = createContactElement({
                pubkey: group.id,
                id: group.id,
                displayName: group.name || 'Unnamed Group',
                avatarUrl: (group.picture || '').trim() || 'icons/default-group.png',
                about: group.about || '',
                created_at: group.created_at,
                isGroup: true,
                members: group.members || [],
                creator: group.creator,
                name: group.name || 'Unnamed Group',
                picture: (group.picture || '').trim() || 'icons/default-group.png'
              });
              groupContent.appendChild(groupElement);
            });
          } else {
            const noGroupsMessage = document.createElement('div');
            noGroupsMessage.className = 'no-groups-message';
            noGroupsMessage.textContent = 'No groups yet';
            groupContent.appendChild(noGroupsMessage);
          }
        }
    }

    showErrorMessage('Successfully left the group', 'success');
    return true;
    } catch (error) {
      console.error('Error publishing leave event:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error leaving group:', error);
    throw error;
  }
}

async function showLeaveGroupModal(group) {
  const modal = document.createElement('div');
  modal.className = 'leave-group-modal';
  
  modal.innerHTML = `
    <div class="leave-group-modal-content">
      <div class="leave-group-header">
        <img src="${group.picture || 'icons/default-group.png'}" alt="${group.name || 'Group'}" class="profile-avatar">
        <h3>Leave Group</h3>
      </div>
      <p>Are you sure you want to leave "${group.name || 'this group'}"?</p>
      <div class="leave-group-buttons">
        <button class="cancel-button">Cancel</button>
        <button class="confirm-button">Leave Group</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  
  const confirmBtn = modal.querySelector('.confirm-button');
  const cancelBtn = modal.querySelector('.cancel-button');
  
  confirmBtn.onclick = async () => {
    try {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Leaving...';
      await leaveGroup(group.id);
      modal.remove(); // Explicitly remove modal after successful leave
    } catch (error) {
      console.error('Failed to leave group:', error);
      showErrorMessage('Failed to leave group: ' + error.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Leave Group';
    }
  };
  
  cancelBtn.onclick = () => modal.remove();
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Remove the standalone event listener
document.querySelector('.create-group-button')?.addEventListener('click', () => {
  // ... remove this entire block ...
});

// Remove the delegated event listener
document.addEventListener('DOMContentLoaded', () => {
  // ... remove this entire block ...
});

// Update the initializeCreateGroupButton function to handle multiple initializations
function initializeCreateGroupButton() {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCreateGroupButton);
    return;
  }

  // Find the button
  const createGroupButton = document.querySelector('.create-group-button');
  if (!createGroupButton) {
    // Button not found, try again in a moment as it might be added dynamically
    setTimeout(initializeCreateGroupButton, 500);
    return;
  }

  // Remove any existing click listeners to prevent duplicates
  const newButton = createGroupButton.cloneNode(true);
  createGroupButton.parentNode.replaceChild(newButton, createGroupButton);

  newButton.addEventListener('click', () => {
    showCreateGroupModal();
  });
}

function showCreateGroupModal() {
    const modal = document.createElement('div');
    modal.className = 'create-group-modal';
    
    modal.innerHTML = `
      <div class="create-group-modal-content">
        <div class="create-group-header">
        <img src="icons/default-group.png" alt="Group" class="profile-avatar">
          <h3>Create New Group</h3>
        </div>
      <form id="create-group-form">
          <div class="create-group-field">
          <label for="group-name">Group Name</label>
              <input type="text" id="group-name" required>
          </div>
          <div class="create-group-field">
          <label for="group-about">Description</label>
              <textarea id="group-about" rows="3"></textarea>
          </div>
          <div class="create-group-field">
          <label for="group-picture">Picture URL (optional)</label>
              <input type="url" id="group-picture">
          </div>
          <div class="create-group-buttons">
            <button type="button" class="cancel-button">Cancel</button>
            <button type="submit" class="submit-button">Create Group</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    
    const form = modal.querySelector('#create-group-form');
    const submitBtn = modal.querySelector('.submit-button');
  const cancelBtn = modal.querySelector('.cancel-button');
    
    form.onsubmit = async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';
      
    const name = modal.querySelector('#group-name').value;
    const about = modal.querySelector('#group-about').value;
    const picture = modal.querySelector('#group-picture').value;
    
    try {
      await handleCreateGroup(name, about, picture);
      modal.remove();
    } catch (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Group';
    }
  };
  
  cancelBtn.onclick = () => modal.remove();
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

async function handleCreateGroup(name, about, picture) {
  try {
    const group = await window.groupContactManager.createGroup(name, about, [], picture);
    console.log('Group created:', group);

    // Close any open modals
    document.querySelectorAll('.create-group-modal').forEach(modal => modal.remove());

    // Update only the groups section
    const groupContent = document.getElementById('groupsContent');
    if (groupContent) {
      // Clear existing content
      groupContent.innerHTML = '';

      // Add create group button
      const createGroupButton = document.createElement('button');
      createGroupButton.className = 'create-group-button';
      createGroupButton.innerHTML = '<span>Create New Group</span>';
      groupContent.appendChild(createGroupButton);

      // Initialize the create group button
      initializeCreateGroupButton();

      // Add all groups including the new one
      if (window.groupContactManager) {
        const userGroups = Array.from(window.groupContactManager.groups.values())
          .filter(group => !window.groupContactManager.leftGroups.has(group.id))
          .sort((a, b) => {
            const timeA = a.lastMessage?.created_at || a.created_at;
            const timeB = b.lastMessage?.created_at || b.created_at;
            return timeB - timeA;
          });

        if (userGroups && userGroups.length > 0) {
          userGroups.forEach(group => {
            const groupElement = createContactElement({
              pubkey: group.id,
              id: group.id,
              displayName: group.name || 'Unnamed Group',
              avatarUrl: (group.picture || '').trim() || 'icons/default-group.png',
              about: group.about || '',
              created_at: group.created_at,
              isGroup: true,
              members: group.members || [],
              creator: group.creator,
              name: group.name || 'Unnamed Group',
              picture: (group.picture || '').trim() || 'icons/default-group.png'
            });
            groupContent.appendChild(groupElement);
          });
        }
      }
    }

    showErrorMessage('Group created successfully', 'success');
    return group;
  } catch (error) {
    console.error('Error creating group:', error);
    showErrorMessage('Failed to create group: ' + error.message);
    throw error;
  }
}

// Update search functionality
function initializeSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearch');

  if (!searchInput || !clearSearch) return;

  function performSearch(query) {
    query = query.toLowerCase().trim();
    
    // Get all contact elements
    const contactElements = document.querySelectorAll('.contact-item');
    
    contactElements.forEach(element => {
      const name = element.querySelector('.contact-name')?.textContent?.toLowerCase() || '';
      const about = element.querySelector('.contact-about')?.textContent?.toLowerCase() || '';
      const isMatch = name.includes(query) || about.includes(query);
      
      // Show/hide based on match
      element.style.display = isMatch || query === '' ? '' : 'none';
    });

    // Show/hide section headers based on visible contacts
    document.querySelectorAll('.contact-section').forEach(section => {
      const visibleContacts = section.querySelectorAll('.contact-item:not([style*="display: none"])').length;
      const hasCreateButton = section.querySelector('.create-group-button') !== null;
      section.style.display = visibleContacts > 0 || hasCreateButton ? '' : 'none';
    });
  }

  searchInput.addEventListener('input', (e) => {
    performSearch(e.target.value);
    clearSearch.style.display = e.target.value ? 'flex' : 'none';
  });

  clearSearch.addEventListener('click', () => {
    searchInput.value = '';
    performSearch('');
    clearSearch.style.display = 'none';
  });
}

// Initialize search when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeSearch);

function clearChat() {
  const chatContainer = document.querySelector('.chat-container');
  const chatHeader = document.querySelector('.chat-header');
  const messageInput = document.getElementById('messageInput');
  
  if (chatContainer) {
    chatContainer.innerHTML = '<div class="no-chat-selected">Select a contact to start chatting</div>';
    chatContainer.removeAttribute('data-id');
  }
  if (chatHeader) {
    chatHeader.innerHTML = '';
  }
  if (messageInput) {
    messageInput.value = '';
  }
}

async function switchToChat(contact) {
  try {
    // Clear existing chat and input
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
      messageInput.value = '';
    }
    
    // ... rest of the existing switchToChat function ...
    } catch (error) {
    console.error('Error switching chat:', error);
    showErrorMessage('Failed to switch chat: ' + error.message);
  }
}

async function handleMessageSend(event) {
  event.preventDefault();
  const messageInput = document.getElementById('messageInput');
  const content = messageInput.value.trim();
  if (!content) return;

  const chatContainer = document.querySelector('.chat-container');
  const groupId = chatContainer?.dataset?.id;
  
  try {
    let message;
    if (groupId) {
      message = await window.groupMessageManager.sendMessage(content, groupId);
      // Add groupId to message object for preview processing
      message.groupId = groupId;
    } else {
      const currentChatId = chatContainer?.dataset?.pubkey;
      if (!currentChatId) return;
      message = await window.messageManager.sendMessage(content, currentChatId);
    }

    if (message) {
      // Clear input immediately
      messageInput.value = '';
      
      // Create message element with preview support
      const messageElement = await createMessageElement(message, true);
      
      // Add to message list first
      const messageList = document.querySelector('.message-list');
      if (messageList) {
        messageList.insertBefore(messageElement, messageList.firstChild);
      }

      // Process previews for all messages (both group and DM)
      if (messageElement) {
        const previewContainer = messageElement.querySelector('.message-preview');
        if (previewContainer) {
          // Process different types of content
          if (content.includes('youtube.com') || content.includes('youtu.be')) {
            await processYouTubePreview(content, previewContainer);
          } else if (content.includes('npub1') || content.includes('note1')) {
            await processNostrPreview(content, previewContainer);
          } else if (content.includes('twitter.com') || content.includes('x.com')) {
            await processTweetPreview(content, previewContainer);
          } else if (content.match(/\.(gif|jpe?g|png|webp)$/i)) {
            await processImagePreview(content, previewContainer);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error sending message:', error);
    showErrorMessage('Failed to send message: ' + error.message);
  }
}

async function createMessageElement(message, isNew = false) {
  const messageElement = document.createElement('div');
  messageElement.className = `message ${message.isSent ? 'sent' : 'received'}`;
  
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  
  // Add preview container for potential previews
  const previewContainer = document.createElement('div');
  previewContainer.className = 'message-preview';
  
  const textContainer = document.createElement('div');
  textContainer.className = 'message-text';
  textContainer.textContent = message.content;
  
  bubble.appendChild(previewContainer);
  bubble.appendChild(textContainer);
  messageElement.appendChild(bubble);
  
  return messageElement;
}

// Update the zap handling listener
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ZAP_RECEIVED') {
    const { messageId, amount, zapperPubkey, timestamp } = message.data;
    handleReceivedZap(messageId, amount, zapperPubkey, timestamp);
  }
  return true;
});

async function handleReceivedZap(messageId, amount, zapperPubkey, timestamp) {
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageElement) {
    const zapAmount = messageElement.querySelector('.zap-amount');
    const zapButton = messageElement.querySelector('.zap-button');
    
    if (zapAmount) {
      // Update the zap amount
      const currentAmount = parseInt(zapAmount.textContent) || 0;
      const newAmount = currentAmount + parseInt(amount);
      zapAmount.textContent = newAmount;
      
      // Add visual feedback if there's a zap button
      if (zapButton) {
        zapButton.classList.add('zap-received');
        setTimeout(() => {
          zapButton.classList.remove('zap-received');
        }, 500);
      }

      // Show a notification
      const metadata = await getUserMetadata(zapperPubkey);
      const zapperName = metadata?.name || metadata?.displayName || shortenIdentifier(zapperPubkey);
      showErrorMessage(`Received ${amount} sats zap from ${zapperName}!`, 'success');

      // Play a sound
      if (soundManager) {
        soundManager.play('message');
      }
    }
  }
}

