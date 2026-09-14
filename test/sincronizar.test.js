'use strict';

const test = require('node:test');
const assert = require('node:assert');
const sinc = require('../src/core/sincronizar');
const leitor = require('../src/core/leitor');
const editor = require('../src/core/editor');

// Perfis sintéticos com checksum conhecido, um "painel" (km ×10) e um "airbag" (km cru).
function perfilPainel() {
  return {
    id: 'p', modulo: 'painel', tamanho: 512,
    campos: { vin: { offset: 0x10, tamanho: 17 }, km: { offset: 0x40, tamanho: 3, endian: 'le', fator: 10, confianca: 'confirmado' } },
    checksums: [{ algoritmo: 'sum16', inicio: 0, fim: 0x1ff, destino: 0x1fe, tamanho: 2, endian: 'le' }],
  };
}
function perfilAirbag() {
  return {
    id: 'a', modulo: 'airbag', tamanho: 256,
    campos: { vin: { offset: 0x08, tamanho: 17 }, km: { offset: 0x30, tamanho: 3, endian: 'le', fator: 1, confianca: 'confirmado' } },
    checksums: [{ algoritmo: 'sum16', inicio: 0, fim: 0xff, destino: 0xfe, tamanho: 2, endian: 'le' }],
  };
}
function mod(perfil, { vin, km }) {
  const buffer = editor.corrigir(Buffer.alloc(perfil.tamanho, 0), perfil, { vin, km }).buffer;
  return { buffer, perfil };
}

test('comparar detecta casado', () => {
  const painel = mod(perfilPainel(), { vin: '935CPFCA5SB556938', km: 25100 });
  const airbag = mod(perfilAirbag(), { vin: '935CPFCA5SB556938', km: 25100 });
  assert.strictEqual(sinc.comparar(painel, airbag).estado, 'casado');
});

test('comparar detecta fora de sincronia (KM diferente)', () => {
  const painel = mod(perfilPainel(), { vin: '935CPFCA5SB556938', km: 85219 });
  const airbag = mod(perfilAirbag(), { vin: '935CPFCA5SB556938', km: 25100 });
  assert.strictEqual(sinc.comparar(painel, airbag).estado, 'fora-de-sincronia');
});

test('comparar detecta chassis diferentes', () => {
  const painel = mod(perfilPainel(), { vin: '935CPFCA5SB556938', km: 100 });
  const airbag = mod(perfilAirbag(), { vin: '935CEFC2CRB551519', km: 100 });
  assert.strictEqual(sinc.comparar(painel, airbag).estado, 'chassis-diferentes');
});

test('sincronizar KM do painel para o airbag deixa os dois iguais', () => {
  const painel = mod(perfilPainel(), { vin: '935CPFCA5SB556938', km: 85219 });
  const airbag = mod(perfilAirbag(), { vin: '935CPFCA5SB556938', km: 25100 });
  const r = sinc.sincronizar(painel, airbag, { vin: 'painel', km: 'painel' });
  // relê os dois resultados
  const rp = leitor.analisar(r.painel.buffer, perfilPainel());
  const ra = leitor.analisar(r.airbag.buffer, perfilAirbag());
  assert.strictEqual(rp.km, 85219);
  assert.strictEqual(ra.km, 85219); // airbag passou a ter a KM do painel
  assert.strictEqual(rp.vin, ra.vin);
  assert.strictEqual(r.painel.aceitavel, true);
  assert.strictEqual(r.airbag.aceitavel, true);
});

test('falha segura: valor que não cabe no campo do módulo vira erro, não quebra', () => {
  const perfilPequeno = perfilAirbag();
  perfilPequeno.campos.km.tamanho = 2; // campo pequeno: cabe só até 65535
  const painel = mod(perfilPainel(), { vin: '935CPFCA5SB556938', km: 85219 });
  const airbag = mod(perfilPequeno, { vin: '935CPFCA5SB556938', km: 25100 });
  const r = sinc.sincronizar(painel, airbag, { km: 'painel' }); // 85219 não cabe no airbag
  assert.ok(r.airbag.erro, 'o airbag deve reportar erro em vez de gravar lixo');
  assert.strictEqual(r.painel.buffer instanceof Buffer, true); // o painel corrigiu normal
});

test('sincronizar não altera os buffers originais', () => {
  const painel = mod(perfilPainel(), { vin: '935CPFCA5SB556938', km: 85219 });
  const airbag = mod(perfilAirbag(), { vin: '935CPFCA5SB556938', km: 25100 });
  const cp = Buffer.from(painel.buffer), ca = Buffer.from(airbag.buffer);
  sinc.sincronizar(painel, airbag, { km: 'airbag' });
  assert.deepStrictEqual(painel.buffer, cp);
  assert.deepStrictEqual(airbag.buffer, ca);
});
