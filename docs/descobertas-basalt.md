# Descobertas dos dumps reais — Basalt (BCCM + airbag)

> Análise dos primeiros dumps reais recebidos (27 ago 2026). É a semente do
> primeiro perfil de módulo. **Confirmado por comparação diferencial** entre
> dumps do mesmo módulo com quilometragens diferentes.
>
> Dados de veículo reais (VIN, KM) não ficam aqui em cru — o VIN de exemplo
> aparece mascarado. Os dumps em si nunca entram no repositório.

## Material analisado

Quatro dumps do **mesmo veículo** (Citroën Basalt), VIN `935CPFCA5SB5569**`:

| Papel | Módulo | Tamanho | KM |
| --- | --- | --- | --- |
| Painel A | BCCM / painel (DFRASH) | 64 KB | 25.100 |
| Painel B | BCCM / painel (DFRASH) | 64 KB | 85.219 |
| Airbag A | Airbag | 32 KB | 25.100 |
| Airbag B | Airbag | 32 KB | ~85.2xx (original) |

Ter o mesmo módulo em duas quilometragens permitiu localizar os campos por
diferença (o que muda entre os dois É o que depende da KM).

- Painel (BCCM): 64 KB → compatível com EEPROM **95512**.
- Airbag: 32 KB → compatível com EEPROM **95256**.

## BCCM / painel — mapa parcial confirmado

### VIN (chassi)
- **Offset `0x0B00`**, 17 bytes ASCII. Idêntico nos dois painéis. ✓
- Perto dele: string `"BCCM"` (~`0x0AC1`), part numbers `"4441811002"` (`0x1BC3`)
  e `"C3125011"` (`0x1BF2`) — candidatos a identificação/assinatura do perfil.

### Quilometragem
- **Codificação: KM × 10, little-endian** (unidade de 100 m).
  - Painel 25.100 → grava `251000` (`78 D4 03`).
  - Painel 85.219 → grava `852199` (display trunca 852199/10 = 85.219). ✓
- Guardada em **anel de registros** (wear leveling), não em posição única.
  - Registro-âncora observado em **`0x4BA0`**, com **cópia espelhada em `0x4BB0`**.
  - Cópia adicional relacionada em `0x4BC0`.
  - Estrutura do registro (12 bytes): `[KM×10 : 3-4 b LE][checksum : 4 b][?? 2 b][contador : 2 b]`.
  - O **checksum de 4 bytes muda junto com a KM** (25.100 → `c170bacc`;
    85.219 → `adb16baf`), e o contador também (335 → 244).
  - Há um **segundo banco do anel** espelhando a mesma faixa por volta de
    `0x97E0–0x9B70` (o conteúdo dos registros bate com o bloco `0x4B90+`).

### Pendência crítica do BCCM
Ler KM: **resolvido**. Gravar KM: **falta quebrar o checksum de 4 bytes por
registro**. Sem ele o painel rejeita o arquivo. Para gravar uma KM nova é
preciso reescrever todos os registros do anel (os dois bancos) e recalcular o
checksum de cada um. Atacar com os pares casados (registro + checksum) dos
dumps disponíveis. **É a peça que separa "só leitura" de "leitura e escrita".**

## Airbag — mapa parcial confirmado

### VIN (chassi)
- **Offset `0x4C5E`**, 17 bytes ASCII (precedido de um byte `{`). Idêntico nos
  dois airbags. ✓
- Outras strings: `"5E1Y000008468"` (`0x451E`), `"RBG"` (`0x5687`),
  números longos em `0x3E46` e `0x4856` — candidatos a assinatura.

### Quilometragem
- **Codificação: valor cru (sem ×10), 2 bytes little-endian.**
  - Airbag 25.100 → grava `0C 62` (= `0x620C` = 25100). ✓
- Também em **registros repetidos/espelhados**, cada um precedido de um
  **hash de 4 bytes** que muda com a KM (no airbag A, KM constante → hash
  constante `d2c61580`).
- No airbag B, os registros carregam um contador de 3 bytes crescente
  (`?? 4C 01`), padrão de anel igual ao do painel.

### Pendência crítica do airbag
Mesma do painel: ler resolvido; gravar depende de quebrar o hash de 4 bytes
por registro.

## O que isto significa para o produto

- O **primeiro perfil real** (Basalt BCCM + airbag) já existe em parte:
  detecção por tamanho, leitura de VIN e de KM estão mapeadas e confirmadas.
- A operação **Diagnosticar** (só leitura) já é construível para o Basalt.
- As operações que **gravam** (Reparar, Sincronizar, Restaurar KM) dependem de
  resolver o checksum-por-registro. É o próximo trabalho técnico.
- O padrão observado (KM×10 no painel, anel de registros com checksum próprio,
  bancos espelhados) é típico de Stellantis/PSA e deve se repetir no C3 e no
  Aircross — a confirmar quando chegarem dumps desses.

## Atualização 28 ago — C3, ataque ao checksum e ferramental

