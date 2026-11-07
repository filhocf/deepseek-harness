# Pesquisa fork-only — Sharp, Electron Linux e AppImage

## 1. Pergunta

Por que o runtime do DSH termina com SIGSEGV ao usar Sharp dentro do Electron Linux com `ELECTRON_RUN_AS_NODE=1`, e qual correção é adequada para o AppImage do fork?

## 2. Sintoma reproduzido

No clone do fork, a execução real do empacotamento chegou ao smoke do runtime e produziu:

```text
runtime payload: sharp
[SharpElectronLinux] Warning: Binaries provided by Electron for use on Linux may be incompatible with sharp
runtime payload: killed=false, signal=SIGSEGV
```

O estágio que falhou foi:

```text
runtime:smoke
```

O build geral e os smoke tests anteriores passaram. O processo caiu ao decodificar/usar uma imagem, não ao importar JavaScript comum.

## 3. Causa técnica

O Sharp 0.35.5 instala binários opcionais para Linux x64:

```text
@img/sharp-linux-x64
@img/sharp-libvips-linux-x64
```

O Electron Linux, por sua vez, depende de GLib/GTK do sistema. O libvips pré-compilado do Sharp incorpora sua própria cadeia de GLib. Sob Electron, símbolos `g_*` podem ser resolvidos contra a GLib exposta pelo próprio Electron, enquanto o código espera a cópia embutida no libvips. O resultado é corrupção de objetos GLib e falha nativa, sem exceção JavaScript recuperável.

A execução com Node comum funciona; a execução com Electron-as-Node falha. Isso diferencia o problema de runtime/loader de um erro de imagem ou da lógica de attachment.

## 4. Evidências consultadas

### 4.1 Sharp: Electron e Linux

A documentação e o código do Sharp 0.35.5 emitem o aviso `SharpElectronLinux`. O loader recomenda o uso de `@img/sharp-wasm32` quando o binding nativo não é compatível.

- documentação de instalação do Sharp: https://sharp.pixelplumbing.com/install#electron-and-linux
- commit que adicionou o aviso: https://github.com/lovell/sharp/commit/6a29fd55db0c569276f143a7b480c62573a7aa16

### 4.2 Histórico do problema no Sharp

- Sharp #2356 — GLib-GObject e Electron Linux: https://github.com/lovell/sharp/issues/2356
- Sharp #3082 — SIGSEGV em Electron + libvips: https://github.com/lovell/sharp/issues/3082
- Sharp #4351 — Sharp em Electron no Ubuntu 24.04: https://github.com/lovell/sharp/issues/4351
- Sharp #4469 — `metadata()` trava/cai em Electron: https://github.com/lovell/sharp/issues/4469
- Sharp #4522 — SIGSEGV/SIGTRAP em `g_object_ref`: https://github.com/lovell/sharp/issues/4522
- Sharp #4525 — crash em Electron utility process com GLib: https://github.com/lovell/sharp/issues/4525

Essas fontes distinguem duas classes de problema:

1. ABI do addon nativo, para a qual `@electron/rebuild` é relevante;
2. colisão de símbolos GLib/libvips, para a qual `@electron/rebuild` isolado não é suficiente.

O DSH está no segundo caso.

### 4.3 Discussão específica do DSH

A discussão do próprio projeto reproduz o mesmo defeito com Sharp 0.35.5:

- discussão: https://github.com/deepseek-ai/deepseek-harness/discussions/10946
- fork da implementação: https://github.com/riccelso/deepseek-harness/tree/desktop/linux-dev-sharp-electron
- commit de suporte Linux: https://github.com/riccelso/deepseek-harness/commit/3539be7
- commit da correção Sharp: https://github.com/riccelso/deepseek-harness/commit/b110d12

A implementação upstream descreve duas partes:

```text
apps/desktop/scripts/prepare-sharp-electron.ts
apps/desktop-host/src/sharp-electron.ts
```

O preparador:

- usa o pin exato do Sharp do attachment-local;
- prepara uma cópia isolada;
- compila contra libvips do sistema com `SHARP_FORCE_GLOBAL_LIBVIPS=1`;
- monta uma árvore runtime sem os `@img` nativos pré-compilados;
- executa smoke sob Electron;
- falha explicitamente quando headers/libvips ou toolchain estão ausentes.

### 4.4 Implementações relacionadas

