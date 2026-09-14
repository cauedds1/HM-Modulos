'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const arm = require('../src/core/armazenamento');
const registro = require('../src/core/registro');

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hm-reg-')), 'registro.json');
}

test('arquivo inexistente carrega como cadeia vazia', () => {
  const f = path.join(os.tmpdir(), 'nao-existe-' + Date.now(), 'r.json');
  assert.deepStrictEqual(arm.carregar(f), []);
});

test('adicionar persiste e encadeia entre execuções', () => {
  const f = tempFile();
  const e1 = arm.adicionar(f, { tipo: 'Diagnóstico', resumo: 'painel', operador: 'João' });
  const e2 = arm.adicionar(f, { tipo: 'Sincronismo', resumo: 'casado', operador: 'João' });
  assert.strictEqual(e1.seq, 1);
  assert.strictEqual(e2.seq, 2);
  assert.strictEqual(e2.hashPrev, e1.hash);
  // recarrega do zero (simula reabrir o programa) e confere que persistiu
  const lista = arm.carregar(f);
  assert.strictEqual(lista.length, 2);
  assert.strictEqual(arm.verificar(f).ok, true);
});

test('adulterar o arquivo por fora é detectado', () => {
  const f = tempFile();
  arm.adicionar(f, { tipo: 'Diagnóstico', resumo: 'a', operador: 'X' });
  arm.adicionar(f, { tipo: 'Diagnóstico', resumo: 'b', operador: 'X' });
  const lista = JSON.parse(fs.readFileSync(f, 'utf8'));
  lista[0].resumo = 'adulterado';
  fs.writeFileSync(f, JSON.stringify(lista));
  assert.strictEqual(arm.verificar(f).ok, false);
});

test('salvar é atômico — não deixa .tmp para trás', () => {
  const f = tempFile();
  arm.adicionar(f, { tipo: 'Diagnóstico', resumo: 'a', operador: 'X' });
  assert.strictEqual(fs.existsSync(f + '.tmp'), false);
});
