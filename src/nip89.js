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
