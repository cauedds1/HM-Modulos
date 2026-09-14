# Base de conhecimento — projeto HM Módulos

> Documento de memória do projeto. Reúne tudo que foi levantado no estudo,
> para que na hora de construir nada se perca. Atualizado a cada nova
> informação. **Estado atual: CONSTRUÇÃO (etapa E3) — motor testado e
> esqueleto do programa em andamento; gravação aguarda o material da E1.**

Última atualização: 14 set 2026 (ver diário de evolução na seção 8)

---

## 1. O que é o projeto

Ferramenta de bancada para reparar e sincronizar os arquivos de memória
(dumps) dos módulos eletrônicos dos Citroën **C3, Aircross e Basalt** da
geração atual (2023 em diante). Cliente final: uma oficina (HM Mecânica).
O desenvolvimento é feito para o mecânico, que será quem opera.

A referência é uma ferramenta de terceiro (marca "Enigma"), demonstrada em
dois vídeos. **"Enigma" é marca de terceiro — não usar no produto.**

---

## 2. Conhecimento técnico levantado

### 2.1 Os módulos do carro

- **BCCM** — concentra em um módulo só o que antes era body computer + BSI +
  painel de instrumentos. É o módulo central desses carros.
- **Módulo de airbag** — guarda crash data e trabalha casado com o BCCM.
- **Módulo de injeção** — participa do sistema antifurto (imobilizador).
- **Transponder / chave** — autentica com o sistema para liberar a partida.

### 2.2 Os "casamentos" entre módulos (o cerne do serviço)

1. **BCCM ↔ airbag**, por **VIN + quilometragem**.
   Se um dos dois diverge (colisão, água, troca de módulo), o painel apaga a
   quilometragem e mostra erro. Confirmado nos dois vídeos (desligar o airbag
   → painel dá erro em vez de mostrar KM).

2. **Chave ↔ BSI/BCCM ↔ injeção**, pelo sistema **imobilizador (antifurto)**.
   Sem o transponder casado, o LED fica "procurando", os bicos não acionam e o
   carro não pega. Com a chave casada, o LED pisca alternado e libera a
   partida. Demonstrado no segundo vídeo.

### 2.3 Como os dados ficam gravados no dump

- A **quilometragem** raramente está gravada "limpa". Pode estar:
  invertida (endianness), em complemento de 1, com XOR de chave fixa, em BCD,
  ou com fator de escala. Costuma ter **réplicas espelhadas** (o mesmo valor
  em 2–3 lugares dentro do módulo).
- Cada bloco alterado tem um **checksum** que precisa ser recalculado para o
  módulo aceitar o arquivo. Algoritmo varia por fabricante.
- O **VIN** são 17 caracteres ASCII (sem as letras I, O, Q).

### 2.4 Fluxo de bancada (como o serviço acontece de verdade)

```
CARRO → remove módulos → programador LÊ o chip → arquivo .bin
                                                     ↓
                                          NOSSO SOFTWARE
                                   (diagnostica, sincroniza, salva)
                                                     ↓
CARRO ← reinstala módulos ← programador GRAVA ← arquivo .bin corrigido
```

- O **nosso software nunca toca no carro** (nas fases 1 e 2). Ele edita
  arquivo. Ler e gravar é feito com programador de bancada que o mecânico já
  usa: **Dash Tool, XProg, Orange5** (o vídeo usa Dash Tool).
- Onde os dados moram dentro do módulo (EEPROM 95xxx separada, flash do MCU,
  ou ferramenta dedicada) define qual equipamento é preciso — **a confirmar
  com módulo real**.

### 2.5 Limite importante — a KM não vive só nesses módulos

A quilometragem também aparece em motor, ABS, câmbio, e em registros
externos (telemetria da montadora, concessionária, vistoria, seguradora).
Sincronizar BCCM+airbag resolve o erro no painel, mas **não deixa o carro
"limpo" numa leitura completa de scanner**. Num reparo honesto o carro fica
consistente; numa fraude, os outros módulos entregam a divergência. Isso é
argumento a favor do laudo e da futura leitura multi-módulo (Fase 3).

---

## 3. Os eixos do produto (o que ele vai fazer)

O produto tem **três eixos técnicos**, todos catalogados:

| Eixo | O que é | Estado |
| --- | --- | --- |
| **Arquivo** | KM, VIN, airbag, reparo, troca de painel | Construir — escopado |
| **Chave / imobilizador** | Casar chave, sair do imobilizado, injeção de sucata | **A estudar** — precisa módulo real, talvez hardware |
| **OBD** | Ler pela tomada (F3) e gravar pela tomada (F4) | F3 viável; F4 condicional (seed/key) |

Decisão do cliente (27 ago): **incluir tudo no escopo** — "melhor sobrar do
que faltar". No front cada eixo vira uma aba separada, para não poluir a tela.

