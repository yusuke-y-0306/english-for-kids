/**
 * マイク入力をそのまま親スレッドへ流すだけの AudioWorklet (issue #40)
 *
 * - 加工はしない (計測なのでエコーキャンセル等のブラウザ側処理も切ってある)
 * - まだモデル推論は無いので、ここは「16kHz 化の前段」だけを担当する
 * - `process()` は 128 フレームずつ呼ばれる。バッファは再利用されるので **必ず copy** する
 */
class AsrCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel && channel.length) {
      this.port.postMessage(channel.slice(0));
    }
    // 常に true を返して動かし続ける (止めるときは親が disconnect する)
    return true;
  }
}

registerProcessor("asr-capture", AsrCaptureProcessor);
