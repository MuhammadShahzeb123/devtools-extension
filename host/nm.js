// host/nm.js
'use strict';

function readMessages(buffer) {
  const messages = [];
  let remaining  = buffer;
  while (remaining.length >= 4) {
    const len = remaining.readUInt32LE(0);
    if (remaining.length < 4 + len) break;
    try {
      messages.push(JSON.parse(remaining.slice(4, 4 + len).toString('utf8')));
    } catch {
      // skip malformed message body
    }
    remaining = remaining.slice(4 + len);
  }
  return { messages, remaining };
}

function writeMessage(msg) {
  const json = Buffer.from(JSON.stringify(msg), 'utf8');
  const len  = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  return Buffer.concat([len, json]);
}

module.exports = { readMessages, writeMessage };
