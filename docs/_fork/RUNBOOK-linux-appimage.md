# Runbook fork-only — DSH Linux AppImage

Este runbook opera exclusivamente o fork:

```text
origin   https://github.com/filhocf/deepseek-harness.git
upstream https://github.com/deepseek-ai/deepseek-harness.git
```

Branch de trabalho atual:

```text
experiment/linux-package-target
```

## 1. Pré-requisitos locais

- Linux x64;
- Node.js 26.13.0 ou versão compatível com TypeScript nativo;
- Corepack;
- pnpm 11.28.5;
- dependências do repositório;
- para o preparador Sharp Linux: `libvips-dev` 8.18.7 ou superior, `pkg-config`, compilador C++ e `node-gyp`.

O projeto exige TypeScript nativo do Node. O `/usr/bin/node` da máquina auditada era v24.22.2, mas compilado sem esse recurso. O Node 26 do NVM passou:

```bash
node -p 'process.features.typescript'
# strip
```

## 2. Atualizar o fork com upstream

Nunca faça `pull` cego no branch de trabalho.

```bash
cd ~/git/deepseek-harness
git fetch upstream --tags --prune
git status --short --branch
git log --oneline HEAD..upstream/master
```

Se o branch estiver limpo e a integração for desejada:

```bash
git switch experiment/linux-package-target
git merge --ff-only upstream/master
```

Se houver divergência ou conflitos, pare e registre a decisão antes de resolver. O workflow também verifica que a ref escolhida é descendente de `upstream/master`.

## 3. Ambiente local

```bash
cd ~/git/deepseek-harness
export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/v26.13.0/bin:$PATH"
corepack enable
corepack pnpm install --frozen-lockfile
```

O projeto usa `DSH_DESKTOP_APP_ID`. Para build local Linux, use o valor do template:

```bash
export DSH_DESKTOP_APP_ID=com.deepseek.dsh
```

Não copie `.env.macos` nem `.env.windows` para construir Linux local.

## 4. Gates locais

### Build geral

```bash
NODE_OPTIONS=--max-old-space-size=8192 corepack pnpm run build
```

Critério esperado:

```text
10 passed, 0 failed, 0 skipped
build: recorded ... client artifact(s)
```

### Typecheck do host

```bash
NODE_OPTIONS=--max-old-space-size=8192 \
  corepack pnpm exec tsc -p tsconfig.host.json --pretty false
```

### Testes Linux do empacotador

```bash
corepack pnpm exec vitest run \
  apps/desktop/tests/desktop-build-paths.spec.ts \
  apps/desktop/tests/package-target.spec.ts \
  apps/desktop/tests/package-target-stages.spec.ts
```

O conjunto validado nesta frente contém 72 testes.

## 5. Verificar dependência nativa Sharp

```bash
pkg-config --modversion vips-cpp
```

O preparador exige a versão mínima declarada pelo Sharp 0.35.5. Se o comando não retornar uma versão suficiente, o preparador deve falhar explicitamente. Não contorne removendo o smoke.

O preparador é:

```text
apps/desktop/scripts/prepare-sharp-electron.ts
```

Ele:

1. lê o pin de Sharp em `packages/attachment/attachment-local/package.json`;
2. lê o `sharp` resolvido no workspace;
3. verifica a versão do Electron Node;
4. verifica libvips do sistema;
5. copia Sharp para uma área de build isolada;
6. instala somente dependências de compilação necessárias;
7. compila com `SHARP_FORCE_GLOBAL_LIBVIPS=1`;
8. monta uma árvore Sharp compatível;
9. executa `metadata`, raw decode e JPEG encode no Electron;
10. substitui `node_modules/sharp` do runtime DSH pela árvore validada.

## 6. Gerar diretório Linux

```bash
DSH_DESKTOP_APP_ID=com.deepseek.dsh \
NODE_OPTIONS=--max-old-space-size=8192 \
corepack pnpm run package:desktop:linux:x64:dir
```

Esse é o primeiro alvo de depuração. Só passe ao AppImage quando o diretório terminar com sucesso.

## 7. Gerar AppImage

```bash
DSH_DESKTOP_APP_ID=com.deepseek.dsh \
NODE_OPTIONS=--max-old-space-size=8192 \
corepack pnpm run package:desktop:linux:x64
```

Localizar o artefato:

