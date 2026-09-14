'use strict';

const test = require('node:test');
const assert = require('node:assert');
const auth = require('../src/core/auth');

test('a senha correta confere', () => {
  const h = auth.hashSenha('oficina123');
  assert.strictEqual(auth.verificarSenha('oficina123', h), true);
});

test('a senha errada não confere', () => {
  const h = auth.hashSenha('oficina123');
  assert.strictEqual(auth.verificarSenha('oficina124', h), false);
});

test('o hash nunca contém a senha em texto', () => {
  const h = auth.hashSenha('minhasenhasecreta');
  assert.ok(!h.includes('minhasenhasecreta'));
});

test('dois hashes da mesma senha são diferentes (sal aleatório)', () => {
  assert.notStrictEqual(auth.hashSenha('igual'), auth.hashSenha('igual'));
});

test('senha muito curta é rejeitada', () => {
  assert.throws(() => auth.hashSenha('ab'));
});

test('hash inválido não confere (falha segura)', () => {
  assert.strictEqual(auth.verificarSenha('x', 'lixo'), false);
});
