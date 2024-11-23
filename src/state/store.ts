import { EventEmitter } from 'events';

export interface User {
  pubkey: string;
  npub: string;
  type: 'NIP-07' | 'NSEC';
  privkey?: string;
}

export interface Message {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  status: 'sent' | 'delivered' | 'read';
}

export interface Contact {
  pubkey: string;
  metadata: {
    name?: string;
    picture?: string;
    about?: string;
    nip05?: string;
  };
  isOnline: boolean;
  lastMessageTime?: number;
}

interface AppState {
  currentUser: User | null;
  contacts: Map<string, Contact>;
  messages: Map<string, Message[]>;
  currentChat: string | null;
  isLoading: boolean;
  error: string | null;
}

class Store extends EventEmitter {
  private state: AppState = {
    currentUser: null,
    contacts: new Map(),
    messages: new Map(),
    currentChat: null,
    isLoading: false,
    error: null
  };

  setState<K extends keyof AppState>(key: K, value: AppState[K]) {
    this.state[key] = value;
    this.emit('stateChanged', key, value);
  }

  getState(): AppState {
    return { ...this.state };
  }
}

export const store = new Store(); 