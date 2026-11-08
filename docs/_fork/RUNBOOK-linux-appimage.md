# Runbook fork-only — DSH Linux AppImage

Este runbook opera exclusivamente o fork:

```text
origin   https://github.com/filhocf/deepseek-harness.git
upstream https://github.com/deepseek-ai/deepseek-harness.git
```

Branch de trabalho:

```text
main          # empacotamento Linux; default do fork
master        # espelho do upstream, só fast-forward
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
git switch main
git merge --ff-only upstream/master
```

Se houver divergência ou conflitos, pare e registre a decisão antes de resolver. O workflow reporta a distância até `upstream/master` sem bloquear: quem integra a release é o modo de acompanhamento, que faz merge da tag.

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

O preparador atual é:

```text
apps/desktop/scripts/prepare-sharp-electron.ts
```

A tentativa de compilação contra libvips do sistema foi rejeitada como solução final: no `ubuntu-24.04` do Actions, `libvips-dev` fornece 8.15.1, mas Sharp 0.35.5 exige >=8.18.7. Não repita execuções com esse preparador esperando resultado diferente. O próximo passo operacional é integrar o pipeline patched `sharp-electron` para Sharp 0.35.5.

Ele deveria:

1. ler o pin de Sharp em `packages/attachment/attachment-local/package.json`;
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

Instalação em uma linha, a partir da release mais recente (`linux-*`) publicada no fork:

```bash
curl -fsSL https://raw.githubusercontent.com/filhocf/deepseek-harness/main/tools/linux-appimage/install.sh | bash
```

O instalador resolve a release mais recente pela API (lista, porque o upstream só publica pre-release), baixa o `.AppImage` e o `.sha256`, confere o digest, instala em `~/.local/bin/dsh-desktop`, cria o atalho `~/.local/bin/dsh` (com `--no-sandbox`, e `--appimage-extract-and-run` quando `/dev/fuse` não existe) e a entrada de menu quando o XDG está presente.

Variáveis úteis: `DSH_RELEASE_TAG` (tag exata), `DSH_INSTALL_DIR` (outro destino), `DSH_RELEASE_REPO` (outro fork). O mesmo comando serve para qualquer host Linux x64.

Alternativa manual, sem o instalador:

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

- `workflow_dispatch`, com `upstream_tag` e `force` opcionais;
- push em `main` (ignora `docs/**` e `*.md`);
- agendamento diário (`17 4 * * *`).

Dois modos no mesmo job:

| Modo | Gatilho | Efeito |
|---|---|---|
| iteração | push, ou dispatch sem tag | constrói o head da branch; artifact de 14 dias; sem release |
| acompanhamento | schedule, ou dispatch com `upstream_tag` | resolve a última release do upstream, faz merge da tag no runner, constrói e publica `linux-<tag>` |

A resolução usa a lista de releases da API (`releases?per_page=1`), não `releases/latest`: o upstream publica apenas pre-releases e `latest` as ignora.

Execução manual de iteração:

```bash
gh workflow run linux-appimage.yml \
  --repo filhocf/deepseek-harness \
  --ref main
```

Execução de acompanhamento para uma tag específica:

```bash
gh workflow run linux-appimage.yml \
  --repo filhocf/deepseek-harness \
  --ref main \
  -f upstream_tag=dsh-v0.2.2-rc.1
```

Idempotência: se a release `linux-<tag>` já existir no fork, o job termina sem construir. `-f force=true` reconstrói e reenvia os assets.

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

No modo de acompanhamento, a release do fork fica em:

```text
https://github.com/filhocf/deepseek-harness/releases/tag/linux-<tag upstream>
```

com dois assets: o `.AppImage` e o `.AppImage.sha256`. O release é marcado como pre-release, coerente com a origem.

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

### `Installed LibreOfficeKit package is incomplete`

Acontece em Linux no smoke do pacote. O kit 0.1.5 não publica engine nativa para Linux: `@deepseek-ai/libreoffice-kit-linux-x64-glibc` responde `404` no npm e não está nas dependências opcionais. Dentro do ASAR a detecção de engine responde "incompleto" em vez de "ausente", então `resolveEngine` não cai para `wasm`.

O gate `smoke-packaged-runtime` aceita essa falha apenas quando o corpo traz `code: 'unavailable'` citando `libreoffice-kit-`, exige degradação controlada e confirma que o CLI da skill `office-export-pdf` produz PDF. Se o erro vier sem `unavailable`, é regressão — não limitação.

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
