#!/usr/bin/env bash
# Instalador de uma linha para o AppImage Linux do fork.
#
#   curl -fsSL https://raw.githubusercontent.com/filhocf/deepseek-harness/main/tools/linux-appimage/install.sh | bash
#
# Variáveis opcionais:
#   DSH_RELEASE_REPO       repositório (default: filhocf/deepseek-harness)
#   DSH_RELEASE_TAG        tag exata (default: release mais recente cujo tag começa com linux-)
#   DSH_INSTALL_DIR        destino (default: ~/.local/bin)
#   DSH_INSTALL_FROM_FILE instala um AppImage local em vez de baixar (usado nos testes)
#
# Instala o AppImage como $DSH_INSTALL_DIR/dsh-desktop, cria o atalho $DSH_INSTALL_DIR/dsh
# (já com --no-sandbox) e a entrada de menu quando o XDG estiver presente.
set -euo pipefail

repo=${DSH_RELEASE_REPO:-filhocf/deepseek-harness}
install_dir=${DSH_INSTALL_DIR:-$HOME/.local/bin}
api="https://api.github.com/repos/$repo/releases"

say() { printf '%s\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "comando obrigatório ausente: $1"; }

need install
need sha256sum
need awk
if [ -z "${DSH_INSTALL_FROM_FILE:-}" ]; then
  need curl
fi

# A release mais recente do upstream é pre-release, então `releases/latest` não serve:
# listamos e filtramos pelo prefixo que o workflow de acompanhamento publica.
resolve_tag() {
  local json tag
  json=$(curl -fsSL "$api?per_page=30") || die "não foi possível consultar $api"
  tag=$(printf '%s\n' "$json" \
    | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | sed 's/.*"\([^"]*\)"$/\1/' \
    | grep '^linux-' \
    | head -n 1)
  [ -n "$tag" ] || die "nenhuma release linux-* publicada em $repo"
  printf '%s\n' "$tag"
}

resolve_asset() {
  local tag="$1" json name
  json=$(curl -fsSL "$api/tags/$tag") || die "release $tag não encontrada em $repo"
  name=$(printf '%s\n' "$json" \
    | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*\.AppImage"' \
    | sed 's/.*"\([^"]*\)"$/\1/' \
    | head -n 1)
  [ -n "$name" ] || die "release $tag não tem asset .AppImage"
  printf '%s\n' "$name"
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/dsh-install.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

if [ -n "${DSH_INSTALL_FROM_FILE:-}" ]; then
  [ -f "$DSH_INSTALL_FROM_FILE" ] || die "arquivo não encontrado: $DSH_INSTALL_FROM_FILE"
  tag=local-file
  appimage=$(basename "$DSH_INSTALL_FROM_FILE")
  cp "$DSH_INSTALL_FROM_FILE" "$tmp/$appimage"
  say "install: usando arquivo local $appimage"
else
  tag=${DSH_RELEASE_TAG:-}
  [ -n "$tag" ] || tag=$(resolve_tag)
  appimage=$(resolve_asset "$tag")
  base="https://github.com/$repo/releases/download/$tag"
  say "install: release $tag, asset $appimage"
  curl -fL --retry 3 --progress-bar "$base/$appimage" -o "$tmp/$appimage" \
    || die "falha ao baixar $base/$appimage"
  if curl -fsSL "$base/$appimage.sha256" -o "$tmp/$appimage.sha256"; then
    expected=$(awk 'NR==1{print $1}' "$tmp/$appimage.sha256")
    actual=$(sha256sum "$tmp/$appimage" | awk '{print $1}')
    [ "$expected" = "$actual" ] || die "digest não confere: esperado $expected, obtido $actual"
    say "install: sha256 conferido ($actual)"
  else
    say "install: AVISO — release sem .sha256; seguindo sem verificação de digest"
  fi
fi

[ "$(head -c 4 "$tmp/$appimage" | od -An -tx1 | tr -d ' \n')" = "7f454c46" ] \
  || die "$appimage não é um ELF (magic inesperado)"

mkdir -p "$install_dir"
target="$install_dir/dsh-desktop"
install -m 0755 "$tmp/$appimage" "$target"

# O AppImage tipo 2 exige FUSE; onde ele não existe, o runtime extrai e executa.
flags="--no-sandbox"
if [ ! -e /dev/fuse ]; then
  flags="$flags --appimage-extract-and-run"
  say "install: /dev/fuse ausente; o atalho usará --appimage-extract-and-run"
fi

# O sandbox do Chromium falha em hosts sem user namespaces; o atalho já resolve isso.
cat > "$install_dir/dsh" <<EOF
#!/usr/bin/env bash
exec "$target" $flags "\$@"
EOF
chmod 0755 "$install_dir/dsh"

if [ -d "$HOME/.local/share/applications" ]; then
  desktop="$HOME/.local/share/applications/dsh-desktop.desktop"
  cat > "$desktop" <<EOF
[Desktop Entry]
Type=Application
Name=DeepSeek Harness (Linux, fork)
Comment=DSH local AppImage
Exec=$target $flags %U
Terminal=false
Categories=Development;
Icon=applications-engineering
StartupWMClass=deepseek-harness
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

if "$target" --appimage-version >/dev/null 2>&1; then
  say "install: runtime do AppImage respondeu ao smoke test"
else
  say "install: AVISO — o runtime não respondeu a --appimage-version; o binário foi instalado mesmo assim"
fi

case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) say "install: atenção — $install_dir não está no PATH; use o caminho completo ou exporte-o" ;;
esac

say "install: concluído"
say "  binário: $target"
say "  comando: $install_dir/dsh"
say "  release: $tag"