- `@janhapke/sharp-electron`: https://github.com/janhapke/sharp-electron
- Electron rebuild: https://github.com/electron/rebuild
- Documentação Electron sobre módulos nativos: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- electron-builder e Sharp/ASAR: https://github.com/electron-userland/electron-builder/issues/6200
- Exemplo de `asarUnpack` para Sharp: https://github.com/mvdicarlo/postybirb/blob/main/electron-builder.yml

## 5. Alternativas avaliadas

### 5.1 `@electron/rebuild`

Rejeitada como solução única. Ela recompila addons para o ABI do Electron, mas o problema do DSH permanece quando o binding usa o libvips pré-compilado que colide com a GLib do Electron.

### 5.2 Sharp WASM

Tecnicamente promissora. O Sharp declara `@img/sharp-wasm32`, e o pacote pode operar sem o libvips nativo Linux. Porém, a seleção precisa ser forçada corretamente no runtime; apenas instalar o pacote WASM ou definir `npm_config_arch=wasm32` não foi suficiente no teste preliminar com a árvore normal do Sharp, que continuou caindo para o binding nativo.

Essa rota deve ser investigada como fallback futuro, com teste de desempenho e cobertura completa das operações usadas pelo attachment-local.

### 5.3 `@janhapke/sharp-electron`

Resolve o problema por patch de símbolos/linker. É uma opção válida, mas introduz uma dependência de terceiro e exige alinhar o patch à versão pinada do Sharp. Não foi escolhida como primeira implementação do fork.

### 5.4 Sharp compilado contra libvips do sistema

Foi a primeira rota implementada porque existe uma implementação validada especificamente no ecossistema DSH. Entretanto, a execução real no GitHub Actions mostrou que o runner Ubuntu 24.04 fornece:

```text
libvips 8.15.1
```

O Sharp 0.35.5 exige:

```text
libvips >= 8.18.7
```

Resultado real da execução Actions:

```text
Error: desktop package: system libvips 8.15.1; install libvips headers 8.18.7 or newer
```

Conclusão: a rota não é portátil no runner Ubuntu 24.04 sem compilar/fornecer libvips manualmente. O workflow instala `libvips-dev`, mas isso não basta para atingir a versão mínima.

### 5.5 Rodar o runtime com Node/Bun em vez de Electron

Eliminaria a classe de conflito, mas mudaria a arquitetura de runtime do DSH e perderia a garantia de testar o mesmo ambiente Electron. Não foi escolhida para esta primeira entrega.

## 6. Decisão atual

A rota `libvips-dev` do Ubuntu foi rejeitada como solução final. O próximo passo correto é trazer o pipeline patched de `janhapke/sharp-electron` para o fork, parametrizado para Sharp 0.35.5, ou empacotar uma variante patched equivalente como dependência explícita.

Não se deve disparar outra execução Actions com o mesmo preparador esperando resultado diferente: o erro de versão é determinístico.

## 6. O que foi implementado no fork

- alvo `linux-x64` no pipeline de packaging;
- AppImage Linux no Electron Builder;
- Linux unsigned/local-only;
- workflow Actions com Node 26, pnpm e libvips;
- `prepare-sharp-electron.ts` baseado na implementação encontrada no fork upstream;
- substituição do `sharp` do runtime DSH pela árvore Sharp validada;
- smoke obrigatório antes do empacotamento final;
- documentação fork-only em `docs/_fork/`.

## 7. Estado da validação

Passou:

- build geral;
- typecheck host;
- testes Linux de seleção/estágios: 72/72;
- instalação do libvips no runner Actions;
- início do empacotamento Linux.

Ainda em validação:

- compilação do Sharp contra libvips no runner;
- smoke do Sharp compatível dentro do Electron;
- geração do AppImage;
- upload do artifact.

Acompanhar a execução atual em:

```text
https://github.com/filhocf/deepseek-harness/actions/runs/42422227052
```

## 8. Critério de encerramento

A investigação só será considerada fechada quando uma execução Actions demonstrar simultaneamente:

1. `runtime:prepare-sharp-electron` aprovado;
2. `runtime:smoke` aprovado;
3. `electron-builder --linux --x64` aprovado;
4. AppImage localizado;
5. `file` confirmar ELF x86-64 executável;
6. artifact publicado no Actions;
7. documentação do runbook atualizada com o ID da execução e o nome do artifact.
