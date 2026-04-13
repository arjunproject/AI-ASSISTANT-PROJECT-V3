import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isSiblingBotSender, listSiblingBotNumbers } from '../src/whatsapp/system-bot-guard.js';

test('system bot guard resolves sibling bot numbers from the paired bot deployment', () => {
  assert.deepEqual(
    listSiblingBotNumbers('6285655002277', ['6285655002277', '201507007785']),
    ['201507007785'],
  );
  assert.deepEqual(
    listSiblingBotNumbers('201507007785', ['6285655002277', '201507007785']),
    ['6285655002277'],
  );
});

test('system bot guard only flags the sibling bot sender and not the runtime owner', () => {
  assert.equal(
    isSiblingBotSender('201507007785', '6285655002277', ['6285655002277', '201507007785']),
    true,
  );
  assert.equal(
    isSiblingBotSender('6285655002277', '6285655002277', ['6285655002277', '201507007785']),
    false,
  );
  assert.equal(
    isSiblingBotSender('6281234567890', '6285655002277', ['6285655002277', '201507007785']),
    false,
  );
});