### Ataque ao código de proteção (checksum-por-registro)
- Estrutura do registro de KM confirmada (16 bytes):
  `[KM×10 : 4b LE][código : 4b][00 00][contador : 2b][padding]`.
- O código de 4 bytes depende de **KM e do contador** (dois registros com a
  mesma KM e contadores diferentes têm códigos diferentes).
- Testados ~11 variantes de CRC32 padrão + somas sobre 8 enquadramentos de
  entrada → **nenhum bateu**. É checksum **próprio da PSA**, não padrão.
- Pista nova (C3): registro com KM=0 e contador=0 tem código **não-nulo**
  (`b1c2a1a3`). Um checksum simples de km+contador daria zero → o código cobre
  **mais que km+contador** (provável região fixa maior, ou inclui o VIN).
- **Faltam pares limpos.** Com poucos exemplos de KM conhecida não dá para
  quebrar um checksum próprio de 32 bits. O que resolve: **antes/depois do
  mesmo módulo com KM conhecida** gravada por ferramenta que funcione.

### C3 vs Basalt — mesmo layout de painel
- Painel C3 (`935CEFC2CRB551519`): VIN em `0x0B00`, mesma região de KM em
  `0x4BA0`, mesmas constantes de configuração (ex.: `0x391E` = 3000 é
  **constante de fábrica presente nos dois**, NÃO é a KM). Um mesmo perfil
  cobre C3 + Basalt (e provavelmente Aircross).
- Os dois arquivos de teste do C3 são **módulos resetados/virgens**: airbag
  com VIN e KM em branco (`FF`), painel com odômetro zerado. Servem para
  testar gravação e o estado "em branco" — não são um carro a 3.000 km.
- O app passou a **reconhecer módulo resetado** (VIN/KM em branco).

### Ferramental do mecânico (contexto)
- Eles usam o programador de bancada **iProg Pro** com a IDE de script
  **Emvima** (iprog.pro). Confirma o fluxo: leitura/gravação de EEPROM na
  bancada, arquivos são dumps crus. Adaptadores EEPROM/CAN/BDM.
- Ele pretende **ler também a ECU (motor)** e mandar mais arquivos com
  **KM diferentes, já anotadas** (via Khauan) — exatamente o material que
  falta para o ataque ao checksum.

## Próximos passos técnicos

1. Quebrar o checksum de 4 bytes por registro (painel e airbag).
2. Confirmar os limites exatos de cada faixa de checksum e dos dois bancos.
3. Formalizar o perfil `basalt-bccm` e `basalt-airbag` no formato declarativo.
4. Pedir mais pares (mesmos módulos, KMs diferentes) para validar o checksum.
5. Repetir para C3 e Aircross quando houver dumps.

### Atualização 28 ago (noite) — KM do airbag ainda não confirmada

- A leitura da KM do airbag no offset `0x146` (2 bytes LE) dá o valor certo
  para o airbag **sincronizado** (25.100 → 25.100), mas para o airbag
  "original" dá 19.661 — provavelmente um **contador**, não o hodômetro.
- Voto por frequência não isola a KM (dominado por bytes de preenchimento
  `EBEB`/`FFFF`). Os dois airbags têm distribuição idêntica exceto na região
  de registros — confirma o anel.
- **A KM do painel chega a 85.219, que NÃO cabe em 2 bytes (máx 65.535).**
  Logo o airbag guarda a KM em mais bytes ou com outra codificação — a
  suposição de "2 bytes cru" está incompleta.
- **Pendência:** confirmar o formato da KM do airbag exige airbags com KM
  **conhecida/anotada** (idealmente o mesmo airbag em KMs diferentes). Até lá,
  o app marca a KM do airbag como "leitura preliminar" (honesto). VIN do
  airbag continua confirmado.

---

## Atualização 15 set 2026 — ★ CÓDIGO DE PROTEÇÃO DECIFRADO (P1b resolvido) ★

Material novo do mecânico: **antes/depois de um painel C3 com KM conhecida**
(original ~157.383 km → gravado 60.200 km por ferramenta de referência), mais
airbags original/reset e um airbag com KM/VIN anotados. Isso permitiu, enfim,
**quebrar o checksum próprio da PSA** por análise diferencial. Tudo abaixo está
**verificado em código** (`src/core/psa.js`, testes em `test/psa.test.js`) e
provado ponta a ponta.

### Estrutura real da KM no painel (corrige o que se supunha antes)
A KM **não** fica no offset `0x4BA0` (aquela era uma leitura antiga incorreta —
lá o valor nem é a KM). A KM vive num **anel de registros de 16 bytes**:

```
[0..3]  hash de 4 bytes (o "código de proteção")   — little-endian
[4..5]  00 00
[6]     dígito verificador = (km0+km1+km2) & 0xFF   (soma dos 3 bytes da KM)
[7..11] 00 00 00 00 00
[12..14] KM × 10, little-endian   (ex.: 60.200 km → 602000 → 90 2F 09)
[15]    00
```