Detalhe completo das 92 funcionalidades em `funcionalidades.html` (área por
área, com fase e núcleo/secundária/a-estudar).

---

## 4. Decisões já tomadas

- **Plataforma:** Electron empacotado para Windows (Tauri descartado — não
  compila no ambiente; webkit2gtk ausente).
- **Núcleo:** JavaScript puro, sem dependências, testável fora da interface.
- **Perfis declarativos:** cada módulo é um arquivo de perfil (JSON), não
  código. Módulo novo = perfil novo. É o que evita release por ECU.
- **Quatro operações de arquivo**, sem campo genérico de "definir KM". Em três
  o operador não digita número. Ver README raiz.
- **Registro encadeado por hash, não apagável por ninguém** — nem pelo dono.
- **Original nunca sobrescrito**; toda saída é arquivo novo + backup + hash.
- **Front por abas, um eixo por aba.**
- **Vínculo com OS obrigatório** (mas o SistemaHMMecanica está vazio hoje —
  ver P2).

### Segurança, estrutura e confiabilidade (detalhe em `seguranca-estrutura.html`)

- **Princípio:** na dúvida o software **para**, nunca grava lixo. Módulo
  queimado por arquivo ruim é o pior resultado.
- **Arquivo:** nunca sobrescrever original; backup automático; SHA-256 de
  entrada e saída; desfazer sempre possível.
- **Antes de gravar:** detectar leitura ruim (tamanho errado, bytes vazios,
  cópias internas discordantes); prévia; validar checksums e coerência.
- **Depois de gravar:** conferência por hash (releitura do módulo == arquivo
  gerado).
- **Confiança:** testes automáticos do núcleo + testes contra dumps reais
  (ler 25.100 tem que dar 25.100); operação tudo-ou-nada; log técnico de erro.
- **Acesso:** login por operador, papéis, senha com hash forte (Argon2/bcrypt),
  bloqueio após tentativas.
- **Registro:** cadeia de hash, append-only, não apagável nem pelo dono.
- **Estrutura:** camadas isoladas (núcleo sem dependências / perfis JSON /
  banco SQLite local / adaptadores / UI Electron com processos separados).
- **LGPD:** VIN + KM + cliente = dado pessoal. Local, finalidade de reparo,
  retenção definida, dumps nunca no repositório.
- **Produto:** perfis assinados e embutidos; licenciamento por instalação
  (liga com o modelo de cobrança — sem isso não há mensalidade sustentável).

### Limites de construção (fora de escopo por finalidade)

Estes não serão construídos, e o motivo é técnico/de finalidade, não moral:

- Apagar crash data de airbag sem reparo físico (risco de vida).
- Gravar VIN arbitrário (diferente de sincronizar o VIN do próprio carro).
- Modo lote / atalho de zerar KM / operar sem OS.
- Apagar do módulo a marca de que a KM foi alterada (flag de plausibilidade).
- Distribuir os perfis como arquivo solto.

Nada fora do veículo (servidor da montadora, papel) — impossível por natureza.

---

## 5. Componentes já escritos (núcleo, Fase 1)

| Arquivo | O que faz | Estado |
| --- | --- | --- |
| `src/core/codec.js` | ler/gravar campos: endianness, complemento, XOR, BCD, fator, réplicas, VIN | pronto, sem testes ainda |
| `src/core/checksum.js` | 9 algoritmos de checksum (sum8/16/32, sum16le, xor8, sum8_neg, crc16ccitt, crc16modbus, crc32) | pronto, CRCs conferidos contra vetores padrão |

Nota: o `codec.js` já cobre o padrão de KM do Basalt (fator ×10, LE, réplicas).
O checksum-por-registro do anel de KM ainda não está entre os algoritmos — é
o que falta descobrir (ver `docs/descobertas-basalt.md`).

Falta do núcleo: perfis, detecção de módulo, motor de dump, sincronização,
registro, laudo, permissões, integração OS, interface.

---

## 6. O que destrava tudo

Os três eixos travam no **mesmo ponto: dumps reais**.

- Sem dumps, não há como levantar os perfis (nem KM/VIN, nem antifurto).
- 5 ou 6 pares de BCCM+airbag com KM e VIN conhecidos permitem começar.
- O mesmo módulo na bancada responde se o eixo Chave é viável.

**Pedido concreto ao mecânico:** ler BCCM + airbag (e, se der, injeção) de
alguns C3/Aircross/Basalt que passarem, anotando KM e VIN de cada um.

### Estado da P1 — parcialmente resolvida (27 ago 2026)

Recebidos os **primeiros dumps reais**: 4 arquivos de um **Basalt** (2 painéis
BCCM em KMs diferentes, 2 airbags). Resultado da análise:

