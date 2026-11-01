// Turns wheel events into discrete steps: one notch or one trackpad flick is
// exactly one step, inertia tails never add steps, and a held push repeats.
export function createWheelStepper(C, onStep) {
  const W = { last: -1e9, acc: 0, energy: 0, minEnergy: Infinity, minAd: Infinity, phase: 'rise', steps: 0, lastStep: -1e9, peakD: 0, dir: 0, mouse: false, lastAd: 0 };
  return function handle(raw, deltaMode, now) {
    let d = raw * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
    if (Math.abs(d) < C.wheelNoiseFloor) return;
    // rd: how hard this event pushes (uncapped), used to tell a held push from a
    // fading inertia tail. d: capped, so big mouse deltas don't count extra.
    const rd = Math.abs(d);
    d = Math.min(C.wheelEventCap, Math.max(-C.wheelEventCap, d));
    const gap = now - W.last; W.last = now;
    const dir = Math.sign(d);

    W.energy = W.energy * Math.exp(-gap / C.wheelEnvelopeTau) + Math.abs(d);
    // notched mice send big, spaced-out, whole-number deltas; trackpads a stream of small ones
    const mouseTick = gap >= C.wheelTickGap && rd >= 40 && Number.isInteger(raw);
    // after a pause, only a stronger push is a new gesture: an inertia tail keeps
    // fading even when a busy page delays its events
    const paused = gap > C.wheelPauseGap && (rd > W.lastAd * 1.15 || gap > C.wheelPauseGap * 3);
    // a new flick during an inertia tail: the push gets clearly stronger again
    const rising = W.phase === 'decay' && W.energy > W.minEnergy * C.wheelRiseFactor && rd > W.minAd * 2 + 2;
    const newGesture = paused || dir !== W.dir || mouseTick || rising;
    if (gap > C.wheelIdleReset) W.acc = 0;

    if (newGesture) {
      W.acc = 0; W.steps = 0; W.phase = 'rise'; W.peakD = rd; W.minAd = Infinity; W.minEnergy = Infinity; W.dir = dir; W.mouse = mouseTick;
    } else {
      W.peakD = Math.max(W.peakD, rd);
      if (W.phase === 'rise' && rd < W.peakD * 0.7) W.phase = 'decay';
      if (W.phase === 'decay') { W.minAd = Math.min(W.minAd, rd); W.minEnergy = Math.min(W.minEnergy, W.energy); }
    }
    W.lastAd = rd;
    W.acc += d;

    const minGap = W.mouse ? C.wheelMinStepTick : C.wheelMinStepFlick;
    if (W.steps === 0) {
      if (Math.abs(W.acc) >= C.wheelStepThreshold && now - W.lastStep >= minGap) {
        onStep(dir); W.steps = 1; W.lastStep = now; W.acc = 0;
      }
    } else if (!W.mouse) {
      // finger still pushing (not an inertia tail): repeat, a little faster each time
      const wait = C.wheelSustainDelay * Math.pow(C.wheelSustainRatio, W.steps - 1);
      if (now - W.lastStep >= wait && rd >= W.peakD * 0.75 && W.phase !== 'decay') {
        onStep(dir); W.steps++; W.lastStep = now; W.acc = 0;
      }
    }
  };
}
