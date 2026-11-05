# Realtime voice input

Continuous dictation for the Harness composer. One click turns the microphone on; every sentence you finish is written into the input box, and the words appear live above the composer while you speak.

## What you get

- **Click once, speak many sentences.** No click-to-start / click-to-stop per sentence; the session stays open until you stop it.
- **Live words, clean commits.** Partial transcripts update in a panel above the composer. Only the text after a pause is inserted, so a mid-sentence revision never rewrites what you already typed.
- **Fully local.** SenseVoiceSmall int8 runs on the Host CPU; audio is never uploaded and no model tokens are billed. The ~240 MB model is downloaded once by the Voice input bundle and reused for every later session.
- **Draft-safe.** If your draft changes while dictating (you edit or submit), the transcript is preserved and offered as a one-click insertion.
- **English and 中文 UI text**, following the Harness locale.

## Timing (measured on an Intel i7-8569U)

| Step | Value |
| --- | --- |
| Speech onset detection | 120 ms |
| Pause that ends a sentence | 600 ms |
| Final transcription after the pause | 0.2–0.5 s |
| Partial refresh while speaking | 700 ms (1200 ms past 8 s) |
| Accuracy vs one-shot file recognition | 0.0 % content CER |

## Requirements

Needs the experimental **Voice input** bundle for its local recognizer and the `speech` Host Remote. If the model cache is empty, prepare it once from the plugin manager.
