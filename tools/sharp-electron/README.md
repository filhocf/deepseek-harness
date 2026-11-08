# DSH Linux Sharp/Electron build

This directory documents the reproducible Linux-only patched Sharp build used by the AppImage workflow. The build is performed from the pinned `janhapke/sharp-electron` source with its vendored `sharp-libvips` and `sharp` submodules.

The workflow passes `SHARP_VERSION=0.35.5` and requires the produced package to report Sharp 0.35.5 before DSH packaging starts. macOS and Windows keep the regular Sharp dependency and do not execute this path.
## Container engine

The builder defaults to `docker`, which is used by GitHub Actions. Set `CONTAINER_ENGINE=podman` for local Linux builds; the value is passed into the pinned upstream scripts for every container build and run operation. The clone retains the upstream submodules and emits Sharp 0.35.5.

```sh
CONTAINER_ENGINE=podman SHARP_VERSION=0.35.5 tools/sharp-electron/build.sh
```
