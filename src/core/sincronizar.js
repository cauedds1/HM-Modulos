'use strict';

/**
 * Sincronizar — a operação central: casar painel e airbag do mesmo carro.
 *
 * Compara VIN e KM dos dois módulos, e (quando divergem) aplica o valor
 * escolhido nos dois, de modo que passem a concordar. Nunca digita valor: o
 * valor vem sempre de um dos módulos. Trabalha em cópias (originais intactos).
 *
 * Como a gravação depende dos checksums do perfil (P1b para os PSA), o
 * resultado carrega `aceitavel` por módulo — false enquanto o perfil não tiver
 * a fórmula do checksum.
 */

const leitor = require('./leitor');
const editor = require('./editor');

/** Compara os dois módulos. Devolve os valores e onde divergem. */
function comparar(painel, airbag) {
  const rp = leitor.analisar(painel.buffer, painel.perfil);
  const ra = leitor.analisar(airbag.buffer, airbag.perfil);
  const vinIgual = rp.vin === ra.vin && rp.vin !== '(em branco)' && rp.vin !== '—';
  const kmIgual = rp.km != null && ra.km != null && rp.km === ra.km;
  let estado;
  if (vinIgual && kmIgual) estado = 'casado';
  else if (!vinIgual && rp.vin !== '—' && ra.vin !== '—' && rp.vin !== '(em branco)' && ra.vin !== '(em branco)')
    estado = 'chassis-diferentes';
  else estado = 'fora-de-sincronia';
  return { painel: rp, airbag: ra, vinIgual, kmIgual, estado };
}

/**
 * Sincroniza os dois módulos segundo as direções escolhidas.
 *   direcoes = { vin: 'painel'|'airbag', km: 'painel'|'airbag' }
 * Aplica o valor da fonte escolhida em AMBOS os módulos (para casar).
 * Devolve { painel:{buffer,aceitavel}, airbag:{...}, vin, km }.
 */
function sincronizar(painel, airbag, direcoes = {}) {
  const cmp = comparar(painel, airbag);
  const dirVin = direcoes.vin === 'airbag' ? 'airbag' : 'painel';
  const dirKm = direcoes.km === 'airbag' ? 'airbag' : 'painel';
  const vin = dirVin === 'airbag' ? cmp.airbag.vin : cmp.painel.vin;
  const km = dirKm === 'airbag' ? cmp.airbag.km : cmp.painel.km;

  const alter = {};
  if (vin && vin !== '—' && vin !== '(em branco)') alter.vin = vin;
  if (km != null) alter.km = km;

  // Falha segura: se um valor não couber no campo do módulo (ex.: KM alta num
  // airbag de campo pequeno), a operação não quebra — devolve o erro no módulo.
  const corrigirSeguro = (mod) => {
    try {
      const r = editor.corrigir(mod.buffer, mod.perfil, alter);
      return { buffer: r.buffer, aceitavel: r.aceitavel };
    } catch (e) {
      return { erro: e.message };
    }
  };

  return {
    painel: corrigirSeguro(painel),
    airbag: corrigirSeguro(airbag),
    vin,
    km,
    origem: { vin: dirVin, km: dirKm },
  };
}

module.exports = { comparar, sincronizar };
