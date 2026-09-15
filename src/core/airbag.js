'use strict';

/**
 * Airbag — deteccao e limpeza de "crash data" (dados de colisao).
 *
 * Quando um airbag dispara, o modulo grava numa regiao da memoria que houve
 * uma colisao (e trava). "Limpar" essa regiao devolve o modulo ao estado de
 * fabrica. ISSO SO PODE SER FEITO APOS O REPARO FISICO — trocar os
 * componentes acionados. Fazer sem reparo e crime e perigo de morte.
 *
 * Por isso a limpeza aqui EXIGE, no proprio codigo, uma declaracao de reparo
 * fisico (responsavel + OS + confirmacao). Sem ela, o motor RECUSA. Trabalha
 * sempre numa copia (o original e sagrado) e recalcula os checksums do perfil.
 *
 * As regioes de crash sao declaradas no perfil (perfil.crash.regioes). Sem
 * esse mapeamento, o motor nao adivinha: informa que nao ha suporte para
 * aquele airbag. O mapeamento real dos airbags PSA depende de um dump de
 * airbag batido (material do mecanico) — ate la, so airbags com perfil
 * mapeado sao suportados.
 */

const editor = require('./editor');

/** As regioes de crash declaradas no perfil (ou vazio se o perfil nao mapeia). */
function regioesCrash(perfil) {
  return perfil && perfil.crash && Array.isArray(perfil.crash.regioes) ? perfil.crash.regioes : [];
}

/** O byte "de fabrica" de uma regiao (limpo). Aceita "00" ou "ff" (hex). */
function bytePadrao(r) {
  const v = parseInt(r.limpo != null ? String(r.limpo) : '00', 16);
  return Number.isFinite(v) ? v & 0xff : 0x00;
}

/**
 * Detecta se ha colisao registrada.
 * Devolve { suportado, colisao, regioes:[{offset,tamanho,sujos,colisao}] }.
 *   suportado=false quando o perfil nao mapeia crash data (nao adivinha).
 */
function detectarColisao(buf, perfil) {
  const regs = regioesCrash(perfil);
  if (regs.length === 0) return { suportado: false, colisao: null, regioes: [] };
  const detalhes = regs.map((r) => {
    const limpo = bytePadrao(r);
    let sujos = 0;
    for (let i = 0; i < r.tamanho; i++) {
      if (buf[r.offset + i] !== limpo) sujos++;
    }
    return { offset: r.offset, tamanho: r.tamanho, sujos, colisao: sujos > 0 };
  });
  return { suportado: true, colisao: detalhes.some((d) => d.colisao), regioes: detalhes };
}

/** Valida a declaracao obrigatoria de reparo fisico. */
function declaracaoValida(decl) {
  return !!(
    decl &&
    decl.reparoFisicoFeito === true &&
    typeof decl.responsavel === 'string' && decl.responsavel.trim() &&
    typeof decl.os === 'string' && decl.os.trim()
  );
}

/**
 * Limpa a crash data — SO com declaracao de reparo fisico valida.
 * Devolve { buffer, checksums, aceitavel, declaracao } em caso de sucesso,
 * ou { erro } (falha segura) quando nao ha mapeamento ou falta a declaracao.
 * NUNCA altera o buffer original.
 */
function limparCrash(bufOriginal, perfil, opcoes = {}) {
  const regs = regioesCrash(perfil);
  if (regs.length === 0) {
    return { erro: 'este airbag nao tem a regiao de crash data mapeada — operacao recusada' };
  }
  if (!declaracaoValida(opcoes.declaracaoReparo)) {
    return { erro: 'limpar crash data exige declaracao de reparo fisico (responsavel + OS + reparoFisicoFeito)' };
  }
  const buf = editor.clonar(bufOriginal);
  for (const r of regs) {
    buf.fill(bytePadrao(r), r.offset, r.offset + r.tamanho);
  }
  const checksums = editor.aplicarChecksums(buf, perfil);
  return {
    buffer: buf,
    checksums,
    aceitavel: editor.temChecksums(perfil),
    declaracao: { ...opcoes.declaracaoReparo, ts: opcoes.ts || Date.now() },
  };
}

module.exports = { detectarColisao, limparCrash, regioesCrash, declaracaoValida };