- **Leitura de VIN e KM: resolvida** para BCCM e airbag do Basalt. Offsets e
  codificação confirmados por comparação diferencial.
- **Gravação: falta uma peça** — o checksum de 4 bytes por registro do anel de
  quilometragem. É o próximo trabalho técnico.

Detalhe completo em `docs/descobertas-basalt.md`. Continua valendo o pedido de
**mais pares** (mesmo módulo, KMs diferentes) — é o que permite quebrar o
checksum e validar, e faltam dumps de C3 e Aircross.

> Dumps de veículo **nunca** entram no repositório nem são colados no chat —
> são dados reais de cliente (VIN, KM). `.gitignore` já bloqueia `.bin`,
> `.eep`, `.hex` e a pasta `/dumps/`.

---

## 7. Documentos do projeto

| Documento | Conteúdo |
| --- | --- |
| `README.md` (raiz) | visão geral, princípio de projeto, estado |
| `docs/escopo.html` | escopo v0.1: 4 operações, permissões, registro, OS, fases |
| `docs/funcionalidades.html` | catálogo das 92 funcionalidades por área/fase |
| `docs/base-conhecimento.md` | **este** — memória técnica e decisões |
| `docs/descobertas-basalt.md` | mapa dos dumps reais do Basalt (offsets, codificação, o que falta) |
| `docs/pendencias.md` | perguntas em aberto e o que trava cada uma |

Artifacts publicados (apresentação):
- Escopo: https://claude.ai/code/artifact/aaef9b40-16bd-4ee8-af63-24fd59da38d1
- Funcionalidades: https://claude.ai/code/artifact/9e71f9ef-f3b1-407a-821b-4853b18340a3

---

## 8. Diário de evolução (aprendizados acumulados)

> Seção aditiva — cada avanço entra aqui, nada é removido. Do mais recente ao
> mais antigo.

### 28 ago 2026 — arquivos do C3, ferramental e ataque ao checksum

**Confirmações do mecânico (por WhatsApp, sobre o app de teste):**
- Aprovou a leitura: "reconhecer o arquivo", "chassi e km" — já faz.
- Pediu explicitamente a escrita: **"e também alterar os parâmetros"** = gravar
  KM/VIN. É a função que falta (depende de quebrar o código de proteção).
- Vai **ler também a ECU (motor)** e adicionar — hoje só painel e airbag.
- Vai mandar **mais arquivos com KM diferentes, já anotadas** (via "Khauan").

**Ferramental deles (contexto novo):**
- Usam o programador de bancada **iProg Pro** + IDE de script **Emvima**
  (iprog.pro). Confirma: leem/gravam EEPROM na bancada, arquivos são dumps
  crus. Adaptadores EEPROM / CAN / BDM. No futuro nossa ferramenta pode até
  gerar script pra esse programador.

**Arquivos novos analisados (C3):**
- Painel C3 (VIN 935CEFC2CRB5515**) e airbag C3 "RESET" → são **módulos de
  teste resetados/virgens** (airbag em branco; painel com odômetro zerado).
- O "3000" do nome do painel é **constante de fábrica** (offset 0x391E,
  presente também no Basalt), **não é a quilometragem**.
- **C3 e Basalt usam o MESMO layout de painel** → um perfil só cobre os dois
  (e provavelmente o Aircross). Menos trabalho, mais cobertura.

**Ataque ao código de proteção (checksum-por-registro) — status:**
- Estrutura do registro de KM confirmada: `[KM×10 4b LE][código 4b][00 00]
  [contador 2b]`.
- O código de 4 bytes depende de **KM + contador** (mesma KM, contador
  diferente → código diferente).
- Testados ~11 CRC32 padrão + somas em 8 enquadramentos → **nenhum bate**. É
  checksum **próprio da PSA**.
- Pista: painel resetado com KM=0 e contador=0 tem código **não-nulo** → o
  código cobre **mais que KM+contador** (região fixa maior ou inclui o VIN).
- **Falta material** para quebrar: o ideal é **antes/depois do mesmo módulo
  com KM conhecida** gravada por ferramenta que funcione. O mecânico já se
  ofereceu para fornecer isso.
- Detalhe técnico completo em `docs/descobertas-basalt.md`.

**App de teste:** passou a **reconhecer módulo resetado/virgem** (VIN/KM em
branco), em vez de mostrar valores sem sentido.

### 27 ago 2026 — mercado, preço e forma de entrega

**Escassez do sistema (pesquisa):**
- Como categoria, calculadora automotiva **não é escassa** (CarroTec, Alpha
  Calculator, Tael ProgMaster, UmGênio).
- Para os **PSA novos** (C3/Basalt/Aircross geração atual) a cobertura
  **parece escassa** — não achei suporte específico. É o nicho.
