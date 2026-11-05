/**
 * Host half of the dsh-realtime-voice bundle.
 *
 * All behavior lives in the browser (Client) half: continuous microphone
 * capture, voice-activity segmentation, and calls to the experimental speech
 * Host Remote (`speech/transcribe`, local SenseVoice ONNX). This row exists so
 * the bundle has a Loader entry and a plugin-manager presence beside its
 * `dsh.client` contribution.
 */
export function apply() {}
