// CRITICAL TEST: Check if popup.js is actually running
window.popupJsLoaded = true;
// Startup markers (kept minimal)

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
// Giphy service is loaded via script tag as giphyService global
import { RELAYS } from './shared.js';
// qrcode is loaded via script tag in popup.html
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
let isModalOpen = false; // Prevent multiple modals from opening

// Cleanup: removed leftover test hook to speed startup

function showCreateGroupModal() {
  console.log('🚀 showCreateGroupModal FUNCTION STARTED');
  
  // Prevent multiple modals from opening simultaneously
  if (isModalOpen) {
    console.log('🔒 Modal already open, ignoring duplicate call');
    return;
  }
  
  isModalOpen = true;
  console.log('🔓 Opening create group modal');
  
  console.log('🚀 Creating modal element...');
  const modal = document.createElement('div');
  modal.className = 'create-group-modal';
  
  console.log('🚀 Modal element created:', modal);
  console.log('🚀 Modal class:', modal.className);
  
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
      isModalOpen = false;
      console.log('🔓 Modal closed after successful group creation, flag reset');
    } catch (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Group';
      // Don't reset flag on error - let user try again
    }
  };
  
  cancelBtn.onclick = () => {
    modal.remove();
    isModalOpen = false;
    console.log('🔓 Modal closed, flag reset');
  };
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      isModalOpen = false;
      console.log('🔓 Modal closed by background click, flag reset');
    }
  });
}

async function handleCreateGroup(name, about, picture) {
  
  try {
    console.log('🔍 About to call window.groupContactManager.createGroup...');
    if (!window.groupContactManager || typeof window.groupContactManager.createGroup !== 'function') {
      throw new Error('Group manager not ready');
    }

    const createGroupPromise = window.groupContactManager.createGroup(name, about, [], picture);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('createGroup call timed out after 10 seconds')), 10000));
    const group = await Promise.race([createGroupPromise, timeoutPromise]);
    console.log('✅ Group created successfully:', group);

    // Close any open modals
    document.querySelectorAll('.create-group-modal').forEach(modal => modal.remove());

    // Simply refresh the contact list to show the new group
    // This avoids complex DOM manipulation that could cause infinite loops
    if (window.groupContactManager) {
      const contacts = Array.from(contactManager.contacts.values());
      await renderContactList(contacts);
    }

    showErrorMessage('Group created successfully', 'success');
    return group;
  } catch (error) {
    console.error('Error creating group:', error);
    showErrorMessage('Failed to create group: ' + error.message);
    throw error;
  }
}



