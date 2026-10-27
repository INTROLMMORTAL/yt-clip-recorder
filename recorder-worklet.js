class Recorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = new Float32Array(512);
    this.R = new Float32Array(512);
    this.i = 0;
  }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp[0]) return true;
    const l = inp[0], r = inp[1] || inp[0];
    for (let k = 0; k < l.length; k++) {
      this.L[this.i] = l[k];
      this.R[this.i] = r[k];
      if (++this.i === 512) {
        this.port.postMessage([this.L.slice(), this.R.slice()]);
        this.i = 0;
      }
    }
    return true;
  }
}
registerProcessor("recorder", Recorder);
