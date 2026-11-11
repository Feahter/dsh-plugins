# dsh-plugins

Feahter's [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins, served from one repository and one self-hosted plugin market index.

Five plugins live side by side under [`plugins/`](./plugins).

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

### [dsh-360](./plugins/dsh-360)

One plugin, two surfaces of health checks, one sidebar panel with two tabs and one shared **18-bucket S~E grade scale** (S+/S/S−/A+/A/A−/…/E−). The `skills` surface scores each catalog entry's on-demand loading path (catalog selectability, real load evidence, trigger uniqueness, progressive disclosure, actionability, boundary, hygiene, evolution); the `agents` surface scores everything that gets injected — instruction files (`AGENTS.md` / `CLAUDE.md`), subagent definitions and agent presets (inject hit rate, resident token cost, layering, imperative rules with verification commands, scope and cross-file conflicts, hygiene, evolution). v0.2 adds a four-axis classification (role / kind / scope / state) plus a skills-only **meta-skill layer** (meta vs task), a snapshot-first panel (last scan paints before revalidation; filters collapse behind one icon), optimization-effect cards with trustworthy undo, and roughly 3x faster scans. Four `dsh360_*` tools take a `surface` parameter (`skills` / `agents` / `both`); every write is backed up and undoable, and read-only subjects are never touched.

- Requirements: DSH `>= 0.2.1-rc.4` and Node `>= 22.15` (shared session-log evidence is read from concatenated-zstd logs).
- Supersedes `skills-360` + `agents-360` — do not enable them side by side; data lives in `~/.dsh/dsh-360/`.

### [Mind canvas](./plugins/mind-canvas)

A mind map on an infinite canvas inside the sidebar. Jot a thought and press Enter for the first node; `Tab` grows a child and drops straight into editing, `⌘Z` undoes, deleting a node takes its whole subtree. `Tidy up` runs a d3-hierarchy tidy tree so siblings never overlap (grow right or down), and any node can collapse its subtree. **From inspirations** imports entries from the Media desk plugin as roots, and **AI branch** asks the host's default model for 3–6 concrete child ideas (it fails loudly instead of inventing content when no model is configured).

- Styling: five theme presets (paper / midnight / forest / sunset / indigo) plus a custom palette of 13 colour slots; the default `Follow app` inherits the host's light and dark tokens.
- Export: Markdown outline, OPML (XMind / MindNode), FreeMind `.mm`, raw JSON, and PNG. Markdown has exactly one implementation, shared by the UI export and the `mind_canvas_read` tool.
- Agent tools: `mind_canvas_read` (outline + stats) and `mind_canvas_add` (branch a node by text match).
- Requirements: DSH `>= 0.2.1-rc.4`. Data lives in `~/.dsh/mind-canvas/state.json`; the host half has zero runtime dependencies.

## Install manually

The market index pins an exact commit for every version. The equivalent manual installs:

```bash
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/realtime-voice"
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/github-manager"
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/archive-rsi"
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/dsh-360"
dsh plugin install "git+https://github.com/Feahter/dsh-plugins.git#<commit>&path:/plugins/mind-canvas"
```

or point the plugin manager at a checkout of the corresponding directory.

## License

MIT — see [LICENSE](./LICENSE).
