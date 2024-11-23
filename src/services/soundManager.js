class SoundManager {
  constructor() {
    this.sounds = {
      login: new Audio(chrome.runtime.getURL('sounds/login.mp3')),
      message: new Audio(chrome.runtime.getURL('sounds/icq_message.mp3'))
    };
    this.enabled = true;
  }

  async play(type) {
    if (!this.enabled || !this.sounds[type]) return;
    
    try {
      await this.sounds[type].play();
    } catch (error) {
      console.error(`Error playing ${type} sound:`, error);
    }
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }
}

export const soundManager = new SoundManager(); 