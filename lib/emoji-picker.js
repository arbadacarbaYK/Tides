// Basic emoji picker implementation
class EmojiPicker {
  constructor(options) {
    this.onSelect = options.onSelect;
    this.emojis = ['😊', '😂', '❤️', '👍', '😎', '🎉', '🔥', '✨'];
  }

  togglePicker(triggerElement) {
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker.innerHTML = this.emojis.map(emoji => 
      `<span class="emoji-option">${emoji}</span>`
    ).join('');

    picker.addEventListener('click', (e) => {
      if (e.target.classList.contains('emoji-option')) {
        this.onSelect(e.target.textContent);
        picker.remove();
      }
    });

    triggerElement.parentNode.appendChild(picker);
  }
}

self.EmojiPicker = EmojiPicker;
