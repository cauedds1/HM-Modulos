'use strict';

const test = require('node:test');
const assert = require('node:assert');
const leitor = require('../src/core/leitor');
const psa = require('../src/core/psa');
const { carregarPerfis, detectar } = require('../src/core/perfil');

const perfis = carregarPerfis();

/* Constrói um painel PSA sintético com VIN e KM controlados, para testar o
   leitor sem depender de dumps reais de cliente (que não entram no repo). */
function painelSintetico({ vin = '935CPFCA5SB556938', km = 25100 } = {}) {
  const b = Buffer.alloc(65536, 0);
  b.write('BCCM', 0x0ac6, 'latin1'); // assinatura, na janela 0x0AB0..
  b.write(vin, 0x0b00, 'latin1'); // VIN em ASCII
  // KM real: anel de registros PSA (16 bytes cada, com codigo de protecao).
  // Planta alguns registros do odometro principal, como no dump real.
  let off = 0x5000;
  for (let i = 0; i < 3; i++) { psa.montarRegistroKm(km).copy(b, off); off += 0x30; }
  return b;
}

test('perfis PSA carregam do diretório', () => {
  assert.ok(perfis['psa-bccm'], 'perfil psa-bccm presente');
  assert.ok(perfis['psa-airbag'], 'perfil psa-airbag presente');
});

test('detecta o painel pelo tamanho e assinatura BCCM', () => {
  const p = detectar(painelSintetico(), perfis);
  assert.ok(p);
  assert.strictEqual(p.modulo, 'painel');
});

test('recusa arquivo de tamanho desconhecido (não chuta)', () => {
  assert.strictEqual(detectar(Buffer.alloc(1234), perfis), null);
});

test('lê VIN e KM corretos do painel sintético', () => {
  const p = perfis['psa-bccm'];
  const r = leitor.analisar(painelSintetico({ km: 25100 }), p);
  assert.strictEqual(r.vin, '935CPFCA5SB556938');
  assert.strictEqual(r.km, 25100);
  assert.strictEqual(r.resetado, false);
  assert.ok(r.checks.every((c) => c.tipo !== 'erro'));
});

test('lê KM alta corretamente (85219, valor que não cabe em 2 bytes)', () => {
  const p = perfis['psa-bccm'];
  const r = leitor.analisar(painelSintetico({ km: 85219 }), p);
  assert.strictEqual(r.km, 85219);
});

test('reconhece módulo resetado (VIN todo 0xFF)', () => {
  const b = painelSintetico();
  b.fill(0xff, 0x0b00, 0x0b00 + 17); // apaga o VIN
  const r = leitor.analisar(b, perfis['psa-bccm']);
  assert.strictEqual(r.resetado, true);
  assert.strictEqual(r.vin, '(em branco)');
});

test('acusa estrutura não reconhecida quando falta a assinatura', () => {
  const b = painelSintetico();
  b.fill(0, 0x0ab0, 0x0ab0 + 32); // apaga a assinatura BCCM
  const r = leitor.analisar(b, perfis['psa-bccm']);
  assert.ok(r.checks.some((c) => c.tipo === 'erro' && /Estrutura/.test(c.texto)));
});
