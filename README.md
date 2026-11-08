# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Linux AppImage (this fork)

This fork publishes an **unsigned Linux x64 AppImage** for every upstream release. It is built on `main` from the upstream release tag plus the fork's packaging changes; it is not an upstream deliverable and has no signing or auto-update channel.

Install the newest published build:

```bash
curl -fsSL https://raw.githubusercontent.com/filhocf/deepseek-harness/main/tools/linux-appimage/install.sh | bash
```

The installer resolves the latest `linux-*` release through the API listing, downloads the AppImage and its digest, verifies the sha256, installs `~/.local/bin/dsh-desktop`, writes the `dsh` shortcut (`--no-sandbox`, plus `--appimage-extract-and-run` when `/dev/fuse` is missing) and the menu entry.

Integrity: each release ships a `SHA256SUMS` file next to the binary. Because that file travels through the same channel as the AppImage, it detects corruption and truncation but not a replaced release. For a guarantee outside the download channel, pin the digest yourself:

```bash
DSH_EXPECTED_SHA256=<digest> curl -fsSL .../install.sh | bash
```

Fork-specific operation notes: [docs/_fork/RETOMADA-linux-appimage.md](docs/_fork/RETOMADA-linux-appimage.md) and [docs/_fork/RUNBOOK-linux-appimage.md](docs/_fork/RUNBOOK-linux-appimage.md). Upstream documentation remains in the sections above.

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