function initializeGifButton() {
  const gifButton = document.getElementById('gifButton');
  if (!gifButton) return;

  // Remove existing listeners
  const newGifButton = gifButton.cloneNode(true);
  if (gifButton && gifButton.parentNode) {
  gifButton.parentNode.replaceChild(newGifButton, gifButton);
  }

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
      const trending = await giphyService.getTrendingGifs();
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
            const results = await giphyService.searchGifs(query);
            renderGifs(results, gifGrid);
        } else {
            const trending = await giphyService.getTrendingGifs();
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
    renderContactList(Array.from(contactManager.contacts.values()), searchTerm);
  });

  // Add Enter key listener for login
  nsecInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      loginButton.click();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  
  // Suppress network errors for missing images to reduce console spam
  window.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG' && e.target.src) {
      // Silently handle broken image loads
      e.preventDefault();
      return false;
    }
  }, true);
  
  await loadSearchHistory();
  initializeSearchInput();
  initializeUI();
  initializeGifButton();
  // Remove premature call - button doesn't exist yet
  
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
    const contacts = await contactManager.init(user.pubkey);
    setContacts(contacts);

    // Initialize groups - wait for groupContact.js to load
    // Wait until groupContactManager is available
    let attempts = 0;
    const maxAttempts = 50; // Wait up to 5 seconds
    
    while (!window.groupContactManager && attempts < maxAttempts) {
      // retry until ready
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (window.groupContactManager) {
      console.log('✅ groupContactManager is now available!');
      await window.groupContactManager.init();
      console.log('Groups after init:', Array.from(window.groupContactManager.groups.values()));
    } else {
      console.error('❌ groupContactManager still not available after waiting');
    }

    // Render both contacts and groups
    // Use contacts from the manager to get updated message times
    await renderContactList(Array.from(contactManager.contacts.values()));

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
    avatar.src = metadata?.picture || '/icons/default-avatar.png';
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
            <img src="${metadata?.picture || '/icons/default-avatar.png'}" alt="Profile" class="profile-avatar">
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
          <!-- NWC Wallet Connect Section -->
          <div class="nwc-section">
            <h4>Wallet Connect (NWC)</h4>
            <div id="nwc-status">
              <div class="nwc-disconnected">
                <span>Not connected</span>
              </div>
            </div>
            <div class="nwc-input-section" style="display: block !important;">
              <label>NWC Connection String:</label>
              <div class="input-group">
                <input type="text" id="nwc-uri" placeholder="nostr+walletconnect://..." style="background: white !important; color: black !important; pointer-events: auto !important; user-select: text !important; -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important;" />
                <small style="color: #666; margin-top: 4px; display: block;">
                  Paste your NWC connection string from your wallet here
                </small>
              </div>
            </div>
            <div class="nwc-buttons">
              <button id="nwc-connect" class="primary-button">Connect NWC</button>
              <button id="nwc-disconnect" class="secondary-button" style="display: none;">Disconnect</button>
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

      // Add close functionality
      const closeButton = modal.querySelector('.close-button');
      closeButton.addEventListener('click', () => {
        modal.remove();
      });

      // Initialize NWC status
      await initializeNWCStatus(modal);
      
      // Add NWC functionality - ensure elements exist before adding listeners
      // Use requestAnimationFrame to ensure DOM is fully rendered
      requestAnimationFrame(() => {
        // Try multiple selectors to find the elements
        const nwcConnectBtn = modal.querySelector('#nwc-connect');
        const nwcDisconnectBtn = modal.querySelector('#nwc-disconnect');
        const nwcInputSection = modal.querySelector('.nwc-input-section') || modal.querySelector('[class*="nwc-input"]');
        const nwcUriInput = modal.querySelector('#nwc-uri') || modal.querySelector('input[placeholder*="nostr+walletconnect"]');
        
        // NWC elements discovered
        
        console.log('NWC input element:', nwcUriInput);
        console.log('NWC input section element:', nwcInputSection);
        
        // Force the input field to be editable
        if (nwcUriInput) {
          nwcUriInput.removeAttribute('readonly');
          nwcUriInput.removeAttribute('disabled');
          nwcUriInput.style.pointerEvents = 'auto';
          nwcUriInput.style.userSelect = 'text';
          nwcUriInput.style.webkitUserSelect = 'text';
          nwcUriInput.style.mozUserSelect = 'text';
          nwcUriInput.style.msUserSelect = 'text';
          nwcUriInput.style.background = 'white !important';
          nwcUriInput.style.color = 'black !important';
          nwcUriInput.style.border = '1px solid #ccc';
          // NWC input field made editable
        } else {
          console.error('NWC input field NOT FOUND!');
          // Try to find it by looking at all inputs in the modal
          const allInputs = modal.querySelectorAll('input');
          console.log('All inputs in modal:', allInputs);
          console.log('Modal HTML structure:', modal.innerHTML);
          
          // Try alternative selectors
          const alternativeInput = modal.querySelector('input[type="text"]') || 
                                  modal.querySelector('input[placeholder*="nostr"]') ||
                                  modal.querySelector('input[placeholder*="wallet"]');
          
          if (alternativeInput) {
            console.log('Found alternative input:', alternativeInput);
            alternativeInput.removeAttribute('readonly');
            alternativeInput.removeAttribute('disabled');
            alternativeInput.style.pointerEvents = 'auto';
            alternativeInput.style.userSelect = 'text';
            alternativeInput.style.background = 'white !important';
            alternativeInput.style.color = 'black !important';
            alternativeInput.style.border = '1px solid #ccc';
            console.log('Alternative input field made editable');
          }
          
          // If still not found, try a different approach - wait a bit longer
          setTimeout(() => {
            console.log('Trying delayed NWC element search...');
            const delayedInput = modal.querySelector('#nwc-uri');
            if (delayedInput) {
              console.log('Found NWC input with delay:', delayedInput);
              delayedInput.removeAttribute('readonly');
              delayedInput.removeAttribute('disabled');
              delayedInput.style.pointerEvents = 'auto';
              delayedInput.style.userSelect = 'text';
              delayedInput.style.background = 'white !important';
              delayedInput.style.color = 'black !important';
              delayedInput.style.border = '1px solid #ccc';
              // Delayed NWC input field made editable
            } else {
              console.error('NWC input still not found after delay');
            }
          }, 100);
        }
        
        // Add NWC connect handler
        nwcConnectBtn.addEventListener('click', async () => {
          console.log('NWC Connect button clicked');
          
          if (!nwcUriInput || !nwcUriInput.value.trim()) {
            showErrorMessage('Please enter an NWC connection string first');
            return;
          }
          
          const uri = nwcUriInput.value.trim();
          
          try {
            // Show connecting state
            nwcConnectBtn.textContent = 'Connecting...';
            nwcConnectBtn.disabled = true;
            
            // Send connection request to background
            const response = await chrome.runtime.sendMessage({
              type: 'NWC_CONNECT',
              data: { uri }
            });
            
            if (response.error) {
              throw new Error(response.error);
            }
            
            // Success - update status
            nwcConnectBtn.textContent = 'Connected';
            nwcConnectBtn.className = 'success-button';
            nwcConnectBtn.disabled = true;
            
            // Update status display with connection details
            const statusDiv = modal.querySelector('#nwc-status');
            if (statusDiv) {
              statusDiv.innerHTML = `
                <div class="nwc-connected">
                  <span>Connected to ${response.walletName || 'NWC Wallet'}</span>
                  <br><small>You can now use "Pay with NWC" in zap modals!</small>
                </div>
              `;
            }
            
            // Show disconnect button
            if (nwcDisconnectBtn) {
              nwcDisconnectBtn.style.display = 'inline-block';
            }
            
          } catch (error) {
            console.error('NWC connection failed:', error);
            
            // Show error state
            nwcConnectBtn.textContent = 'Error - Retry';
            nwcConnectBtn.className = 'error-button';
            nwcConnectBtn.disabled = false;
            
            // Update status display
            const statusDiv = modal.querySelector('#nwc-status');
            if (statusDiv) {
              statusDiv.innerHTML = `
                <div class="nwc-error">
                  <span>Connection failed: ${error.message}</span>
                </div>
              `;
            }
          }
        });
        
        // Add NWC disconnect handler
        nwcDisconnectBtn.addEventListener('click', async () => {
          try {
            const response = await new Promise(resolve => {
              chrome.runtime.sendMessage({ type: 'NWC_DISCONNECT' }, resolve);
            });
            if (response.ok) {
              showErrorMessage('NWC disconnected successfully', 'success');
              await initializeNWCStatus(modal);
            } else {
              showErrorMessage(response.error || 'Failed to disconnect');
            }
          } catch (error) {
            showErrorMessage('Failed to disconnect NWC');
          }
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
        }
        });
      });
    });
  }
}

