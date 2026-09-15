# Guia do projeto — HM Módulos

Contexto para retomar o projeto em qualquer sessão. Leia isto primeiro.

## O que é

Ferramenta de bancada (programa `.exe` para Windows, feito em Electron) para
ler, sincronizar e corrigir arquivos de memória (dumps) dos módulos **BCCM
(painel)** e **airbag** dos Citroën C3, Aircross e Basalt. Cliente: oficina
HM Mecânica. O usuário não é técnico — explique tudo em português simples.

## Onde está a documentação (a memória do projeto)

- **`docs/escopo.html`** — documento-mestre (o quê, como, estado).
- **`docs/plano-construcao.html`** — o plano da obra (etapas E0–E6).
- **`docs/base-conhecimento.md`** — memória técnica + diário de evolução (seção 8).
- **`docs/descobertas-basalt.md`** — o mapa dos dumps (offsets, código de proteção).
- **`docs/pendencias.md`** — o que trava cada etapa.
- Índice completo em `docs/README.md`.

## Arquitetura

- `src/core/` — o **motor**, JS puro e testado, sem interface:
  `codec` (ler/gravar campos), `checksum` (algoritmos), `perfil` (carrega/detecta
  perfis), `leitor` (diagnóstico), `editor` (corrigir: escreve + recalcula
  checksum), `sincronizar` (casamento), `registro` (cadeia de hash),
  `armazenamento` (persiste o registro em arquivo), `auth` (senha com scrypt).
- `profiles/` — perfis declarativos (JSON), um por módulo. `psa-bccm` cobre
  C3/Aircross/Basalt; `psa-airbag`.
- `src/main/` — Electron: `main.js` (processo principal + motor, IPC) e
  `preload.js` (ponte segura).
- `web/index.html` — a interface (renderer), que roda também como teste no navegador.
- `test/` — testes do motor. **Rodar: `npm test`** (ou `node --test test/*.test.js`).

## Estado atual

Etapa **E3** (virar programa instalável). O motor está pronto e testado. Falta:
migrar as telas para o programa, login com senha na UI, empacotar o `.exe`.

**★ Bloqueio principal (E1/P1b): RESOLVIDO (15 set 2026).** O código de proteção
do painel PSA foi decifrado com o material do mecânico (antes/depois de um painel
C3 com KM conhecida). É **CRC-32 refletido** (poly `0xEDB88320`) sobre a janela
`3 bytes de KM + 7 zeros`, XOR `0xE38A6876`. A KM vive num **anel de registros**
de 16 bytes (o antigo offset `0x4BA0` estava errado). Leitura e escrita do painel
prontas e **provadas byte a byte** em `src/core/psa.js`. A **KM do airbag também
foi decifrada** (mesmo carro antes/depois, 157383→60200): anel de registros
`[hash 4b BE][km 3b LE]`, hash = CRC-32 refletido `XOR 0xD343B576`; `lerKmAirbag`/
`corrigirKmAirbag` reproduzem a referência byte a byte. Logo **sincronismo de KM
painel↔airbag já funciona** (motor + interface). Detalhe em `descobertas-basalt.md`
(seção "15 set"). **Correção:** o que se pensava ser *crash data* do airbag eram
os registros de KM — a **crash data segue NÃO mapeada** (precisa de um airbag
efetivamente batido). **Falta ainda:** crash data do airbag; Aircross; chave/OBD.

## Convenções e regras (importantes)

- **Não commitar dumps** (`.bin`, `.eep`, `.hex`) — são dados reais de cliente
  (VIN, KM). Já bloqueados no `.gitignore`. Nunca colar conteúdo de dump no chat.
- **Não usar o nome "Enigma"** — é marca de terceiro (a referência dos vídeos).
  Nome do produto ainda a definir (P3).
- **Na dúvida, o software para** — nunca grava lixo; perfil não reconhecido → recusa.
- **O original é sagrado** — `editor.corrigir` trabalha sempre numa cópia.
- **Registro não se apaga** — cadeia de hash, append-only; adulteração é detectável.
- **Limites de segurança:** nada de apagar crash data de airbag sem reparo
  físico declarado; nada de gravar VIN arbitrário; nada de DPF off.
- Testes rodam no CI (`.github/workflows/ci.yml`) a cada push.

## Como continuar

Ler `docs/plano-construcao.html` (as etapas) e `docs/pendencias.md` (o que
trava). O passo que mais destrava valor continua sendo o **material do
mecânico** (a E1).
