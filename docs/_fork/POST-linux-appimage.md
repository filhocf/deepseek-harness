# Draft para o upstream — Linux x64 AppImage (fork)

Levantamento em 2026-11-08, sobre `deepseek-ai/deepseek-harness` (issues e PRs externos desabilitados; contribuição vai por Discussions).

## Mapa das discussões existentes

| Discussão | Autor | Conteúdo | Estado |
|---|---|---|---|
| #8735 | finettt | "Would official Linux desktop support be considered?" | Aberta, 5 comentários. PerryLink recomenda trazer proposta reproduzível; dahch aponta #10197; jjaksic aponta o fork `yaoyingkeji`; Ruivalim traz patch mínimo para dev launch |
| #8411 | wanghongjian0119 | Shell Electron comunitário em `.deb`/AppImage, com Node embutido e Update Center | Provável duplicidade de escopo; não usa Electron-as-Node |
| #10197 | dahch | SIGSEGV do sharp em Linux + patch `rpm`/`AppImage`; workaround: rodar o Host sob Node standalone | **Aberta, 0 comentários** — e termina com duas perguntas explícitas |
| #10946 | riccelso | SIGSEGV do sharp em `dev:desktop`; fix compilando contra o libvips do sistema (exige ≥ 8.18.7) | 1 comentário |
| — | yaoyingkeji | Fork com releases `linux-x64-fix-sharp-v2` | Citado em #8735 e #10946 |

## Onde nosso trabalho encaixa

A pergunta 1 de #10197 é literalmente: *"would you handle sharp differently in the Electron-hosted process?"*. Respondemos a ela com uma rota diferente e oposta à do workaround dele: **mantemos o Host em `ELECTRON_RUN_AS_NODE` e trocamos o sharp pré-compilado por um compilado contra o libvips do próprio fork, dentro de um container**. Isso evita a dependência de rolling distro que limita a rota do #10946 (Ubuntu 24.04 tem libvips 8.15.1, abaixo do 8.18.7 exigido).

Além do fix: build reprodutível em CI, release por tag do upstream e instalador com verificação de digest — exatamente o "reproducible build proposal" que #8735 pede.

## Recomendação de publicação

1. **Comentário em #10197** (principal) — responde pergunta aberta, mesmo problema, abordagem alternativa com evidência de CI.
2. **Comentário curto em #8735** — uma linha + link, no formato que PerryLink sugeriu.
3. **Comentário curto em #10946** — complementa a rota do riccelso sem contradizê-la.

Não abrir tópico novo: fragmentaria a mesma conversa em quatro lugares.

---

# Versão PT-BR (para revisão do Claudio)

Respondendo à segunda pergunta primeiro: encontrei o mesmo SIGSEGV e trato o sharp de forma diferente no processo hospedado pelo Electron — mantenho o Host em `ELECTRON_RUN_AS_NODE` e substituo o sharp pré-compilado por um build compilado contra o libvips do próprio fork, produzido dentro de um container.

**Por que não o libvips do sistema.** O sharp fixado exige libvips ≥ 8.18.7, e nenhuma distro estável entrega isso (Ubuntu 24.04: 8.15.1; Debian 13: 8.16.1; Debian sid: 8.18.x). Condicionar o build ao libvips do host amarra o empacotamento a uma distro rolling. Compilar libvips e binding no mesmo container e embarcar o `libvips-cpp.so` resultante ao lado do binding remove a dependência do host e mantém a versão de sharp que o workspace fixa.

**O que foi necessário** (tudo em caminho exclusivo de Linux; macOS e Windows intocados):

1. `tools/sharp-electron/build.sh` compila a árvore fixada do `janhapke/sharp-electron` contra o libvips vendorizado, em container (docker no CI, podman local), e exporta um único binding, o `libvips-cpp.so` e as duas dependências de runtime (`semver`, `detect-libc`) — sem payloads `@img`.
2. `prepare-sharp-electron.ts` consome esse artefato (`DSH_SHARP_ELECTRON_PACKAGE`), exige exatamente um binding, troca o sharp do runtime e faz **smoke sob Electron** do caminho que quebrava (metadata, raw, JPEG) antes de empacotar.
3. Os processos filhos recebem `LD_LIBRARY_PATH` apontando para o libvips exportado, de modo que Host e payload resolvem a mesma cópia.
4. Integridade: a verificação do ASAR compara conteúdo por caminho/bytes/sha256 e metadados de `package.json` por identidade, e confere bit executável apenas em entradas desempacotadas.

**Evidência.** Dois runs verdes: `42515741359` (iteração) e `42518568379` (acompanhamento de release). A release `linux-dsh-v0.2.2-rc.1` traz o AppImage, `.sha256`, `SHA256SUMS` e um instalador de uma linha. Neste host (Debian sid, glibc 2.43, x64) o AppImage inicia, mantém 7–8 processos e serve `dsh web`; o smoke do runtime empacotado exercita o caminho de crash sob Electron com o libvips exportado.

