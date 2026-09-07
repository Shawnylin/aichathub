const test = require('node:test');
const assert = require('node:assert/strict');
const resolve = require('../renderer/source-route');
const sites = { deepseek: { name: 'DeepSeek', url: 'https://chat.deepseek.com/' }, doubao: { name: '豆包', url: 'https://www.doubao.com/' } };
test('source identity preserves the original session even across domains', () => {
  assert.deepEqual(resolve({siteId:'deepseek',siteName:'豆包',url:'https://example.com/chat'}, sites), {siteId:'deepseek',url:'https://example.com/chat'});
});
test('legacy material matches platform name or exact domain', () => {
  assert.equal(resolve({siteName:'DeepSeek',url:'https://example.com/chat'}, sites).siteId, 'deepseek');
  assert.equal(resolve({url:'https://www.doubao.com/chat/1'}, sites).siteId, 'doubao');
});
test('unknown identities and unsafe URLs never open another session', () => {
  for (const url of ['javascript:alert(1)', 'file:///secret', 'https://www.doubao.com.evil.test/', 'invalid']) assert.throws(() => resolve({url}, sites));
});