- Por que é escasso: carro novo (ferramenta chega atrasada), módulo de tipo
  novo (BCCM junta BSI+painel), volume ainda baixo (grandes despriorizam),
  proteção maior nos módulos novos, PSA historicamente menos coberta no BR.
- É uma **janela de oportunidade** que fecha em ~2-3 anos, quando os grandes
  mapearem. Vantagem de quem entra agora com os arquivos.

**Prova de viabilidade (honesto):**
- Provado: dá para **ler** (nós fizemos, testável) e o todo é possível (a
  Enigma, operador pequeno, já faz).
- NÃO provado ainda: a **escrita** (depende de quebrar o código) e o eixo
  **chave/imobilizador** (pode exigir hardware). Sem garantia de "perfeito em
  tudo" — software desse tipo evolve por perfis, não é "pronto para sempre".

**Preço (referência de mercado):**
- Oficina cobra do cliente: R$ 150–250 (troca de painel) a R$ 600+ (serviço
  complexo).
- Concorrente CarroTec: **R$ 1.200/ano** de assinatura.
- Cobrança do desenvolvimento: modelo recomendado = **entrada + mensalidade
  menor** (mensalidade remunera perfis novos e sustenta com anti-cópia).
- Ressalva do usuário (válida): sendo produto novo de dev solo, **não faz
  sentido cobrar acima** de um concorrente consolidado — igualar ou ficar
  abaixo, e cobrar pelo que a CarroTec não faz (os PSA novos). Detalhe em
  `docs/precos-mercado.md`.

**Forma de entrega (decisão):**
- **Web = só para teste** (o app atual). **Produto final = programa instalado
  (.exe, Windows)**. Motivos: arquivo do cliente não sai da máquina (LGPD),
  funciona offline, banco local do registro/laudo, licenciamento anti-cópia,
  e falar com hardware na fase OBD. Mesmo código do teste vira a tela do
  programa instalado.
- Confirmar com o usuário: oficina roda Windows (assumido).

### Documentos relacionados criados neste período
- `docs/seguranca-estrutura.html` — segurança, estrutura e confiabilidade.
- `docs/precos-mercado.md` — preços e modelo de cobrança.
- `docs/descobertas-basalt.md` — mapa técnico dos dumps (atualizado com C3).
- `web/index.html` + `profiles/basalt-*.json` — primeira versão de teste.
- Artifact do app de teste: https://claude.ai/code/artifact/7d33587b-0693-4271-80c9-95e3a0b57f6f
- Artifact de segurança: https://claude.ai/code/artifact/138dbe02-4864-4879-8c8d-af8e0f812828

### 28 ago 2026 (tarde) — inteligência sobre o iProg Pro

Levantamento detalhado do iProg Pro (o programador que o mecânico usa).
Documento próprio: `docs/referencia-iprog.md`. Pontos que mudam a estratégia:

- **Arquitetura por scripts valida a nossa por perfis.** iProg cobre módulos
  via scripts `.ipp`/Lua comprados/desenvolvidos à parte (IDE Emvima). Mesma
  filosofia que os nossos perfis JSON.
- **Não competimos com o hardware — complementamos.** iProg é quem lê/grava o
  chip; nosso software é o cérebro do arquivo. O fluxo encaixa:
  iProg lê → nosso software conserta o `.bin` → iProg grava.
- **Cobertura do iProg depende de existir script para o módulo.** Para os PSA
  novos o script pode não existir — reforça o nicho. Pergunta ao mecânico:
  existe calculadora/script iProg que faz a KM do C3/Basalt novo?
- **Checklist de completude** (funções do iProg × nosso escopo) em
  `referencia-iprog.md`. Ideias novas possíveis: rádio/multimídia,
  extração de PIN, conversão milhas→km. Flags mantidas (mesma linha da KM):
  crash data sem reparo e DPF OFF ficam fora por segurança/lei.

### 14 set 2026 — airbag crash data incluído (só na forma documentada)

Decisão do cliente: **incluir** a limpeza de crash data do airbag, mas
**nunca na forma crua**. Sai da lista de "fora de escopo" e entra como
operação restrita, com salvaguarda de segurança:

- Só o responsável técnico acessa (aba "Airbag").
- Exige **declaração obrigatória de reparo físico** do sistema de airbag
  (airbags, pré-tensionadores, módulo) antes de liberar.
- Exige descrição do que foi reparado e OS vinculada.
- Fica **registrado** (com a declaração) e entra no laudo.
- O botão cru "batido → limpo" sem reparo **não existe** — não tem uso
  legítimo e deixaria um carro que não dispara o airbag.

Estado técnico: a operação (fluxo + declaração + registro) já está no app,
mas a limpeza em si fica **pendente** — depende do código de proteção do
airbag (P1b) e de **mapear onde fica o crash data**, o que exige um dump de
airbag **batido** para comparar com um limpo. Novo item de material a pedir
ao mecânico.
