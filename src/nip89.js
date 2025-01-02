import { pool, nostrCore } from './shared.js';
import { toLowerCaseHex } from './utils.js';

export async function publishAppHandlerEvent(privateKey, eventType, eventContent) {
  const event = {
    kind: 31989,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'tides'],
      ['t', eventType]
    ],
    content: JSON.stringify(eventContent)
  };

  const signedEvent = nostrCore.signEvent(event, privateKey);
  await pool.publish(signedEvent);
}

/**
 * @file nip89.js
 * @description NIP-89 App Handler implementation for Nostr
 * 
 * Implements:
 * - NIP-89 event publishing (kind: 31989)
 * - App handler event creation
 * - Event signing and relay publishing
 * 
 * @see https://github.com/nostr-protocol/nips/blob/master/89.md
 */