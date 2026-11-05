# dsh-realtime-voice

Continuous realtime dictation for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) composer. Click the microphone once, speak, and each sentence is written into the input box as you pause. Recognition runs entirely on your machine with SenseVoiceSmall (ONNX, int8) — audio never leaves the device and no model tokens are consumed.

## Add the plugin market index

This repository is a self-hosted plugin market index for DSH:

```
https://raw.githubusercontent.com/Feahter/dsh-realtime-voice/main/index.json
```

In the Harness Web UI open **Plugins → Discover** (or Settings → Plugins → Discover), add that index URL, then search for **Realtime voice input** and install it.

## Install manually

The package lives in [`plugin/`](./plugin). The market index pins an exact commit; the equivalent manual install is:

```bash
dsh plugin install "git+https://github.com/Feahter/dsh-realtime-voice.git#<commit>&path:/plugin"
```

or point the plugin manager at a checkout of `plugin/`.

## Requirements

- DeepSeek Harness `>= 0.2.1-rc.4` with the experimental **Voice input** bundle enabled (it provides the local SenseVoice recognizer and the `speech` Host Remote). Prepare the model once in the plugin manager if the cache is empty.
- A microphone; macOS asks for microphone permission on first use.

## How it works

- Browser side: `getUserMedia` → 16 kHz PCM → energy VAD with noise-floor calibration, 300 ms pre-roll, 120 ms speech onset, 600 ms pause endpoint, 15 s segment cap.
- While a segment is open the client re-transcribes the growing buffer every 700 ms (throttled to 1200 ms past 8 s, 12 s window) through the existing `speech/transcribe` Host Remote.
- Partial text is displayed live in a panel above the composer; only the final endpoint transcript is inserted into the draft through `inputActions.insertText`, so a revision mid-sentence can never corrupt the composer.
- If the draft changes during dictation, the transcript is kept and offered for manual insertion.

Parameters were measured on an Intel i7-8569U: endpoint-to-text ≈ 0.8 s, per-call latency 0.55 s at a 12 s window, transcript content CER 0.0 % versus one-shot full-file recognition.

## License

MIT — see [LICENSE](./LICENSE).