async function renderContactList(contacts, filterTerm = '') {
  // renderContactList start
  const normalizedFilter = (filterTerm || '').toLowerCase().trim();
  const matchesFilter = (name = '', npub = '', about = '') => {
    if (!normalizedFilter) return true;
    return (
      (name || '').toLowerCase().includes(normalizedFilter) ||
      (npub || '').toLowerCase().includes(normalizedFilter) ||
      (about || '').toLowerCase().includes(normalizedFilter)
    );
  };
  
  // Prevent multiple simultaneous calls to avoid infinite loops
  if (window.isRenderingContactList) {
    // renderContactList already in progress; skip
    return;
  }
  
  window.isRenderingContactList = true;
  // start rendering
  
  const contactList = document.getElementById('contactList');
  if (!contactList) {
    window.isRenderingContactList = false;
    return;
  }
  
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
  // First, remove any existing create group buttons to prevent duplicates
  const existingButtons = groupContent.querySelectorAll('.create-group-button');
  existingButtons.forEach(btn => btn.remove());
  
  // create group button
  
  const createGroupButton = document.createElement('button');
  createGroupButton.className = 'create-group-button';
  createGroupButton.innerHTML = '<span>Create New Group</span>';
  
  // button created
  console.log('🔧 Button HTML:', createGroupButton.innerHTML);
  
  // Add click event listener directly to avoid initialization complexity
  console.log('🔧 Adding click event listener...');
  
  createGroupButton.addEventListener('click', (event) => {
    // create group button clicked
    
    try {
      // call showCreateGroupModal
      showCreateGroupModal();
      // modal opened
    } catch (error) {
      console.error('❌ Error calling showCreateGroupModal:', error);
      console.error('❌ Error stack:', error.stack);
    }
  });
  
  console.log('🔧 Event listener added, appending button to DOM...');
  groupContent.appendChild(createGroupButton);
  console.log('🔧 Button appended to DOM. Button in DOM:', document.querySelector('.create-group-button'));

  // Add user's groups
  if (window.groupContactManager) {
    const userGroups = Array.from(window.groupContactManager.groups.values())
      .filter(group => {
        // Double check that the group is not in leftGroups
        const isLeft = window.groupContactManager.leftGroups.has(group.id);
        console.log('Group:', group.id, 'isLeft:', isLeft);
        if (isLeft) return false;
        // Apply search filter on group name/about
        return matchesFilter(group.name || '', '', group.about || '');
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
    // Get ALL contacts with DM history, regardless of follow status
    const allContactsWithMessages = new Map();
    
    // Add followed contacts
    contacts.forEach(contact => {
      allContactsWithMessages.set(contact.pubkey, contact);
    });
    
    // Add contacts with DM history that might not be followed
    if (contactManager.lastMessageTimes) {
      for (const [pubkey, lastMessageTime] of contactManager.lastMessageTimes.entries()) {
        // Skip if already added as a followed contact
        if (!allContactsWithMessages.has(pubkey)) {
          // Skip blocked contacts BEFORE adding them
          if (window.blockedContacts && window.blockedContacts.has(pubkey)) {
            console.log(`Skipping blocked contact ${pubkey.slice(0,8)} from DM history`);
            continue;
          }
          
          // Skip unfollowed contacts BEFORE adding them
          if (window.unfollowedContacts && window.unfollowedContacts.has(pubkey)) {
            console.log(`Skipping unfollowed contact ${pubkey.slice(0,8)} from DM history`);
            continue;
          }
          
          // Create a temporary contact object for non-followed contacts with messages
          // Try to get metadata if available
          let displayName = `Unknown (${pubkey.slice(0, 8)}...)`;
          let avatarUrl = 'icons/default-avatar.png';
          let about = '';
          
          // Check if we have metadata for this contact
          if (window.contactMetadata && window.contactMetadata[pubkey]) {
            const metadata = window.contactMetadata[pubkey];
            displayName = metadata.name || metadata.display_name || displayName;
            avatarUrl = metadata.picture || avatarUrl;
            about = metadata.about || about;
          }
          
          const tempContact = {
            pubkey: pubkey,
            displayName: displayName,
            avatarUrl: avatarUrl,
            about: about,
            isTemporary: true, // Mark as non-followed contact
            lastMessageTime: lastMessageTime
          };
          // Apply filter to temporary contacts as well
          if (matchesFilter(tempContact.displayName, '', tempContact.about)) {
            allContactsWithMessages.set(pubkey, tempContact);
          }
        }
      }
    }
    
    // DOUBLE-CHECK: Remove any blocked contacts that might have slipped through
    if (window.blockedContacts) {
      for (const [pubkey, contact] of allContactsWithMessages.entries()) {
        if (window.blockedContacts.has(pubkey)) {
          console.log(`Removing blocked contact ${pubkey.slice(0,8)} that slipped through`);
          allContactsWithMessages.delete(pubkey);
        }
      }
    }
    
    // DOUBLE-CHECK: Remove any unfollowed contacts that might have slipped through
    if (window.unfollowedContacts) {
      for (const [pubkey, contact] of allContactsWithMessages.entries()) {
        if (window.unfollowedContacts.has(pubkey)) {
          console.log(`Removing unfollowed contact ${pubkey.slice(0,8)} that slipped through`);
          allContactsWithMessages.delete(pubkey);
        }
      }
    }
    
    // Debug logging for blocked contacts
    console.log('Blocked contacts before filtering:', window.blockedContacts ? Array.from(window.blockedContacts) : 'undefined');
    console.log('Unfollowed contacts before filtering:', window.unfollowedContacts ? Array.from(window.unfollowedContacts) : 'undefined');
    
    // Filter out unfollowed contacts and blocked contacts
    const filteredContacts = Array.from(allContactsWithMessages.values()).filter(contact => {
      // Filter out unfollowed contacts
      if (window.unfollowedContacts && window.unfollowedContacts.has(contact.pubkey)) {
        console.log(`Filtering out unfollowed contact: ${contact.pubkey.slice(0,8)}`);
        return false;
      }
      
      // Filter out blocked contacts (muted contacts)
      if (window.blockedContacts && window.blockedContacts.has(contact.pubkey)) {
        console.log(`Filtering out blocked contact: ${contact.pubkey.slice(0,8)}`);
        return false;
      }
      // Resolve best-known display name for filtering
      let nameForFilter = contact.displayName;
      if ((!nameForFilter || nameForFilter.toLowerCase().startsWith('unknown')) && window.contactMetadata && contact.pubkey) {
        const md = window.contactMetadata[contact.pubkey];
        if (md) nameForFilter = md.name || md.display_name || nameForFilter;
      }
      // Apply search filter
      return matchesFilter(nameForFilter, contact.npub || '', contact.about || '');
    });
    
    console.log(`Filtered ${allContactsWithMessages.size} contacts down to ${filteredContacts.length} contacts`);
    
    // Use the already-calculated lastMessageTime from contactManager instead of re-fetching
    const contactsWithMessages = filteredContacts.map(contact => {
      const lastMessageTime = contactManager.lastMessageTimes.get(contact.pubkey);
        return {
          ...contact,
        lastMessageTime: lastMessageTime || null
        };
    });

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
  
  // Reset the rendering flag
  window.isRenderingContactList = false;
  // renderContactList complete
}

// Remove duplicate plain filter; initializeUI wires a richer search that filters all sections

function createContactElement(contact) {
  const element = document.createElement('div');
  element.className = `contact-item ${contact.isChannel ? 'channel' : ''} ${contact.isGroup ? 'group' : ''}`;
  element.dataset.pubkey = contact.pubkey || contact.id;
  
  const img = document.createElement('img');
  img.className = contact.isGroup ? 'group-avatar' : 'contact-avatar';
  img.src = contact.avatarUrl || '/icons/default-avatar.png';
  img.onerror = () => {
    // Silently handle broken images without console spam
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
  // Prefer known metadata name if available and not empty
  let resolvedName = contact.displayName;
  if (!resolvedName && window.contactMetadata && (contact.pubkey || contact.id)) {
    const md = window.contactMetadata[contact.pubkey || contact.id];
    if (md) {
      resolvedName = md.name || md.display_name || resolvedName;
    }
  }
  nameSpan.textContent = resolvedName || shortenIdentifier(contact.pubkey || contact.id);
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
        <div class="context-menu-item" data-action="unfollow">Unfollow</div>
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
            // LEAVE GROUP clicked
            await showLeaveGroupModal(contact);
            break;
          case 'profile':
            const metadata = await getUserMetadata(contact.pubkey);
            showProfileModal(contact.pubkey, metadata);
            break;
          case 'unfollow':
            await unfollowContact(contact.pubkey);
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
        const textBefore = (parts[0] || '').trim()
          .replace(/^\s*less\s*secure\s*(?:dm|group)\s*with\s*(?:gif|jpe?g|png|webp|image|images|media|picture|photo)\s*[:.!-]?\s*$/i, '');
        if (textBefore && !textBefore.match(/https?:\/\/(media[0-9]*\.)?/)) {
          messageHtml += `<div class="message-text">${linkifyText(textBefore)}</div>`;
        }
        
        // Add the media
        messageHtml += `
          <div class="media-container">
            <img src="${cleanUrl}" class="message-media" loading="lazy" alt="Media content">
          </div>`;
        
        // Add text after media if exists and it's not a media URL
        const remainingText = parts.slice(1).join(url).trim()
          .replace(/^\s*less\s*secure\s*(?:dm|group)\s*with\s*(?:gif|jpe?g|png|webp|image|images|media|picture|photo)\s*[:.!-]?\s*$/i, '');
        if (remainingText && !remainingText.match(/https?:\/\/(media[0-9]*\.)?/)) {
          messageHtml += `<div class="message-text">${linkifyText(remainingText)}</div>`;
        }
        
        bubbleElement.innerHTML = messageHtml;
        // Attach CSP-safe error handlers for media images
        const mediaImgs = bubbleElement.querySelectorAll('img.message-media');
        mediaImgs.forEach(img => {
          img.addEventListener('error', () => { img.style.display = 'none'; });
        });

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

  // Regular text message (strip boilerplate caption if present)
  const sanitized = (content || '').replace(/^\s*less\s*secure\s*(?:dm|group)\s*with\s*(?:gif|jpe?g|png|webp|image|images|media|picture|photo)\s*[:.!-]?\s*$/i, '');
  bubbleElement.innerHTML = `<div class="message-text">${linkifyText(sanitized)}</div>`;

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
    .replace(/(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s]|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b(?:\/[^\s<]*)?)/g, (url) => {
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
  if (emojiButton && emojiButton.parentNode) {
  emojiButton.parentNode.replaceChild(newEmojiButton, emojiButton);
  }
  
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
        <label for="zapAmount">Amount (sats):</label>
        <input type="number" id="zapAmount" min="1" value="100" />
      </div>
      <div class="zap-message-container" style="margin: 15px 0;">
        <label for="zapMessage">Message (optional):</label>
        <input type="text" id="zapMessage" placeholder="Add a personal message..." maxlength="255" />
      </div>
      <pre id="zapError" class="error-message" style="display: none; margin: 10px 0; padding: 10px; background: rgba(255,0,0,0.1); border-radius: 4px; white-space: pre-wrap; word-break: break-word; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto;"></pre>
      <div class="button-container" style="margin-top: 20px;">
        <button id="sendZapButton" class="primary-button">Show QR</button>
        <div style="margin: 10px 0;"></div>
        <button id="sendZapNWC" class="secondary-button">Pay with NWC</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const sendButton = modal.querySelector('#sendZapButton');
  const sendNwcButton = modal.querySelector('#sendZapNWC');
  const amountInput = modal.querySelector('#zapAmount');
  const errorDiv = modal.querySelector('#zapError');

  sendButton.addEventListener('click', async () => {
    const amount = parseInt(amountInput.value);
    if (amount > 0) {
      try {
        errorDiv.style.display = 'none';
        sendButton.disabled = true;
        sendButton.textContent = 'Processing...';

        const messageInput = modal.querySelector('#zapMessage');
        const customMessage = messageInput.value.trim();

        const response = await chrome.runtime.sendMessage({
          type: 'GET_ZAP_INVOICE',
          data: {
            lightningAddress: metadata.lud16 || metadata?.lightning,
            amount,
            zapRequest: {
              kind: 9734,
              pubkey: (await auth.getCurrentUser()).pubkey,
              created_at: Math.floor(Date.now() / 1000),
              content: customMessage || (message.type === 'group' ? "Zapped a group message" : "Zapped a DM"),
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

        await showQRModal(response.invoice, {
          kind: 9734,
          pubkey: (await auth.getCurrentUser()).pubkey,
          created_at: Math.floor(Date.now() / 1000),
          content: customMessage || (message.type === 'group' ? "Zapped a group message" : "Zapped a DM"),
          tags: [
            ['p', message.pubkey],
            ['e', message.id],
            ['amount', amount.toString()],
            ['relays', ...RELAYS],
            // Add group context if it's a group message
            ...(message.type === 'group' && message.groupId ? [['e', message.groupId, '', 'root']] : [])
          ]
        });
        modal.remove();
        
        // Show success message
        showErrorMessage(`Zap invoice created for ${amount} sats! Scan the QR code to pay.`, 'success');
      } catch (error) {
        console.error('Zap failed:', error);
        errorDiv.textContent = `Error Details:\n${error.message}`;
        errorDiv.style.display = 'block';
        sendButton.disabled = false;
        sendButton.textContent = 'Show QR';
      }
    }
  });

  // NWC payment path - HARMONIZED with QR modal button
  try {
    const { nwcConfig } = await chrome.storage.local.get('nwcConfig');
    if (!nwcConfig && sendNwcButton) {
      sendNwcButton.style.display = 'none';
    }
    if (nwcConfig && sendNwcButton) {
      sendNwcButton.addEventListener('click', async () => {
        const amount = parseInt(amountInput.value);
        if (!amount || amount <= 0) {
          showErrorMessage('Enter a valid amount');
          return;
        }
        try {
          errorDiv.style.display = 'none';
          sendNwcButton.disabled = true;
          sendNwcButton.textContent = 'Processing...';

          const lightningAddress = metadata.lud16 || metadata?.lightning;
          if (!lightningAddress) {
            showErrorMessage('No lightning address available for this user');
            return;
          }

          const messageInput = modal.querySelector('#zapMessage');
          const customMessage = messageInput.value.trim();
          
          const user = await auth.getCurrentUser();
          const zapRequest = {
            kind: 9734,
            pubkey: user.pubkey,
            created_at: Math.floor(Date.now() / 1000),
            content: customMessage || (message.type === 'group' ? 'Zapped a group message' : 'Zapped a DM'),
            tags: [
              ['p', message.pubkey],
              ['e', message.id],
              ['amount', amount.toString()],
              ['relays', ...RELAYS],
              ...(message.type === 'group' && message.groupId ? [['e', message.groupId, '', 'root']] : [])
            ]
          };

          // HARMONIZED: Use the same flow as QR modal button - direct NWC zap
          // Get invoice first, then pay via NWC (same flow as QR modal)
          const invoiceResponse = await chrome.runtime.sendMessage({
            type: 'GET_ZAP_INVOICE',
            data: {
              lightningAddress,
              amount,
              zapRequest
            }
          });

          if (invoiceResponse.error) {
            throw new Error(invoiceResponse.error);
          }

          // Now pay the invoice via NWC
          const zapResult = await new Promise(resolve => {
            chrome.runtime.sendMessage({ 
              type: 'PAY_INVOICE_VIA_NWC', 
              data: { 
                invoice: invoiceResponse.invoice,
                zapRequest: zapRequest,
                relays: zapRequest.tags.find(tag => tag[0] === 'relays')?.slice(1) || [],
                amount: amount.toString(),
                message: customMessage || (message.type === 'group' ? 'Zapped a group message' : 'Zapped a DM')
              } 
            }, resolve);
          });

          // FIXED: Check for actual payment success before showing success
          if (zapResult?.error) {
            throw new Error(zapResult.error);
          }
          
          // FIXED: Check if the payment actually succeeded
          if (!zapResult?.ok && !zapResult?.result?.success) {
            throw new Error('Payment failed - no success confirmation received');
          }
          
          // SUCCESS! Show visual feedback then close modal (same as QR modal)
          sendNwcButton.textContent = '✅ Zap Sent!';
          sendNwcButton.style.background = '#4CAF50';
          sendNwcButton.style.color = 'white';
          
          // Add success animation
          sendNwcButton.style.transform = 'scale(1.1)';
          sendNwcButton.style.transition = 'all 0.3s ease';
          
          setTimeout(() => {
            modal.remove();
            showErrorMessage('Zap sent successfully via NWC! 🎉', 'success');
          }, 1500);
          
        } catch (e) {
          console.error('NWC payment failed:', e);
          showErrorMessage(e.message || 'NWC payment failed');
          // Error visual state
          sendNwcButton.disabled = false;
          sendNwcButton.textContent = '❌ Not successful - Retry';
          sendNwcButton.classList.remove('success-button');
          sendNwcButton.classList.add('error-button');
          sendNwcButton.style.background = '#d32f2f';
          sendNwcButton.style.color = '#fff';
          sendNwcButton.style.transform = '';
        }
      });
    }
  } catch (e) {
    // ignore wiring issues
  }

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
      content: message.content || "Zapped a DM", // Use actual message content if available
      tags: [
        ['p', message.pubkey],
        ['e', message.id],
        ['amount', amount.toString()],
        ['relays', ...RELAYS]
      ]
    };

    const invoice = await createZapInvoice(metadata, amount, zapRequest);
    await showQRModal(invoice, zapRequest);

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

async function showQRModal(invoice, zapRequest = null) {
  const modal = document.createElement('div');
  modal.className = 'qr-modal';
  
  modal.innerHTML = `
    <div class="qr-modal-content">
      <div class="qr-container">
        <div id="qrcode-container"></div>

        <div class="invoice-text">${invoice}</div>
        <div class="modal-buttons">
          <button class="copy-button">Copy</button>
          <button class="nwc-pay-button">Pay via NWC</button>
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
  const nwcPayButton = modal.querySelector('.nwc-pay-button');
  const closeButton = modal.querySelector('.close-button');
  
  // Check if NWC is connected AND we have zap request data
  const nwcStatus = await chrome.storage.local.get('nwcConfig');
  if (!nwcStatus.nwcConfig || !zapRequest) {
    nwcPayButton.style.display = 'none';
  }
  
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
  
  nwcPayButton.addEventListener('click', async () => {
    try {
      nwcPayButton.textContent = 'Paying...';
      nwcPayButton.disabled = true;
      
      // Check if we have zap request data for receipt creation
      if (!zapRequest) {
        console.warn('No zap request available, payment will work but no receipt will be created');
        // If no zap request, just pay without receipt data
        const response = await chrome.runtime.sendMessage({
          type: 'PAY_INVOICE_VIA_NWC',
          data: { 
            invoice
          }
        });
        
        if (response.error) {
          throw new Error(response.error);
        }
        
        if (!response?.ok && !response?.result?.success) {
          throw new Error('Payment failed - no success confirmation received');
        }
        
        // Success! Show visual feedback and keep modal open so user sees status
        nwcPayButton.textContent = '✅ Zap Sent!';
        nwcPayButton.style.background = '#4CAF50';
        nwcPayButton.style.color = 'white';
        
        // Add success animation
        nwcPayButton.style.transform = 'scale(1.1)';
        nwcPayButton.style.transition = 'all 0.3s ease';
        
        showErrorMessage('Zap sent successfully via NWC! 🎉', 'success');
        if (closeButton) closeButton.disabled = false;
        return;
      }
      
      const response = await chrome.runtime.sendMessage({
        type: 'PAY_INVOICE_VIA_NWC',
        data: { 
          invoice,
          zapRequest: zapRequest,
          relays: zapRequest.tags.find(tag => tag[0] === 'relays')?.slice(1) || [],
          amount: zapRequest.tags.find(tag => tag[0] === 'amount')?.[1] || '1000',
          message: zapRequest.content || 'Zapped via QR'
        }
      });
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      if (!response?.ok && !response?.result?.success) {
        throw new Error('Payment failed - no success confirmation received');
      }
      
      // Success! Show visual feedback and keep modal open so user sees status
      nwcPayButton.textContent = '✅ Zap Sent!';
      nwcPayButton.style.background = '#4CAF50';
      nwcPayButton.style.color = 'white';
      
      // Add success animation
      nwcPayButton.style.transform = 'scale(1.1)';
      nwcPayButton.style.transition = 'all 0.3s ease';
      
      showErrorMessage('Zap sent successfully via NWC! 🎉', 'success');
      if (closeButton) closeButton.disabled = false;
      
    } catch (error) {
      console.error('NWC payment failed:', error);
      showErrorMessage(`NWC payment failed: ${error.message}`);
      nwcPayButton.textContent = '❌ Not successful - Retry';
      nwcPayButton.disabled = false;
      nwcPayButton.classList.remove('success-button');
      nwcPayButton.classList.add('error-button');
      nwcPayButton.style.background = '#d32f2f';
      nwcPayButton.style.color = '#fff';
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
  return true;  
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
    const result = await chrome.storage.local.get('searchHistory');
    let currentHistory = result.searchHistory || [];
    
    if (!currentHistory.includes(term)) {
      currentHistory.unshift(term);
      if (currentHistory.length > 5) currentHistory.pop();
      
      await chrome.storage.local.set({ searchHistory: currentHistory });
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

// Function to unfollow a contact
async function unfollowContact(pubkey) {
  if (!confirm('Are you sure you want to unfollow this contact?')) {
    return;
  }

  try {
    const currentUser = await auth.getCurrentUser();
    if (!currentUser) {
      console.error('No current user found');
      return;
    }

    // Check if this is a followed contact or just a non-contact (temporary)
    const contact = contactManager.contacts.get(pubkey);
    const isFollowedContact = contact && !contact.isTemporary;

    if (isFollowedContact) {
      console.log(`Unfollowing followed contact: ${pubkey}`);
      
      // Get current follow list
      const followListEvents = await pool.list(relayPool.getConnectedRelays(), [
        {
          kinds: [3],
          authors: [currentUser.pubkey],
          limit: 1
        }
      ]);
      
      let currentFollowList = [];
      let originalFollowEvent = null;
      
      if (followListEvents.length > 0) {
        originalFollowEvent = followListEvents[0];
        currentFollowList = originalFollowEvent.tags
          .filter(tag => tag[0] === 'p')
          .map(tag => tag[1]);
      }
      
      // Remove the contact from the follow list
      const updatedFollowList = currentFollowList
        .filter(p => p !== pubkey)
        .map(p => ['p', p]);
      
      // Create new follow event
      const followEvent = {
        kind: 3,
        pubkey: currentUser.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: updatedFollowList,
        content: originalFollowEvent?.content || ''
      };
      
      // Sign and publish the updated follow list
      let signedEvent;
      if (currentUser.type === 'NSEC' && currentUser.privkey) {
        // Use stored private key for NSEC login
        followEvent.id = nostrCore.getEventHash(followEvent);
        followEvent.sig = nostrCore.getSignature(followEvent, currentUser.privkey);
        signedEvent = followEvent;
      } else if (currentUser.type === 'NIP-07') {
        // Use NIP-07 extension for signing
        if (!window.nostr) {
          throw new Error('NIP-07 extension not available');
        }
        signedEvent = await window.nostr.signEvent(followEvent);
      } else {
        throw new Error('No valid signing method available');
      }
      
      // Filter out relays known to restrict writes
      const writableRelays = RELAYS.filter(relay => 
        !relay.includes('nostr.wine') // Known to require signup for writes
      );
      
      await pool.publish(writableRelays, signedEvent);
      console.log(`Published updated follow list to network`);
      
    } else {
      // For non-contacts (temporary): Update mute list (NIP-51)
      console.log(`Muting non-contact: ${pubkey}`);
      
      // Get current mute list
      const muteListEvents = await pool.list(relayPool.getConnectedRelays(), [
        {
          kinds: [10000], // NIP-51 mute list
          authors: [currentUser.pubkey],
          limit: 1
        }
      ]);

      let currentMuteList = [];
      if (muteListEvents.length > 0) {
        currentMuteList = muteListEvents[0].tags
          .filter(tag => tag[0] === 'p')
          .map(tag => tag[1]);
      }

      // Add the new pubkey to mute list if not already there
      if (!currentMuteList.includes(pubkey)) {
        currentMuteList.push(pubkey);
      }

      // Create updated mute list event
      const updatedMuteTags = currentMuteList.map(p => ['p', p]);
      
      const muteEvent = {
        kind: 10000, // NIP-51 mute list
        pubkey: currentUser.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: updatedMuteTags,
        content: '', // Empty content for mute lists
      };

      // Sign and publish the mute list
      let signedMuteEvent;
      if (currentUser.type === 'NSEC' && currentUser.privkey) {
        muteEvent.id = nostrCore.getEventHash(muteEvent);
        muteEvent.sig = nostrCore.getSignature(muteEvent, currentUser.privkey);
        signedMuteEvent = muteEvent;
      } else if (currentUser.type === 'NIP-07') {
        if (!window.nostr) {
          throw new Error('NIP-07 extension not available');
        }
        signedMuteEvent = await window.nostr.signEvent(muteEvent);
      } else {
        throw new Error('No valid signing method available');
      }
      
      // Filter out relays known to restrict writes
      const writableRelays = RELAYS.filter(relay => 
        !relay.includes('nostr.wine')
      );
      
      await pool.publish(writableRelays, signedMuteEvent);
      console.log(`Published updated mute list to network (NIP-51)`);
    }

    // Remove from local contact list and refresh UI
    contactManager.contacts.delete(pubkey);
    contactManager.lastMessageTimes.delete(pubkey);
    
    // Also add to a local "unfollowed" list to prevent re-adding
    if (!window.unfollowedContacts) {
      window.unfollowedContacts = new Set();
    }
    window.unfollowedContacts.add(pubkey);
    
    // Save to persistent storage
    await saveUnfollowedContacts();
    console.log(`Added ${pubkey} to unfollowed contacts. Total unfollowed: ${window.unfollowedContacts.size}`);
    
    // Also persist blocked contacts to storage
    if (!window.blockedContacts) {
      window.blockedContacts = new Set();
    }
    window.blockedContacts.add(pubkey);
    try {
      await chrome.storage.local.set({
        blockedContacts: Array.from(window.blockedContacts)
      });
      console.log(`Persisted blocked contact ${pubkey} to storage`);
    } catch (error) {
      console.error('Error persisting blocked contact:', error);
    }
    
    // Refresh the contact list display - ensure unfollowed contacts are filtered out
    const filteredContacts = Array.from(contactManager.contacts.values()).filter(contact => 
      !window.unfollowedContacts.has(contact.pubkey)
    );
    await renderContactList(filteredContacts);
    
    console.log(`${isFollowedContact ? 'Unfollowed' : 'Blocked'} contact: ${pubkey}`);
  } catch (error) {
    console.error('Error unfollowing contact:', error);
    alert('Failed to unfollow contact. Please try again.');
  }
}

// Add function to show profile modal
async function showProfileModal(pubkey, metadata) {
  const npub = pubkeyToNpub(pubkey);
  
  const modal = document.createElement('div');
  modal.className = 'modal profile-modal';
  
  modal.innerHTML = `
    <div class="modal-content profile-modal-content">
      <div class="profile-header">
        <img src="${metadata?.picture || '/icons/default-avatar.png'}" alt="Profile" class="profile-avatar">
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
      
      <!-- NWC section removed from other people's profiles - only shows in your own profile -->
      
      <div class="modal-buttons">
        <button class="copy-button">Copy</button>
        <button class="close-button">Close</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);

  // NWC initialization removed - only needed for your own profile

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

  // Add NWC functionality - ensure elements exist before adding listeners
  // Use requestAnimationFrame to ensure DOM is fully rendered
  requestAnimationFrame(() => {
    // Try multiple selectors to find the elements
    const nwcConnectBtn = modal.querySelector('#nwc-connect');
    const nwcDisconnectBtn = modal.querySelector('#nwc-disconnect');
    const nwcInputSection = modal.querySelector('.nwc-input-section') || modal.querySelector('[class*="nwc-input"]');
    const nwcUriInput = modal.querySelector('#nwc-uri') || modal.querySelector('input[placeholder*="nostr+walletconnect"]');
    
    // NWC elements discovered
    
    console.log('NWC input element:', nwcUriInput);
    console.log('NWC input section element:', nwcInputSection);
    
    // Force the input field to be editable
    if (nwcUriInput) {
      nwcUriInput.removeAttribute('readonly');
      nwcUriInput.removeAttribute('disabled');
      nwcUriInput.style.pointerEvents = 'auto';
      nwcUriInput.style.userSelect = 'text';
      nwcUriInput.style.webkitUserSelect = 'text';
      nwcUriInput.style.mozUserSelect = 'text';
      nwcUriInput.style.msUserSelect = 'text';
      nwcUriInput.style.background = 'white !important';
      nwcUriInput.style.color = 'black !important';
      nwcUriInput.style.border = '1px solid #ccc';
      // NWC input field editable
    } else {
      console.error('NWC input field NOT FOUND!');
      // Try to find it by looking at all inputs in the modal
      const allInputs = modal.querySelectorAll('input');
      console.log('All inputs in modal:', allInputs);
      console.log('Modal HTML structure:', modal.innerHTML);
      
      // Try alternative selectors
      const alternativeInput = modal.querySelector('input[type="text"]') || 
                              modal.querySelector('input[placeholder*="nostr"]') ||
                              modal.querySelector('input[placeholder*="wallet"]');
      
      if (alternativeInput) {
        console.log('Found alternative input:', alternativeInput);
        alternativeInput.removeAttribute('readonly');
        alternativeInput.removeAttribute('disabled');
        alternativeInput.style.pointerEvents = 'auto';
        alternativeInput.style.userSelect = 'text';
        alternativeInput.style.background = 'white !important';
        alternativeInput.style.color = 'black !important';
        alternativeInput.style.border = '1px solid #ccc';
        console.log('Alternative input field made editable');
      }
      
      // If still not found, try a different approach - wait a bit longer
      setTimeout(() => {
        console.log('Trying delayed NWC element search...');
        const delayedInput = modal.querySelector('#nwc-uri');
        if (delayedInput) {
          console.log('Found NWC input with delay:', delayedInput);
          delayedInput.removeAttribute('readonly');
          delayedInput.removeAttribute('disabled');
          delayedInput.style.pointerEvents = 'auto';
          delayedInput.style.userSelect = 'text';
          delayedInput.style.background = 'white !important';
          delayedInput.style.color = 'black !important';
          delayedInput.style.border = '1px solid #ccc';
          // Delayed NWC input field editable
        } else {
          console.error('NWC input still not found after delay');
        }
      }, 100);
    }

    if (nwcConnectBtn && nwcUriInput) {
      nwcConnectBtn.addEventListener('click', () => {
        console.log('NWC Connect button clicked');
        
        const uri = nwcUriInput.value.trim();
        if (!uri) {
          showErrorMessage('Please enter a NWC URI');
          nwcUriInput.focus();
          return;
        }
        
        // Submit connection
        console.log('Submitting connection');
        handleNWCConnect(modal);
      });
    } else {
      console.error('NWC elements not found:', { 
        nwcConnectBtn: !!nwcConnectBtn, 
        nwcUriInput: !!nwcUriInput 
      });
    }

    if (nwcDisconnectBtn) {
      nwcDisconnectBtn.addEventListener('click', async () => {
        try {
          const response = await new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'NWC_DISCONNECT' }, resolve);
          });
          
          if (response.ok) {
            showErrorMessage('NWC disconnected successfully!', 'success');
            await initializeNWCStatus(modal);
          } else {
            showErrorMessage(response.error || 'Failed to disconnect NWC');
          }
        } catch (error) {
          showErrorMessage('Failed to disconnect NWC');
        }
      });
    }
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
           class="group-avatar" id="group-avatar-${groupId}">
      <div class="group-header-info">
        <div class="group-header-name">${group.name || 'Unnamed Group'}</div>
        <div class="group-header-members">${group.members?.length || 0} members</div>
      </div>
    </div>
  `;

  // Ensure group avatar fallback without inline handler
  const headerImg = chatHeader.querySelector(`#group-avatar-${groupId}`);
  if (headerImg) {
    headerImg.addEventListener('error', () => {
      headerImg.src = 'icons/default-group.png';
    });
  }

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

async function initializeApp() {
  try {
    await auth.init();
    const currentUser = await auth.getCurrentUser();
    
    console.log('POPUP INIT: currentUser:', currentUser?.pubkey?.slice(0,8));
    if (currentUser) {
      console.log('POPUP INIT: About to call contactManager.init()');
      
      // Initialize unfollowed contacts from storage
      await initializeUnfollowedContacts();
      
      // Initialize contacts
      const contacts = await contactManager.init(currentUser.pubkey);
      console.log('POPUP INIT: contactManager.init() completed, got', contacts?.length, 'contacts');
      
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
  console.log('🚨 leaveGroup FUNCTION STARTED with groupId:', groupId);
  try {
    console.log('🔍 window.groupContactManager exists:', !!window.groupContactManager);
    const group = window.groupContactManager.groups.get(groupId);
    if (!group) {
      console.error('Group not found:', groupId);
      return;
    }

    // Use the new groupContactManager.leaveGroup function
    await window.groupContactManager.leaveGroup(groupId);
    console.log('Group left successfully');

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
    if (groupContent && window.groupContactManager) {
      // Instead of recreating the entire UI (which can cause conflicts),
      // just remove the specific group that was left
      const groupElement = groupContent.querySelector(`[data-pubkey="${groupId}"]`);
      if (groupElement) {
        groupElement.remove();
      }
      
      // If no groups left, show the "no groups" message
      const remainingGroups = groupContent.querySelectorAll('.contact-item');
      const noGroupsMessage = groupContent.querySelector('.no-groups-message');
      
      if (remainingGroups.length === 0 && !noGroupsMessage) {
        const noGroupsMsg = document.createElement('div');
        noGroupsMsg.className = 'no-groups-message';
        noGroupsMsg.textContent = 'No groups yet';
        groupContent.appendChild(noGroupsMsg);
        }
    }

    showErrorMessage('Successfully left the group', 'success');
    return true;
    
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
      modal.remove();
    } catch (error) {
      console.error('Failed to leave group:', error);
      showErrorMessage('Failed to leave group: ' + error.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Leave Group';
    }
  };
  
  cancelBtn.onclick = () => {
      modal.remove();
    isModalOpen = false;
    console.log('🔓 Modal closed, flag reset');
  };
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      isModalOpen = false;
      console.log('🔓 Modal closed by background click, flag reset');
    }
  });
}

// Update search functionality
function initializeSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearch');

  if (!searchInput || !clearSearch) return;

  function performSearch(query) {
    // Single source of truth: re-render list with filter term
    const contacts = Array.from(contactManager.contacts.values());
    renderContactList(contacts, query);
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
    const { messageId, amount } = message.data;
    handleReceivedZap(messageId, amount);
  }
  return true;
});

async function handleReceivedZap(messageId, amount) {
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

// NWC Helper Functions
async function initializeNWCStatus(modal) {
  try {
    const nwcStatus = modal.querySelector('#nwc-status');
    const nwcConnectBtn = modal.querySelector('#nwc-connect');
    const nwcDisconnectBtn = modal.querySelector('#nwc-disconnect');
    
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'NWC_GET_INFO' }, resolve);
    });
    
    if (response.ok && response.config) {
      const config = response.config;
      nwcStatus.innerHTML = `
        <div class="nwc-connected">
          <div class="nwc-wallet-info">
            <strong>${config.alias || 'Unknown Wallet'}</strong>
            <span class="nwc-network">${config.network || 'mainnet'}</span>
          </div>
          <div class="nwc-methods">
            Methods: ${config.methods.join(', ')}
          </div>
    </div>
  `;
      
      // Show existing connection state
      nwcConnectBtn.style.display = 'none';
      nwcDisconnectBtn.style.display = 'block';
      
      // If we have a stored URI, populate the input field
      const uriInput = modal.querySelector('#nwc-uri');
      if (uriInput && config.uri) {
        uriInput.value = config.uri;
        uriInput.readOnly = true;
        uriInput.style.backgroundColor = '#f0f0f0';
        uriInput.style.cursor = 'default';
      }
    } else {
      nwcStatus.innerHTML = `
        <div class="nwc-disconnected">
          <span>Not connected</span>
    </div>
  `;
      nwcConnectBtn.style.display = 'block';
      nwcDisconnectBtn.style.display = 'none';
    }
  } catch (error) {
    console.error('Error initializing NWC status:', error);
    const nwcStatus = modal.querySelector('#nwc-status');
    nwcStatus.innerHTML = `
      <div class="nwc-error">
        <span>Error loading status</span>
      </div>
    `;
  }
}

async function handleNWCConnect(modal) {
  const uriInput = modal.querySelector('#nwc-uri');
  const connectBtn = modal.querySelector('#nwc-connect');
  const inputSection = modal.querySelector('.nwc-input-section');
  
  const uri = uriInput.value.trim();
  if (!uri) {
    showErrorMessage('Please enter a NWC URI');
    return;
  }
  
  try {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ 
        type: 'NWC_CONNECT', 
        data: { uri } 
      }, resolve);
    });
    
    if (response.ok) {
      showErrorMessage('NWC connected successfully!', 'success');
      // Keep URI visible but make it read-only
      uriInput.readOnly = true;
      uriInput.style.backgroundColor = '#f0f0f0';
      uriInput.style.cursor = 'default';
      // Change button to show connected state
      connectBtn.textContent = 'Connected';
      connectBtn.disabled = true;
      connectBtn.classList.add('success-button');
      // Refresh NWC status
      await initializeNWCStatus(modal);
    } else {
      showErrorMessage(response.error || 'Failed to connect NWC');
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
    }
  } catch (error) {
    showErrorMessage('Failed to connect NWC');
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
  }
}