O painel guarda **dois contadores** em anéis distintos:
- **odômetro principal** (a KM real, alta) — é o que se corrige;
- **contador secundário** (valores baixos, ~137) — **não se mexe**.
A ferramenta de referência só reescreveu os registros do odômetro principal
(36 registros) e deixou os 8 do secundário intactos. Nosso motor faz igual.

### A FÓRMULA DO HASH (o P1b)
```
hash = CRC32_refletido( [km0, km1, km2, 0,0,0,0,0,0,0] )  XOR  0xE38A6876
```
- `CRC32_refletido` = **CRC-32 padrão** (poly `0xEDB88320`, o mesmo do ZIP/PNG),
  init=0, xorout=0;
- entrada = os 3 bytes da KM (ordem de memória) **+ 7 bytes 0x00** (10 bytes);
- resultado gravado em **little-endian** nos bytes `[0..3]` do registro.

Ou seja: a PSA usou o **CRC-32 clássico**, só que numa janela específica com
uma constante XOR — não é algoritmo exótico. O que faltava era o material para
descobrir a janela.

**Como foi quebrado:** colhidos 18 registros (km→hash) do histórico do anel;
provado por álgebra GF(2) que o hash é **linear** (tipo CRC); recuperado o
polinômio `0xEDB88320` pela recorrência do LFSR sobre 8 bits consecutivos;
achada a janela (7 bytes de enchimento) e a constante `0xE38A6876` por varredura.

**Validação (nível "prova"):**
- hash confere em **44/44 registros** dos dois dumps (original e modificado);
- `corrigirKmPainel(original, 60200)` reproduz o arquivo da ferramenta de
  referência **byte a byte (0 diferenças)** — motor de leitura E escrita do
  painel provado ponta a ponta.

### Airbag — VIN
- **VIN do airbag: offset `0x4C36`** (17 ASCII). *(Antes supunha-se `0x4C5E` —
  corrigido.)*

### ★ Airbag — KM DECIFRADA (adendo, mesmo carro antes/depois)
O mecânico confirmou que o painel e os airbags são do **mesmo carro** (VIN
`935CDNFXDRB522343`) e que o airbag `..._KM_60200_..._ENIGMA` é o **depois** do
airbag original — ou seja, temos antes (157.383) e depois (60.200) do airbag,
igual ao painel. A foto do painel real mostra **157.383 km**, batendo com a
leitura. Isso permitiu decifrar a KM do airbag.

- **A KM do airbag NÃO fica num campo único.** Fica num **anel de registros**
  espalhados pelo dump (não alinhados), nas posições
  `0x3C6A, 0x3CE2, 0x3D5A, 0x3E02, 0x403A, 0x42F2, 0x436A, 0x5872, 0x5962,
  0x59C2, 0x5C72, 0x5F0A`.
- Cada registro: **`[hash 4 bytes, big-endian][KM 3 bytes LE, ×1]`**.
  - Odômetro = **maior KM** do anel (o mais recente). No original, os registros
    vão de 157.263 a 157.383 (histórico); o topo (157.383) é o odômetro.
- **Fórmula do hash (verificada em 36/36 registros):**
  `hash = CRC32_refletido( [km0, km1, km2, 0] ) XOR 0xD343B576`, gravado em
  **big-endian**. É o **mesmo CRC-32** do painel (poly `0xEDB88320`), com janela
  e constante próprias. A constante `0xD343B576` é o hash do registro vazio
  (km=0) — o famoso `D3 43 B5 76`.
- **Prova:** `corrigirKmAirbag(original, 60200)` reproduz o arquivo de
  referência (o airbag "Paulo") **byte a byte (0 diferenças)**.
- Implementado em `src/core/psa.js` (`lerKmAirbag`, `corrigirKmAirbag`).

### ⚠️ Correção importante — o que se pensou ser "crash data" é a KM
Esses 12 registros tinham sido **erroneamente** rotulados como *crash data* (a
partir do diff original × "RESET"). Na verdade o arquivo **RESET zerou a KM**
(km=0 → hash `D3 43 B5 76`), não a colisão. Logo:
- **A crash data do airbag ainda NÃO está mapeada.** Mapear exige um dump de
  airbag **efetivamente batido** (com colisão registrada) para comparar.
- O perfil e a interface foram corrigidos para não mexer nesses registros como
  se fossem colisão (evita zerar a KM por engano).

### O que isto destrava
- **E1 (quebrar proteção): CONCLUÍDO** para painel **e airbag** PSA.
- **E2 (escrita): pronto e provado** para os dois — `psa.lerKmPainel/
  corrigirKmPainel` e `psa.lerKmAirbag/corrigirKmAirbag` (0 diferenças vs
  referência).
- **Sincronismo de KM painel↔airbag: agora possível de ponta a ponta.**
- **Falta:** crash data do airbag (precisa de airbag batido); confirmar
  Aircross; a parte de chave/OBD (fases futuras).

> Nota de método: nenhum dump entrou no repositório. Os vetores de teste usam a
> KM 60.200 (valor já citado pelo próprio cliente) e valores derivados da
> fórmula — nada que identifique um veículo.
