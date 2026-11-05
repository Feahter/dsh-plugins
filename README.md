# dsh-realtime-voice

Feahter's [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins, served from one repository and one self-hosted plugin market index.

## Add the plugin market index

This repository is a self-hosted plugin market index for DSH:

```
https://raw.githubusercontent.com/Feahter/dsh-realtime-voice/main/index.json
```

In the Harness Web UI open **Plugins → Discover** (or Settings → Plugins → Discover), add that index URL, then search for the plugin you want and install it.

## Plugins

### Realtime voice input

Continuous dictation for the composer: click the microphone once, speak, and each paused sentence is written into the input box. Recognition runs entirely on your machine with SenseVoiceSmall (ONNX, int8) — audio never leaves the device and no model tokens are consumed.

- Source: [`plugin/`](./plugin)
- Requirements: DSH `>= 0.2.1-rc.4` with the experimental **Voice input** bundle enabled (it provides the local SenseVoice recognizer and the `speech` Host Remote), plus a microphone.
- Details: [`plugin/README.md`](./plugin/README.md)

### GitHub project manager

A sidebar GitHub panel and a family of `github_*` agent tools: browse repositories, triage issues, inspect pull requests, create or close issues, and comment — from the Web UI or from chat. Credentials are resolved on the Host from your existing `gh auth login` (including macOS keyring), or from `GH_TOKEN` / `GITHUB_TOKEN`; the token never reaches the browser.

- Source: [`github-manager/`](./github-manager)
- Requirements: DSH `>= 0.2.1-rc.4`, a GitHub account, and `gh auth login` or a `GH_TOKEN` / `GITHUB_TOKEN` with `repo` scope.
- Details: [`github-manager/README.md`](./github-manager/README.md)

## Install manually

The market index pins an exact commit for every version. The equivalent manual installs:

```bash
dsh plugin install "git+https://github.com/Feahter/dsh-realtime-voice.git#<commit>&path:/plugin"
dsh plugin install "git+https://github.com/Feahter/dsh-realtime-voice.git#<commit>&path:/github-manager"
```

or point the plugin manager at a checkout of the corresponding directory.

## License

MIT — see [LICENSE](./LICENSE).
