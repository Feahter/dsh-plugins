# dsh-plugins

Feahter's [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins, served from one repository and one self-hosted plugin market index.

Four plugins live side by side under [`plugins/`](./plugins).

## Add the plugin market index

This repository is a self-hosted plugin market index for DSH:

```
https://raw.githubusercontent.com/Feahter/dsh-plugins/main/index.json
```

In the Harness Web UI open **Plugins → Discover** (or Settings → Plugins → Discover), add that index URL, then search for the plugin you want and install it.

## Plugins

### [Realtime voice input](./plugins/realtime-voice)

Continuous dictation for the composer: click the microphone once, speak, and each paused sentence is written into the input box. Recognition runs entirely on your machine with SenseVoiceSmall (ONNX, int8) — audio never leaves the device and no model tokens are consumed.

- Requirements: DSH `>= 0.2.1-rc.4` with the experimental **Voice input** bundle enabled (it provides the local SenseVoice recognizer and the `speech` Host Remote), plus a microphone.

### [GitHub project manager](./plugins/github-manager)

A sidebar GitHub panel and a family of `github_*` agent tools: browse repositories, triage issues, inspect pull requests, create or close issues, and comment — from the Web UI or from chat. Credentials are resolved on the Host from your existing `gh auth login` (including macOS keyring), or from `GH_TOKEN` / `GITHUB_TOKEN`; the token never reaches the browser.

- Requirements: DSH `>= 0.2.1-rc.4`, a GitHub account, and `gh auth login` or a `GH_TOKEN` / `GITHUB_TOKEN` with `repo` scope.

### [Session archive + PDCA alchemy](./plugins/archive-rsi)

Two layers over the Harness's own session history. `archive_*` tools add curation the Harness lacks — sync, tag, note, read, trash, delete over `~/.dsh/sessions`, with the Harness's archive/pin state mirrored read-only rather than forked. `rsi_*` tools then run a PDCA loop over that corpus: they compute tool-error rate, correction rate, the edit-then-no-verification gap, context pressure and tool-catalog cost, turn the outliers into findings carrying `sessionId + seq` evidence, and emit context patches (prompt lessons, `AGENTS.md` rules, skill candidates) that can be adopted and later re-evaluated against the sessions created after adoption. That measured loop — observe, patch the context, measure again — is tool-layer recursive self-improvement.

- Requirements: DSH `>= 0.2.1-rc.4` and Node `>= 22.15` (session logs are concatenated-zstd containers decoded through `node:zlib`).
- Data lives in `~/.dsh/archive-rsi/`; original session files are never modified, moved or deleted.

### [Skills 360](./plugins/skills-360)

A six-dimension health check for every skill in the Harness catalog, with a sidebar panel and four `skills360_*` tools. It scores the **on-demand loading path** (can the catalog select it, was it actually loaded on demand, are triggers unique, is the idle catalog cost sane), progressive disclosure (entry size, deferred references, and a reference index that says what to read when), actionability, boundary/governance, maintenance hygiene, and **continuous evolution**: post-load corrections, tool errors, re-loads and failed turns are mined into evidence-backed lesson proposals, written to `<skill>/references/lessons.md` and linked into the body so the next load reads them on demand. Every write is backed up and undoable; signals are read locally and never leave the machine.

- Requirements: DSH `>= 0.2.1-rc.4`; Node's bundled `zlib` zstd support (Node `>= 22.15`) to read session logs.
- Data lives in `~/.dsh/skills-360/` (backups, reports, scan state); original session files are never modified.

## Install manually

The market index pins an exact commit for every version. The equivalent manual installs:

```bash
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/realtime-voice"
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/github-manager"
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/archive-rsi"
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/skills-360"
```

or point the plugin manager at a checkout of the corresponding directory.

## License

MIT — see [LICENSE](./LICENSE).
