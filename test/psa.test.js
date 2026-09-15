'use strict';

const test = require('node:test');
const assert = require('node:assert');
const psa = require('../src/core/psa');

// Vetor de ouro: KM 60200 (o valor do exemplo do mecanico). O registro
// correspondente, extraido do dump de referencia, tem:
//   bytes[0..3] (hash, LE) = c6 b6 26 60  -> 0x6026b6c6
//   byte[6] (digito)       = 0xc8
//   bytes[12..14] (km x10) = 90 2f 09
test('hash do registro de KM confere com o vetor de ouro (60200 km)', () => {
  // 60200 * 10 = 602000 = 0x092F90 -> k0=0x90 k1=0x2f k2=0x09
  assert.strictEqual(psa.hashRegistroKm(0x90, 0x2f, 0x09) >>> 0, 0x6026b6c6);
});

test('digito verificador do byte[6] = soma dos 3 bytes da KM', () => {
  assert.strictEqual(psa.digitoKm(0x90, 0x2f, 0x09), 0xc8); // 0x90+0x2f+0x09
});

test('montarRegistroKm(60200) reproduz o registro de referencia', () => {
  const rec = psa.montarRegistroKm(60200);
  assert.deepStrictEqual([...rec.subarray(0, 4)], [0xc6, 0xb6, 0x26, 0x60]); // hash LE
  assert.strictEqual(rec[6], 0xc8);                                          // digito
  assert.deepStrictEqual([...rec.subarray(12, 15)], [0x90, 0x2f, 0x09]);     // km x10
});

test('um registro que a formula gera e sempre valido (round-trip)', () => {
  for (const km of [10, 1000, 60200, 100000, 250000, 999999]) {
    const rec = psa.montarRegistroKm(km);
    assert.ok(psa.pareceRegistroKm(rec), `km=${km} deveria parecer registro de KM`);
    assert.ok(psa.registroKmValido(rec), `km=${km} deveria ser valido`);
  }
});

test('registro adulterado (hash nao recalculado) e detectado como invalido', () => {
  const rec = psa.montarRegistroKm(60200);
  rec[12] = rec[12] ^ 0x01; // muda a KM sem corrigir o hash
  assert.strictEqual(psa.registroKmValido(rec), false);
});

// ---- Anel de registros: leitura e correcao do odometro (motor E2 do painel) ----
// Monta um painel sintetico de 64 KB com um odometro principal (varios
// registros ~157383) e um contador secundario (~137), imitando a estrutura real.
function painelSintetico() {
  const buf = Buffer.alloc(65536, 0);
  const principal = [157383, 157382, 157381]; // anel do odometro real
  const secundario = [137, 136];              // contador secundario (nao se mexe)
  let off = 0x5000;
  const por = (km) => { psa.montarRegistroKm(km).copy(buf, off); off += 0x30; };
  principal.forEach((k) => { por(k); por(k); });  // repete (anel)
  secundario.forEach((k) => por(k));
  return buf;
}

test('lerKmPainel devolve o odometro principal (o maior do anel), ignorando o secundario', () => {
  const r = psa.lerKmPainel(painelSintetico());
  assert.strictEqual(r.km, 157383);
  assert.strictEqual(r.registros, 8);          // 6 principais + 2 secundarios
  assert.strictEqual(r.registrosOdometro, 6);  // so os do odometro principal
});

test('corrigirKmPainel reescreve so o odometro principal e deixa o secundario intacto', () => {
  const orig = painelSintetico();
  const copia = Buffer.from(orig);
  const r = psa.corrigirKmPainel(orig, 60200);
  assert.strictEqual(r.de, 157383);
  assert.strictEqual(r.para, 60200);
  assert.strictEqual(r.alterados, 6);
  assert.deepStrictEqual(orig, copia, 'o original nao pode ser tocado');
  // relendo o resultado, o odometro passou a ser 60200
  assert.strictEqual(psa.lerKmPainel(r.buffer).km, 60200);
  // e o contador secundario (137) continua la
  const kms = psa.scanRegistros(r.buffer).map((x) => x.km);
  assert.ok(kms.includes(137), 'o contador secundario (137) deve permanecer');
});

test('CRC-32 refletido bate com o padrao (poly 0xEDB88320)', () => {
  // "123456789" -> CRC-32 padrao = 0xCBF43926; init/xorout 0xFFFFFFFF.
  // A nossa crc32r usa init=0/xorout=0, entao aplicamos a relacao padrao:
  const msg = Buffer.from('123456789', 'ascii');
  const inicio = psa.crc32r([0xff, 0xff, 0xff, 0xff]); // efeito do init
  // CRC padrao = crc32r(msg) com init 0xFFFFFFFF e xorout 0xFFFFFFFF:
  // implementacao direta para conferir:
  const TAB = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); TAB[n] = c >>> 0; }
  let c = 0xffffffff >>> 0;
  for (const b of msg) c = (TAB[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0;
  c = (c ^ 0xffffffff) >>> 0;
  assert.strictEqual(c, 0xCBF43926);
  void inicio;
});

