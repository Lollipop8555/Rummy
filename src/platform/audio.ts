/**
 * 操作音效：WebAudio 实时合成，不引入任何音频文件。
 *
 * 必须在首次用户手势后创建 AudioContext（浏览器自动播放策略），
 * 因此提供显式 unlock()，由 UI 在第一次点击时调用。
 */

type SoundName = 'draw' | 'place' | 'shuffle' | 'error' | 'win' | 'lose';

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

/** 首次用户手势后调用 */
export function unlockAudio(): void {
  if (ctx !== null) {
    void ctx.resume();
    return;
  }
  try {
    const Ctor = window.AudioContext;
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
}

function tone(
  frequency: number,
  duration: number,
  type: OscillatorType,
  gainPeak: number,
): void {
  if (ctx === null || !enabled) {
    return;
  }
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/** 白噪声短促爆发，用于洗牌/落牌的「沙沙」质感 */
function noise(duration: number, gainPeak: number): void {
  if (ctx === null || !enabled) {
    return;
  }
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = gainPeak;
  source.buffer = buffer;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

export function playSound(name: SoundName): void {
  if (!enabled || ctx === null) {
    return;
  }
  switch (name) {
    case 'draw':
      noise(0.09, 0.06);
      break;
    case 'place':
      noise(0.06, 0.09);
      tone(360, 0.08, 'triangle', 0.05);
      break;
    case 'shuffle':
      noise(0.28, 0.05);
      break;
    case 'error':
      tone(150, 0.16, 'square', 0.04);
      break;
    case 'win':
      tone(523.25, 0.16, 'sine', 0.07);
      window.setTimeout(() => tone(659.25, 0.16, 'sine', 0.07), 130);
      window.setTimeout(() => tone(783.99, 0.28, 'sine', 0.07), 260);
      break;
    case 'lose':
      tone(311.13, 0.2, 'sine', 0.06);
      window.setTimeout(() => tone(233.08, 0.32, 'sine', 0.06), 170);
      break;
  }
}

/** 轻触反馈，仅 Android 生效，自然降级 */
export function haptic(): void {
  if (typeof navigator === 'undefined') {
    return;
  }
  try {
    navigator.vibrate?.(10);
  } catch {
    // 忽略
  }
}
