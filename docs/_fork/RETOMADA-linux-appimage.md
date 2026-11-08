# RETOMADA — DSH Desktop Linux (AppImage)

Atualizado: 2026-11-08, host `sirdata`.

## Objetivo

Duas entregas, não uma:

1. **AppImage Linux executável** que abre o DSH e permite experimentar localmente.
2. **Workflow que acompanha o upstream** — a cada release do projeto original, merge da tag e publicação de um AppImage novo.

## Estado real em 2026-11-08 14:40

| Item | Estado | Evidência |
|---|---|---|
| AppImage | **entregue** | `~/.local/bin/dsh-desktop` instalado pelo one-liner a partir da release (379 853 100 bytes, sha256 `1cd1e267…`), executado com 7–8 processos, janela criada e `dsh web` anunciado |
| Testes de empacotamento | **111/111** | `vitest run` nos 6 arquivos de desktop |
| CI do fork | **verde** | runs `42515741359` (iteração) e `42518568379` (acompanhamento) concluídos sem falha |
| Release no fork | **publicada** | `linux-dsh-v0.2.2-rc.1` com AppImage, `.sha256`, `SHA256SUMS` e `dsh-install.sh` |
| Acompanhamento de release upstream | **exercitado** | dispatch resolveu a tag, fez o merge (no-op), reconstruiu e publicou |
| Instalação de uma linha | **validada** | `curl … install.sh \| bash` conferiu o digest e instalou em `~/.local/bin` |

Nota de leitura do histórico: o CI falhou porque o step `Build patched Sharp/Electron package` e o script `tools/sharp-electron/build.sh` estavam **apenas na worktree** (untracked), nunca commitados. O erro de libvips 8.15.1 é a consequência, não a causa raiz.

## Branches do fork

| Branch | Papel |
|---|---|
| `main` | empacotamento Linux; branch de trabalho e default do fork |
| `master` | espelho fiel do upstream, só fast-forward — permite `git log upstream/master..main` limpo |

Push direto em `main`, sem PR: o fork é nosso e o histórico de iteração deve ficar visível. O espelho separado é o que mantém a comparação com o upstream legível; fundir os dois faria cada release do upstream virar conflito em cima do próprio espelho.

## Definido como pronto

1. `pnpm run package:desktop:linux:x64` termina com `PACKAGE_EXIT=0`.
2. Smoke `scripts/smoke-packaged-runtime.ts --unsigned` passa (inclui integridade do ASAR).
3. AppImage executa e **não** emite `desktop policy: unsupported platform`.
4. Commit + push autorizados, CI verde.
5. Release `linux-<tag upstream>` publicada com AppImage e `.sha256`.

Artefato existente **não** é entrega: gate vermelho não fecha trabalho.

## Ambiente obrigatório (local)

```bash
source ~/.nvm/nvm.sh && nvm use 26.13.0     # Node do sistema e NVM default são 22/24
export CONTAINER_ENGINE=podman               # host usa Podman 5.8.6; no runner o default é docker
```

```bash
export DSH_DESKTOP_APP_ID=com.deepseek.dsh
export DSH_SHARP_ELECTRON_PACKAGE=$PWD/.sharp-electron-package
```

O pacote Sharp patchado é construído por `tools/sharp-electron/build.sh` e fica **fora** de `.desktop-build` (que o `prepare-dsh` apaga). `.sharp-electron-package/` está no `.gitignore` — 20 MB de artefato não se versiona.

## Já resolvido (não redescobrir)