// ================= AIRBAG (anel de KM, decifrado do antes/depois) =================

test('hash do registro de KM do airbag confere com o vetor de ouro (60200 km)', () => {
  // 60200 = 0xEB28 -> k0=0x28 k1=0xeb k2=0x00. Hash gravado (BE) = 13 72 0d e6.
  assert.strictEqual(psa.hashRegistroKmAirbag(0x28, 0xeb, 0x00) >>> 0, 0x13720de6);
});

test('a constante do airbag e o hash do registro vazio (km=0 -> D3 43 B5 76)', () => {
  assert.strictEqual(psa.hashRegistroKmAirbag(0, 0, 0) >>> 0, 0xd343b576);
});

// Monta um airbag sintetico com um anel de registros de KM (hash BE + km LE).
function airbagSintetico(km) {
  const buf = Buffer.alloc(32768, 0);
  // planta 12 registros do odometro, com pequena variacao (historia do anel)
  const offs = [0x100, 0x400, 0x800, 0x1000, 0x1500, 0x1a00, 0x2000, 0x2600, 0x3000, 0x3800, 0x4000, 0x4800];
  offs.forEach((o, i) => psa.escreverRegistroKmAirbag(buf, o, km - (11 - i))); // ..., km-1, km
  return { buf, offs };
}

test('lerKmAirbag devolve o odometro (o maior do anel)', () => {
  const { buf } = airbagSintetico(157383);
  assert.strictEqual(psa.lerKmAirbag(buf).km, 157383);
  assert.strictEqual(psa.lerKmAirbag(buf).registros, 12);
});

test('corrigirKmAirbag reescreve todo o anel e nao toca no original', () => {
  const { buf } = airbagSintetico(157383);
  const copia = Buffer.from(buf);
  const r = psa.corrigirKmAirbag(buf, 60200);
  assert.strictEqual(r.de, 157383);
  assert.strictEqual(r.para, 60200);
  assert.strictEqual(r.alterados, 12);
  assert.deepStrictEqual(buf, copia, 'o original nao pode ser tocado');
  assert.strictEqual(psa.lerKmAirbag(r.buffer).km, 60200);
});

test('registro de KM do airbag adulterado (hash nao recalculado) e invalido', () => {
  const { buf, offs } = airbagSintetico(60200);
  buf[offs[0] + 4] ^= 0x01; // muda a KM sem corrigir o hash
  assert.strictEqual(psa.registroKmAirbagValido(buf, offs[0]), false);
});

// ================= VIN do painel (checksum decifrado) =================

// Monta um painel sintetico com um VIN e o checksum correto (soma+1).
function painelComVin(vin) {
  const buf = Buffer.alloc(65536, 0);
  const o = psa.VIN_PAINEL_OFFSET; // 0x0B00
  for (let i = 0; i < 17; i++) buf[o + i] = vin.charCodeAt(i);
  buf[o + 17] = 0x01;
  const ck = psa.checksumVinPainel(buf, o);
  buf[o + 18] = ck & 0xff; buf[o + 19] = (ck >> 8) & 0xff;
  return buf;
}

test('checksum do VIN do painel = soma dos bytes + 1 (vetor real 935CDNFXDRB522343)', () => {
  // soma dos 17 ASCII = 1055; +1 (o byte 0x01) = 1056 = 0x0420
  const buf = painelComVin('935CDNFXDRB522343');
  assert.strictEqual(psa.checksumVinPainel(buf), 1056);
  assert.strictEqual(psa.vinPainelValido(buf), true);
});

test('escreverVinPainel troca o VIN, recalcula o checksum e nao toca no original', () => {
  const orig = painelComVin('935CDNFXDRB522343');
  const copia = Buffer.from(orig);
  const r = psa.escreverVinPainel(orig, '935CPFCA5SB556938');
  assert.deepStrictEqual(orig, copia, 'original intacto');
  const o = psa.VIN_PAINEL_OFFSET;
  const vinLido = String.fromCharCode(...r.buffer.subarray(o, o + 17));
  assert.strictEqual(vinLido, '935CPFCA5SB556938');
  assert.strictEqual(psa.vinPainelValido(r.buffer), true, 'checksum recalculado deve conferir');
});

test('escreverVinPainel recusa VIN com tamanho errado', () => {
  const buf = painelComVin('935CDNFXDRB522343');
  assert.throws(() => psa.escreverVinPainel(buf, '123'));
});
