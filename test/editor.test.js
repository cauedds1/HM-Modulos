'use strict';

const test = require('node:test');
const assert = require('node:assert');
const editor = require('../src/core/editor');
const leitor = require('../src/core/leitor');
const checksum = require('../src/core/checksum');

/* Perfil sintético de um módulo COM checksum conhecido (sum16). Prova que a
   máquina de escrever VIN/KM + recalcular checksum funciona ponta a ponta.
   Quando o checksum da PSA for decifrado (P1b), ele entra aqui igual. */
function perfilSintetico() {
  return {
    id: 'teste',
    modulo: 'Teste',
    memoria: 'sintético',
    tamanho: 512,
    campos: {
      vin: { offset: 0x10, tamanho: 17 },
      km: { offset: 0x40, tamanho: 3, endian: 'le', fator: 10, confianca: 'confirmado' },
    },
    checksums: [{ nome: 'bloco', algoritmo: 'sum16', inicio: 0x00, fim: 0x1ff, destino: 0x1fe, tamanho: 2, endian: 'le' }],
  };
}

test('corrigir escreve VIN e KM e o arquivo fica aceitável (checksum bate)', () => {
  const perfil = perfilSintetico();
  const original = Buffer.alloc(perfil.tamanho, 0);
  const { buffer, aceitavel } = editor.corrigir(original, perfil, { vin: '935CPFCA5SB556938', km: 48271 });
  assert.strictEqual(aceitavel, true);
  // lê de volta e confere
  const r = leitor.analisar(buffer, perfil);
  assert.strictEqual(r.vin, '935CPFCA5SB556938');
  assert.strictEqual(r.km, 48271);
  // o checksum gravado bate com o recalculado
  assert.strictEqual(checksum.verificar(buffer, perfil.checksums[0]).ok, true);
});

test('o original NUNCA é alterado (o original é sagrado)', () => {
  const perfil = perfilSintetico();
  const original = Buffer.alloc(perfil.tamanho, 0);
  const copia = Buffer.from(original);
  editor.corrigir(original, perfil, { vin: '935CPFCA5SB556938', km: 48271 });
  assert.deepStrictEqual(original, copia, 'o buffer original deve permanecer intacto');
});

test('escreve a KM com o fator ×10 correto (48271 → 482710 gravado)', () => {
  const perfil = perfilSintetico();
  const { buffer } = editor.corrigir(Buffer.alloc(perfil.tamanho, 0), perfil, { km: 48271 });
  const bruto = buffer[0x40] | (buffer[0x41] << 8) | (buffer[0x42] << 16);
  assert.strictEqual(bruto, 482710);
});

test('perfil SEM checksums (caso PSA/P1b): escreve o campo mas marca não-aceitável', () => {
  const perfil = perfilSintetico();
  delete perfil.checksums; // simula o estado atual dos perfis PSA
  // inclui VIN para o módulo não ser lido como "em branco" (que anularia a KM)
  const { buffer, aceitavel } = editor.corrigir(Buffer.alloc(perfil.tamanho, 0), perfil, { vin: '935CPFCA5SB556938', km: 1000 });
  assert.strictEqual(aceitavel, false);
  // o campo até foi escrito, mas sem o checksum o módulo rejeitaria
  assert.strictEqual(leitor.analisar(buffer, perfil).km, 1000);
});

test('escreve KM nas réplicas quando o perfil as declara', () => {
  const perfil = perfilSintetico();
  perfil.campos.km.replicas = [{ offset: 0x50, tamanho: 3, endian: 'le' }];
  const { buffer } = editor.corrigir(Buffer.alloc(perfil.tamanho, 0), perfil, { km: 1234 });
  const r1 = buffer[0x40] | (buffer[0x41] << 8) | (buffer[0x42] << 16);
  const r2 = buffer[0x50] | (buffer[0x51] << 8) | (buffer[0x52] << 16);
  assert.strictEqual(r1, 12340);
  assert.strictEqual(r2, 12340);
});
