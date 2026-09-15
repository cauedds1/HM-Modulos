# Pendências e perguntas em aberto

> Lista viva do que ainda precisa de resposta antes ou durante a construção.
> Atualizada a cada sessão de estudo.

Última atualização: 15 set 2026

## Travam a entrega

| # | Pendência | Quem resolve | O que trava |
| --- | --- | --- | --- |
| **P1** | Dumps reais de BCCM e airbag (e injeção) com KM e VIN conhecidos | Mecânico | **Parcial** — recebidos dumps de Basalt e C3, incluindo **antes/depois de painel com KM conhecida**. Leitura/escrita do painel resolvidas. Faltam Aircross e airbags com KM anotada. |
| **P1b** | Quebrar o checksum de 4 bytes por registro do anel de KM (BCCM) | Eu (com os dumps) | ~~Gravar KM~~ **RESOLVIDO (15 set)** — é CRC-32 refletido numa janela específica + XOR `0xE38A6876`. Provado byte a byte. Ver `descobertas-basalt.md` e `src/core/psa.js`. Falta só a codificação da KM do **airbag**. |
| **P2** | O SistemaHMMecanica existe em outro lugar (qual schema?) ou o modelo da OS é definido aqui? | Cliente | Integração com a OS (toda a Fase 2). |

## Não travam começar, mas precisam de resposta

| # | Pendência | Observação |
| --- | --- | --- |
| **P3** | Nome do produto | "Enigma" é marca de terceiro. Precisa de nome próprio. Só afeta a tela inicial. |
| **P4** | Interface de hardware para OBD (Fase 3) | J2534 ou adaptador CAN dedicado; ELM327 comum não atende. |
| **P5** | Revisão do modelo de laudo por advogado | Recomendação ao mecânico. |
| **P6** | Onde os dados moram no módulo (EEPROM / flash / ferramenta dedicada) | **Parcial** — Basalt: painel BCCM = EEPROM 95512 (64 KB), airbag = 95256 (32 KB). Confirmar C3/Aircross. |

## Perguntas para trazer do mecânico

- [ ] Ele consegue extrair os dumps? (o pré-requisito de tudo) — **SIM, já mandou dumps reais.**
- [x] O serviço é o do vídeo (carro batido/alagado, troca de módulo)? — **CONFIRMADO (27 ago):
  "sistema parecido do vídeo", "se eu quiser trocar o módulo ou painel", "casar aqui as
  informações, chassi e km". É exatamente a operação central mapeada.**
- [x] Ele quer o eixo **Chave/imobilizador** no produto final? — **SIM, incluir tudo.**
- [ ] Qual equipamento de bancada ele já tem? (Dash Tool / XProg / Orange5 / outro)
- [x] Vai haver mais de um operador na oficina? — **dono + operadores com permissões.**
- [ ] Fechar modelo de cobrança do desenvolvimento (ver `precos-mercado.md`).

## Eixo Chave — riscos a confirmar (área 15 do catálogo, "a estudar")

- É criptografia antifurto, não edição de arquivo. Mais pesado que o resto.
- Pode exigir hardware de programação de chave, não só programador de dump.
- Parte da chave pode estar protegida e não visível só no dump.
- **Não prometer prazo até ver um módulo real.**

## Material recebido (histórico do estudo)

- Vídeo 1 (Enigma) — BCCM + airbag, sincronismo de KM e VIN, recálculo de
  checksum. Base do escopo v0.1.
- Vídeo 2 (Enigma) — kit em bancada (injeção + BCCM + airbag + chave),
  imobilizador/transponder, troca de painel e VIN, peça de sucata. Gerou a
  área 15 (Chave e imobilizador).
- 4 dumps reais (27 ago) — Basalt, mesmo VIN, 2 painéis (25.100 e 85.219 km) +
  2 airbags. Permitiram mapear VIN e KM por comparação diferencial. Análise em
  `descobertas-basalt.md`. **Dumps guardados fora do repositório.**
- Material do mecânico (15 set) — painel C3 **antes/depois com KM conhecida**
  (157.383 → 60.200), airbag original/reset e airbag com KM/VIN anotados.
  **Permitiu quebrar o código de proteção da PSA (P1b) e mapear a crash data
  do airbag.** Análise na seção "15 set" de `descobertas-basalt.md`. Dumps fora
  do repositório.