function showNWCConnectModal() {
    const modal = document.createElement('div');
  modal.className = 'modal nwc-connect-modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Connect NWC Wallet</h3>
      <p>Paste your NWC connection string:</p>
      <div class="input-group">
        <input type="text" id="nwc-uri" placeholder="nostr+walletconnect://..." />
      </div>
      <div class="nwc-help">
        <p><strong>How to get this:</strong></p>
        <ol>
          <li>Open your NWC-compatible wallet</li>
          <li>Look for "Connect" or "Add Client"</li>
          <li>Copy the connection string</li>
          <li>Paste it here</li>
        </ol>
    </div>
      <div class="modal-buttons">
        <button id="nwc-connect-submit" class="primary-button">Connect</button>
        <button id="nwc-connect-cancel" class="secondary-button">Cancel</button>
            </div>
      </div>
    `;
  
    document.body.appendChild(modal);
  
  const uriInput = modal.querySelector('#nwc-uri');
  const submitBtn = modal.querySelector('#nwc-connect-submit');
  const cancelBtn = modal.querySelector('#nwc-connect-cancel');
  
  submitBtn.addEventListener('click', async () => {
    const uri = uriInput.value.trim();
    if (!uri) {
      showErrorMessage('Please enter a NWC URI');
      return;
    }
    
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Connecting...';
      
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage({ 
          type: 'NWC_CONNECT', 
          data: { uri } 
        }, resolve);
      });
      
      if (response.ok) {
        showErrorMessage('NWC connected successfully!', 'success');
    modal.remove();
        // Refresh the profile modal if it's open
        const profileModal = document.querySelector('.profile-modal');
        if (profileModal) {
          await initializeNWCStatus(profileModal);
        }
    } else {
        showErrorMessage(response.error || 'Failed to connect NWC');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Connect';
      }
    } catch (error) {
      showErrorMessage('Failed to connect NWC');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Connect';
    }
  });
  
  cancelBtn.addEventListener('click', () => {
    modal.remove();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
    modal.remove();
    }
  });
}

// Initialize unfollowed contacts from storage
async function initializeUnfollowedContacts() {
  try {
    const result = await chrome.storage.local.get('unfollowedContacts');
    if (result.unfollowedContacts) {
      window.unfollowedContacts = new Set(result.unfollowedContacts);
      console.log(`Loaded ${window.unfollowedContacts.size} unfollowed contacts from storage:`, Array.from(window.unfollowedContacts).map(p => p.slice(0,8)));
        } else {
      window.unfollowedContacts = new Set();
      console.log('No unfollowed contacts found in storage');
    }
  } catch (error) {
    console.error('Error loading unfollowed contacts:', error);
    window.unfollowedContacts = new Set();
  }
}

// Save unfollowed contacts to storage
async function saveUnfollowedContacts() {
  try {
    const unfollowedArray = Array.from(window.unfollowedContacts);
    await chrome.storage.local.set({ unfollowedContacts: unfollowedArray });
    console.log(`Saved ${unfollowedArray.length} unfollowed contacts to storage:`, unfollowedArray.map(p => p.slice(0,8)));
  } catch (error) {
    console.error('Error saving unfollowed contacts:', error);
  }
}

// Test if group management functions exist
// Functions available for UI actions confirmed

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