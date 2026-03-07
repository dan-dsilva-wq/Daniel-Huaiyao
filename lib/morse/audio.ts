'use client';

export class MorseToneManager {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private oscillator: OscillatorNode | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
    }
    return this.audioContext;
  }

  async start(frequency = 640) {
    const context = this.getContext();
    if (!context) return;

    if (context.state === 'suspended') {
      await context.resume();
    }

    if (this.oscillator) return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, context.currentTime + 0.02);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();

    this.oscillator = oscillator;
    this.gainNode = gain;
  }

  stop() {
    const context = this.getContext();
    if (!context || !this.oscillator || !this.gainNode) return;

    const stopAt = context.currentTime + 0.03;
    this.gainNode.gain.cancelScheduledValues(context.currentTime);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, context.currentTime);
    this.gainNode.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    this.oscillator.stop(stopAt + 0.01);
    this.oscillator = null;
    this.gainNode = null;
  }

  cleanup() {
    this.stop();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }
}