| Problema | Causa real | Correção |
|---|---|---|
| `DSH_DESKTOP_APP_ID must be set` | preflight exige app id | variável acima |
| `patched sharp package is missing package.json` | caminho do artefato Sharp errado no comando manual | usar `.sharp-electron-package` persistente |
| artefato Sharp sumia | `prepare-dsh` reseta `.desktop-build` | artefato fora dessa árvore |
| `Cannot find module .../vendor/sharp/scripts/build.mjs` | fork pinado não traz o script; substituição parcial do vendor | checkout completo do submódulo + metadata 0.35.5 |
| `found 4 bindings` | contava `obj.target` e `@img` opcionais | limpar duplicatas antes da validação |
| `ERR_DLOPEN_FAILED libvips-cpp.so.8.18.6` | libvips compilada não era exportada | exportar `lib/` junto do artefato |
| mesmo erro no runtime payload | processo Electron filho sem `LD_LIBRARY_PATH` | copiar `lib` para `resourcesRuntime/lib` e propagar via `prependLibraryPath` |
| `executableName contains characters ...` | nome derivado do pacote escopado | `linux.executableName: 'deepseek-harness'` |
| smoke abria `mac/DeepSeek Harness.app` | script assumia macOS para todo alvo não-Windows | ramo explícito `linux-unpacked` |
| `desktop policy: unsupported platform` | política embutida em pacote Linux | Linux não resolve política (builder e preflight) |
| `ASAR integrity verification failed` | comparava bytes de `package.json` reescrito pelo electron-builder e modo `+x` que o ASAR não preserva | comparar conteúdo por bytes/SHA e metadata por identidade; modo só para entradas unpacked |
| `system libvips 8.15.1` no runner | sem o pipeline patchado, o preparador valida o libvips do sistema | step dedicado que constrói o pacote com o container engine antes do empacotamento |
| `Electron cache zip missing` | `build.sh` exigia cache local do Electron | cai para `node_modules/electron/install.js` quando o zip não existe |
| caminho pnpm fixo em `sharp@0.35.5_@types+node@22.20.1` | sufixo de peer dependency muda | resolver por glob `sharp@<versão>_*/node_modules/sharp` |

## Workflow de acompanhamento (desenho fixado)

`.github/workflows/linux-appimage.yml`, dois modos no mesmo job:

- **Iteração** — `push` na branch, ou `workflow_dispatch` sem tag: constrói o head, guarda artifact de 14 dias, não publica release.
- **Acompanhamento** — `schedule` diário (`17 4 * * *`) ou dispatch com `upstream_tag`: resolve a última release do upstream via API (a lista, não `releases/latest`, porque o upstream só publica pre-release), faz `git merge` da tag no runner, constrói e cria/atualiza a release `linux-<tag>` com o AppImage e o `.sha256`.

Idempotência sem arquivo de estado: a existência de `linux-<tag>` no fork é o registro. `force=true` refaz.

## Pendências abertas

1. **Cron diário** — o agendamento (`17 4 * * *`) ainda não disparou sozinho; a primeira execução automática será o próximo teste do automatismo.
2. **Conflito de merge futuro** — se o upstream mexer em `prepare-sharp-electron.ts`, `electron-builder-config.mjs` ou `smoke-runtime.ts`, o merge falha de propósito e o CI fica vermelho; a resolução é local, em `main`.
3. **Engine Office nativo** — frente separada; o Linux entrega degradação controlada, com PDF pelo CLI.

## Limitação conhecida — conversão Office no Linux

O `@deepseek-ai/libreoffice-kit` 0.1.5 **não publica engine nativa para Linux**: o pacote `@deepseek-ai/libreoffice-kit-linux-x64-glibc` que o runtime procura responde `404` no npm, e o kit não o declara nas dependências opcionais. Em Linux, `resolveEngine` deveria cair para `wasm`; dentro do ASAR a detecção responde "pacote incompleto" e a conversão direta pelo Host falha.

O gate `smoke-packaged-runtime` trata isso de forma explícita, não silenciosa:

- aceita a falha **somente** quando o corpo traz `code: 'unavailable'` citando `libreoffice-kit-`;
- exige que a ausência seja reportada de forma controlada, não por crash do Host;
- confirma que o caminho alternativo (CLI da skill `office-export-pdf`) produz um PDF válido — o que hoje acontece.

Consequência prática: o binário Linux é entregue com conversão de Office indisponível no caminho nativo e funcional pelo CLI. Fazer o caminho nativo existir exigiria publicar/patchar um engine Linux — frente separada, não bloqueia a entrega.

## AppImage atual (local)

```text
~/.local/bin/dsh-desktop
~/git/deepseek-harness/apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/deepseek-harness-0.2.2-rc.1-linux-x86_64-unsigned.AppImage
```

- 379 886 397 bytes, ELF 64-bit x86-64, executável
- sha256 `fd19dd9d81b3e31971ccad579c2621276955fc71c31c4ae4fecd9cd8245cb380`
- Executa com `--no-sandbox` (o host não tem user namespaces para o sandbox do Chromium)

## Regras de execução (aprendidas nesta frente)

- **Gate vermelho não é entrega.** Não declarar pronto com `PACKAGE_EXIT=1`.
- **Um build por rodada.** Reiniciar empacotamento a cada hipótese gasta ~5 min por tentativa; agrupar correções e então empacotar.
- **Validar efeito externo.** Resumo de subagente não é prova; conferir artefato, arquivo e execução no processo principal.
- **Não apagar untracked alheio** (`examples/`, PNGs de outras frentes).
- **Não publicar sem autorização** de Claudio.
