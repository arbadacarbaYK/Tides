const NostrTools = require('nostr-tools');

const npub = 'npub1ua6fxn9ktc4jncanf79jzvklgjftcdrt5etverwzzg0lgpmg3hsq2gh6v6';
const { data: pubkey } = NostrTools.nip19.decode(npub);

console.log(pubkey);