O fluxo no CI: constrói em `ubuntu-24.04`, faz merge da tag de release do upstream, empacota o AppImage e publica `linux-<tag>`. Não é um PR — conforme o CONTRIBUTING — apenas uma referência reproduzível.

**O que isto NÃO resolve**, para não haver surpresa:

- O kit LibreOffice não publica engine nativa para Linux (`libreoffice-kit-linux-x64-glibc` responde 404 no npm), então a conversão direta de Office falha. O gate do pacote passou a exigir que a falha seja reportada como `code: 'unavailable'` e que o CLI `office-export-pdf` ainda produza PDF; qualquer outro erro reprova o build.
- O AppImage não é assinado e não tem canal de atualização; a política de update é omitida em Linux porque o shell a rejeita na inicialização.
- Verificado apenas em x64.

**Perguntas.** Compilar o sharp contra o libvips do próprio fork no CI é a direção que vocês aceitariam para um alvo Linux, ou preferem manter o Host fora do modo Node do Electron em Linux? E, se um alvo Linux chegar ao upstream, o AppImage deveria ser construído a cada tag de release (merge + build + publish) ou apenas sob demanda?

---

# Versão EN (a publicar)

Answering the second question first: I hit the same SIGSEGV, and I do handle sharp differently in the Electron-hosted process — I keep the Host on `ELECTRON_RUN_AS_NODE` and replace the prebuilt sharp with a build compiled against the fork's own libvips, produced inside a container.

**Why not the system libvips.** The pinned sharp requires libvips >= 8.18.7, and no stable distro ships it (Ubuntu 24.04: 8.15.1; Debian 13: 8.16.1; Debian sid: 8.18.x). Gating the build on the host libvips ties packaging to a rolling distro. Compiling both libvips and the binding inside the same container and shipping the resulting `libvips-cpp.so` beside the binding removes the host dependency and keeps the sharp version the workspace pins.

**What it took** (all behind a Linux-only path; macOS and Windows untouched):

1. `tools/sharp-electron/build.sh` builds the pinned `janhapke/sharp-electron` tree against its vendored libvips in a container (docker in CI, podman locally) and exports a single binding, `libvips-cpp.so` and the two runtime dependencies (`semver`, `detect-libc`) — no `@img` payloads.
2. `prepare-sharp-electron.ts` consumes that artifact (`DSH_SHARP_ELECTRON_PACKAGE`), asserts exactly one binding, swaps the runtime sharp, and runs a smoke under Electron of the path that used to crash (metadata, raw decode, JPEG) before packaging.
3. Child processes get `LD_LIBRARY_PATH` pointing at the exported libvips, so the Host and the runtime payload resolve the same copy.
4. Integrity: ASAR verification compares content by path/bytes/sha256 and `package.json` metadata by identity, and checks the executable bit only for unpacked entries.

**Evidence.** Two green runs: `42515741359` (iteration) and `42518568379` (release tracking). The `linux-dsh-v0.2.2-rc.1` release carries the AppImage, `.sha256`, `SHA256SUMS` and a one-line installer. On this host (Debian sid, glibc 2.43, x64) the AppImage starts, keeps 7–8 processes and serves `dsh web`; the packaged-runtime smoke exercises the crash path under Electron with the exported libvips.

The CI flow builds on `ubuntu-24.04`, merges the upstream release tag, packages the AppImage and publishes `linux-<tag>`. It is not a PR — per CONTRIBUTING.md — just a reproducible reference.

**What this does NOT solve**, so nobody is surprised:

- The LibreOffice kit publishes no native Linux engine (`libreoffice-kit-linux-x64-glibc` is 404 on npm), so direct Office-to-PDF fails on Linux. The packaged-runtime gate now requires that failure to be reported as `code: 'unavailable'` and requires the `office-export-pdf` CLI to still produce a PDF; anything else fails the build.
- The AppImage is unsigned and has no update channel; the version policy is omitted on Linux because the shell rejects it at launch.
- Verified on x64 only.

**Questions.** Is compiling sharp against the fork's own libvips in CI the direction you would accept for a Linux target, or would you rather keep the Host off Electron's Node mode on Linux? And if a Linux target ever lands upstream, would you want the AppImage built per upstream release tag (merge, build, publish), or only on demand?

---

# Comentários curtos de ligação (EN)

**#8735** (resposta à orientação do PerryLink de trazer proposta reproduzível):

> Following the suggestion to share a reproducible build proposal: I added the `linux-x64` target plus a CI job that builds it from the fork's own libvips and publishes an AppImage for every upstream release — details and evidence in #10197. It is a reference implementation, not a PR, per CONTRIBUTING.md.

**#10946** (complemento à rota do riccelso):

> Complementing this: the same mechanism, with a different dependency trade-off. Instead of compiling against the system libvips (which gates on >= 8.18.7 and only rolling distros reach), I build libvips and the binding together in a container and ship the resulting `libvips-cpp.so` beside the binding, so the host needs no libvips at all. The Host stays on `ELECTRON_RUN_AS_NODE`; the packaged runtime smoke exercises metadata/raw/JPEG under Electron. Evidence and trade-offs in #10197.
