'use strict';

const test = require('node:test');
const assert = require('node:assert');
const airbag = require('../src/core/airbag');
const editor = require('../src/core/editor');

/**
 * Perfil de airbag SINTETICO (inventado para o teste) — com a regiao de crash
 * data mapeada e checksum conhecido. Espelha a estrutura de um airbag real:
 * VIN, KM, uma regiao de "crash data" e um checksum no fim. Os offsets reais
 * de um airbag PSA dependem de um dump batido do mecanico; aqui provamos a
 * MAQUINA, com um airbag de mentira.
 */
function perfilAirbagCrash() {
  return {
    id: 'a-crash', modulo: 'airbag', tamanho: 256,
    campos: {
      vin: { offset: 0x08, tamanho: 17 },
      km: { offset: 0x30, tamanho: 3, endian: 'le', fator: 1, confianca: 'confirmado' },
    },
    crash: { regioes: [{ offset: 0x60, tamanho: 16, limpo: '00' }] },
    checksums: [{ algoritmo: 'sum16', inicio: 0, fim: 0xff, destino: 0xfe, tamanho: 2, endian: 'le' }],
  };
}

// Airbag "de fabrica" (sem colisao): regiao de crash toda zerada.
function airbagLimpo() {
  const perfil = perfilAirbagCrash();
  return editor.corrigir(Buffer.alloc(perfil.tamanho, 0), perfil, {
    vin: '935CPFCA5SB556938', km: 25100,
  }).buffer;
}

// Airbag "batido" (colisao registrada): a regiao de crash tem bytes != 0,
// e o checksum e recalculado para ser um arquivo valido-porem-batido.
function airbagBatido() {
  const perfil = perfilAirbagCrash();
  const buf = airbagLimpo();
  buf.fill(0xa5, 0x60, 0x60 + 8); // grava "colisao" na regiao de crash
  editor.aplicarChecksums(buf, perfil); // reconfere o arquivo
  return buf;
}

test('detecta que NAO ha colisao num airbag de fabrica', () => {
  const r = airbag.detectarColisao(airbagLimpo(), perfilAirbagCrash());
  assert.strictEqual(r.suportado, true);
  assert.strictEqual(r.colisao, false);
});

test('detecta colisao registrada num airbag batido', () => {
  const r = airbag.detectarColisao(airbagBatido(), perfilAirbagCrash());
  assert.strictEqual(r.suportado, true);
  assert.strictEqual(r.colisao, true);
  assert.ok(r.regioes[0].sujos > 0, 'deve contar os bytes de colisao');
});

test('airbag sem regiao mapeada: nao adivinha (suportado=false)', () => {
  const perfilSemCrash = perfilAirbagCrash();
  delete perfilSemCrash.crash;
  const r = airbag.detectarColisao(airbagBatido(), perfilSemCrash);
  assert.strictEqual(r.suportado, false);
});

test('RECUSA limpar crash data sem declaracao de reparo fisico', () => {
  const r = airbag.limparCrash(airbagBatido(), perfilAirbagCrash(), {});
  assert.ok(r.erro, 'deve recusar sem declaracao');
  assert.strictEqual(r.buffer, undefined, 'nao pode devolver arquivo limpo sem declaracao');
});

test('RECUSA limpar com declaracao incompleta (sem reparo confirmado)', () => {
  const r = airbag.limparCrash(airbagBatido(), perfilAirbagCrash(), {
    declaracaoReparo: { responsavel: 'HM', os: '123', reparoFisicoFeito: false },
  });
  assert.ok(r.erro, 'reparoFisicoFeito=false deve recusar');
});

test('limpa crash data COM declaracao de reparo fisico e o airbag volta ao normal', () => {
  const perfil = perfilAirbagCrash();
  const original = airbagBatido();
  const copia = Buffer.from(original);

  const r = airbag.limparCrash(original, perfil, {
    declaracaoReparo: { responsavel: 'HM Mecanica', os: 'OS-2026-001', reparoFisicoFeito: true },
    ts: 1700000000000,
  });

  assert.ok(!r.erro, 'com declaracao valida, nao deve dar erro');
  assert.strictEqual(r.aceitavel, true, 'perfil com checksums => arquivo aceitavel');
  // relendo o resultado, nao ha mais colisao
  const depois = airbag.detectarColisao(r.buffer, perfil);
  assert.strictEqual(depois.colisao, false, 'apos limpar, sem colisao');
  // a declaracao fica registrada (para a cadeia de auditoria)
  assert.strictEqual(r.declaracao.responsavel, 'HM Mecanica');
  assert.strictEqual(r.declaracao.reparoFisicoFeito, true);
  // o original ficou intacto (o original e sagrado)
  assert.deepStrictEqual(original, copia);
});

test('airbag sem regiao mapeada tambem recusa limpar (mesmo com declaracao)', () => {
  const perfilSemCrash = perfilAirbagCrash();
  delete perfilSemCrash.crash;
  const r = airbag.limparCrash(airbagBatido(), perfilSemCrash, {
    declaracaoReparo: { responsavel: 'HM', os: '1', reparoFisicoFeito: true },
  });
  assert.ok(r.erro, 'sem mapeamento, recusa');
});
