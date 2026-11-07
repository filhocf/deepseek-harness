# DSH Linux x64 AppImage — especificação fork-only

> Documento exclusivo do fork `filhocf/deepseek-harness`.
> Não representa uma capacidade do upstream até que exista uma integração upstream correspondente.

## 1. Objetivo

Produzir um AppImage Linux x64 reproduzível do DeepSeek Harness Desktop a partir do fork, com atualização controlada em relação ao `upstream`:

```text
origin   = filhocf/deepseek-harness
upstream = deepseek-ai/deepseek-harness
```

O artefato deve ser gerado por GitHub Actions e disponibilizado como artifact da execução. A instalação local em `~/.local/bin` é uma responsabilidade separada de cada máquina consumidora.

## 2. Escopo

- alvo: Linux x64;
- formato inicial: AppImage;
- runtime: Electron Linux fornecido pelo projeto, com `ELECTRON_RUN_AS_NODE=1` onde o DSH exige esse modo;
- build: Node.js 26.13.0 e pnpm 11.28.5;
- validação: build geral, typecheck, testes de seleção de alvo e smoke do runtime empacotado;
- atualização: sincronização explícita com `upstream/master`, sem sobrescrever trabalho do fork;
- distribuição: artifact do GitHub Actions, sem publicação automática em release nesta primeira fase.

## 3. Fora do escopo

- instalador `.deb`, `.rpm`, Snap ou Flatpak;
- assinatura de pacote;
- publicação automática em GitHub Release;
- feed de atualização Linux;
- escrita direta em `~/.local/bin` via Actions;
- alteração de macOS ou Windows;
- remoção ou relaxamento do smoke test nativo.

## 4. Critérios de aceitação

### 4.1 Código

- `linux-x64` é aceito pelo pipeline de empacotamento local;
- macOS e Windows continuam usando seus fluxos existentes;
- Linux é unsigned e local-only: não participa de upload, retenção, EdgeOne, COS ou auto-update;
- o caminho Linux usa o executável Electron Linux (`electron`), não o caminho macOS `Electron.app/...`;
- o preflight Linux valida as ferramentas comuns sem exigir ferramentas Windows/macOS.

### 4.2 Runtime nativo

- Sharp Linux não pode usar silenciosamente o binário pré-compilado incompatível com Electron Linux;
- o preparador Linux deve produzir uma variante compatível e executar smoke real sob Electron;
- falha na preparação deve ser explícita e acionável;
- `metadata()`, decodificação raw e codificação JPEG devem passar sob `ELECTRON_RUN_AS_NODE=1`.

A primeira implementação usa um preparador de Sharp compilado contra libvips do sistema, baseado na solução validada na discussão upstream do DSH. A execução real mostrou que `ubuntu-24.04` fornece libvips 8.15.1, enquanto Sharp 0.35.5 exige >=8.18.7. Essa rota foi rejeitada como solução final; o próximo passo é o pipeline patched `sharp-electron` para Sharp 0.35.5, sem depender da versão de libvips do runner.

### 4.3 Actions

O workflow `.github/workflows/linux-appimage.yml` deve:

1. receber execução manual, push da branch Linux ou agendamento;
2. verificar que a ref é descendente de `upstream/master`;
3. instalar pnpm antes do cache do `setup-node`;
4. instalar `build-essential`, `pkg-config` e `libvips-dev`;
5. executar `pnpm install --frozen-lockfile`;
6. executar `pnpm run build`;
7. executar os testes Linux;
8. gerar o AppImage;
9. localizar, validar e publicar o artifact.

## 5. Arquitetura da mudança

```text
package-target.ts
  └── linux-x64
      ├── desktop-build-paths
      ├── desktop-package-environment (local unsigned)
      ├── prepare-runtime (Electron Linux)
      ├── prepare-dsh
      │   └── prepare-sharp-electron
      │       ├── lê sharp pin do attachment-local
      │       ├── verifica libvips do sistema
      │       ├── compila Sharp sem @img pré-compilado
      │       ├── executa smoke dentro do Electron
      │       └── substitui sharp no runtime DSH
      └── electron-builder --linux --x64
          └── AppImage
```

## 6. Decisões fixadas

### 6.1 Por que AppImage primeiro

É um artefato único, não exige instalação privilegiada e é compatível com a intenção de cada máquina instalar sua própria cópia em `~/.local/bin`. O instalador Linux será tratado depois.

### 6.2 Por que Actions não instala em `~/.local/bin`

O runner do GitHub é efêmero e não é a máquina do usuário. O workflow publica um artifact; uma rotina local posterior baixa e instala o arquivo.

### 6.3 Por que `electron-rebuild` não é suficiente

A falha não é apenas ABI do addon `.node`. O Electron Linux expõe GLib do sistema e o libvips pré-compilado do Sharp contém outra cópia de GLib. O conflito ocorre no carregamento/decodificação e termina em SIGSEGV.

### 6.4 Por que o smoke não é opcional

Um AppImage que apenas abre a janela, mas cai ao ler PNG/JPEG, não atende ao objetivo. O smoke precisa exercer exatamente o caminho que falhou: metadata, decode raw e encode JPEG.

## 7. Dependências da validação

O host local atual não possui `libvips-dev` e não permite `sudo` sem senha interativa. Portanto, a validação completa do preparador Sharp é feita no runner Actions, que instala:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libvips-dev
```

Essa limitação é operacional, não uma aprovação para substituir o smoke por uma simulação.

## 8. Estado de validação

A execução Actions acompanhada durante a implementação já confirmou:

- Node 26.13.0 disponível;
- pnpm configurado;
- libvips instalado no runner;
- build geral aprovado;
- testes Linux aprovados;
- empacotamento ainda em validação no estágio Sharp/AppImage.

A conclusão final só será registrada quando `Locate AppImage`, `Upload AppImage artifact` e a inspeção do artifact passarem.
