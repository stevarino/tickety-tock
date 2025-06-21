import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as data from './data';

test('Get and set Settings', async t => {
  const db = await data.init(':memory:');
  await db.setSetting('other', 0);

  const ver = await db.getSetting<number>('version');
  assert.notStrictEqual(ver, undefined);
  await db.setSetting('version', ver! + 1)
  const ver2 = await db.getSetting<number>('version');
  assert.strictEqual(ver2, ver! + 1);
  await db.init();
  const ver3 = await db.getSetting<number>('version');
  assert.strictEqual(ver2, ver3);

  const other = await db.getSetting<number>('other');
  assert.strictEqual(other, 0);
});

test('Generate slugs', async t => {
  const db = await data.init(':memory:');
  const s1 = db.createSlug();
  assert.notStrictEqual(s1, undefined);
  const s2 = db.createSlug();
  assert.notStrictEqual(s2, undefined);
  assert.notStrictEqual(s1, s2);
});

test('Get or create users', async t => {
  const db = await data.init(':memory:');
  const user1 = await db.getOrCreateUser('user1@domain.com');
  const user2 = await db.getOrCreateUser('user2@domain.com');
  const user1b = await db.getOrCreateUser('user1@domain.com');
  assert.notStrictEqual(user1, user2);
  assert.strictEqual(user1, user1b);
});
