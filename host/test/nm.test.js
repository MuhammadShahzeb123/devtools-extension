// host/test/nm.test.js
'use strict';
const { test } = require('node:test');
const assert   = require('node:assert');
const { readMessages, writeMessage } = require('../nm.js');

test('readMessages: parses a single complete message', () => {
  const msg  = { id: '1', type: 'command', method: 'Page.navigate' };
  const json = Buffer.from(JSON.stringify(msg), 'utf8');
  const len  = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);

  const { messages, remaining } = readMessages(Buffer.concat([len, json]));
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual(messages[0], msg);
  assert.strictEqual(remaining.length, 0);
});

test('readMessages: returns partial buffer when body not yet complete', () => {
  const msg  = { id: '1', type: 'command' };
  const json = Buffer.from(JSON.stringify(msg), 'utf8');
  const len  = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  const full    = Buffer.concat([len, json]);
  const partial = full.slice(0, full.length - 2);

  const { messages, remaining } = readMessages(partial);
  assert.strictEqual(messages.length, 0);
  assert.strictEqual(remaining.length, partial.length);
});

test('readMessages: parses two messages concatenated in one buffer', () => {
  const encode = (msg) => {
    const json = Buffer.from(JSON.stringify(msg), 'utf8');
    const len  = Buffer.alloc(4);
    len.writeUInt32LE(json.length, 0);
    return Buffer.concat([len, json]);
  };
  const { messages } = readMessages(Buffer.concat([encode({ id: '1' }), encode({ id: '2' })]));
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].id, '1');
  assert.strictEqual(messages[1].id, '2');
});

test('readMessages: header only (no body bytes yet)', () => {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(10, 0);
  const { messages, remaining } = readMessages(len);
  assert.strictEqual(messages.length, 0);
  assert.strictEqual(remaining.length, 4);
});

test('writeMessage: buffer has correct LE length prefix and JSON body', () => {
  const msg = { id: '42', type: 'result', result: { ok: true } };
  const buf = writeMessage(msg);

  const bodyLen = buf.readUInt32LE(0);
  const parsed  = JSON.parse(buf.slice(4, 4 + bodyLen).toString('utf8'));
  assert.deepStrictEqual(parsed, msg);
});