```bash
find apps/desktop/.desktop-build -type f -name '*.AppImage' -print
```

Validar:

```bash
appimage=$(find apps/desktop/.desktop-build -type f -name '*.AppImage' -print -quit)
test -n "$appimage"
file "$appimage"
chmod +x "$appimage"
```

A execução só é considerada concluída quando o `file` confirmar um executável Linux x86-64 e o smoke do pacote passar.

## 8. Instalação local em ~/.local/bin

Actions não escreve na máquina local. Depois de baixar um AppImage validado:

```bash
mkdir -p ~/.local/bin
install -m 0755 ./DeepSeek-Harness-*.AppImage ~/.local/bin/dsh-desktop
```

Valide o caminho:

```bash
command -v dsh-desktop
file ~/.local/bin/dsh-desktop
```

Não sobrescreva uma instalação existente sem preservar o artefato anterior se a máquina for de uso diário.

## 9. GitHub Actions

Workflow:

```text
.github/workflows/linux-appimage.yml
```

Gatilhos:

- `workflow_dispatch`, com `ref` opcional;
- push em `experiment/linux-package-target`;
- agendamento semanal.

Execução manual:

```bash
gh workflow run linux-appimage.yml \
  --repo filhocf/deepseek-harness \
  --ref experiment/linux-package-target \
  -f ref=experiment/linux-package-target
```

Listar execuções:

```bash
gh run list \
  --repo filhocf/deepseek-harness \
  --workflow linux-appimage.yml \
  --limit 5
```

Acompanhar uma execução:

```bash
gh run watch <RUN_ID> --repo filhocf/deepseek-harness --exit-status
```

URL padrão:

```text
https://github.com/filhocf/deepseek-harness/actions
```

O artifact é retido por 14 dias e recebe o nome:

```text
dsh-linux-x64-appimage-<commit>
```

## 10. Diagnóstico por estágio

### `setup-node` falha localizando pnpm

O cache `pnpm` do `actions/setup-node` precisa encontrar o executável antes de iniciar. O workflow usa `pnpm/action-setup@v4` antes de `setup-node`.

### `build` falha no guard TypeScript

Verifique:

```bash
node --version
node -p 'process.features.typescript'
```

Use Node 26.13.0. Não altere o guard do projeto.

### `check:package` lê `.env.macos`

O fluxo Linux deve ser local unsigned e não deve carregar `.env.macos`. Verifique `loadDesktopPackageEnvironment` e o argumento `linux-x64`.

### `DSH_DESKTOP_APP_ID` ausente

Defina apenas o valor não secreto:

```bash
DSH_DESKTOP_APP_ID=com.deepseek.dsh
```

No Actions, essa variável está declarada no passo `Build Linux AppImage`.

### `system libvips not found`

Instale os headers no ambiente de build. No Actions, o workflow executa:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libvips-dev
```

No host local, isso exige privilégio administrativo. Não use um binário Sharp pré-compilado como substituto: ele é precisamente a origem do SIGSEGV sob Electron Linux.

### `SharpElectronLinux` ou SIGSEGV

Colete:

```bash
find apps/desktop/.desktop-build/packaging-runs -type f -name 'events.jsonl' -print
```

Procure o estágio `runtime:prepare-sharp-electron` e `runtime:smoke`. O erro conhecido é a colisão GLib/libvips; a correção é preparar Sharp contra libvips do sistema, não simplesmente executar `electron-rebuild`.

### AppImage contém `.node`, mas falha ao carregar `.so`

Verifique `asarUnpack`/arquivos nativos na configuração do Electron Builder. O `.node` e suas bibliotecas `.so` precisam estar fisicamente acessíveis fora do ASAR quando o loader exigir.

## 11. Regras de segurança operacional

- não colocar tokens, chaves ou senhas no workflow;
- não usar `pull_request_target` para executar código do fork com segredos;
- não publicar release automaticamente nesta primeira fase;
- não usar `--no-verify` em push sem registrar a razão e os gates substitutos;
- preservar arquivos não rastreados já existentes no clone;
- não declarar AppImage pronto sem validar o artifact real.

## 12. Histórico e fontes

A investigação técnica está em:

```text
docs/_fork/RESEARCH-sharp-electron-linux.md
```

A especificação está em:

```text
docs/_fork/SPEC-linux-appimage.md
```
