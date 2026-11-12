/**
 * マイク音声の取り出し — issue #79
 *
 * AudioWorklet は「128 フレームずつ」しか渡してくれないので、ここでは
 * **モノラルに混ぜて main スレッドへ送る** だけを行う。16kHz への変換は
 * main 側 (`src/lib/speech/wasm-recognition.ts`) で行う。
 *
 * ステレオのまま片チャンネルだけ読むと、マイクが右チャンネルに載る端末
 * (USB ヘッドセット等) で「無音」になるため、必ず平均してモノラルにする。
 *
 * CSP の `worker-src` / `script-src` を緩めないよう、Blob URL ではなく
 * **同一オリジンのこのファイル**を addModule する (ライブラリ既定の Blob は使わない)。
 */

class EfkCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0] && input[0].length > 0) {
      const frames = input[0].length;
      const mono = new Float32Array(frames);
      for (let channel = 0; channel < input.length; channel += 1) {
        const data = input[channel];
        for (let i = 0; i < frames; i += 1) mono[i] += data[i];
      }
      if (input.length > 1) {
        for (let i = 0; i < frames; i += 1) mono[i] /= input.length;
      }
      this.port.postMessage(mono, [mono.buffer]);
    }
    /* true を返し続けないと、入力が来なくなった時点で processor が止まる */
    return true;
  }
}

registerProcessor("efk-capture", EfkCaptureProcessor);
