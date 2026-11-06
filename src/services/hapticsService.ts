/**
 * Steam Deck Controller Haptic Feedback Service
 *
 * Interacts with the Gamepad Vibration Actuator API to deliver native
 * SteamOS-grade tactile feedback across D-pad movement, button confirmations,
 * roulette spinning, and UI transitions.
 */

export type HapticsIntensity = 'soft' | 'medium' | 'strong';

class HapticsService {
  public enabled: boolean = true;
  public intensity: HapticsIntensity = 'medium';

  private getMultiplier(): number {
    switch (this.intensity) {
      case 'soft':
        return 0.45;
      case 'strong':
        return 1.4;
      case 'medium':
      default:
        return 0.9;
    }
  }

  /**
   * Internal trigger to pulse vibration actuators across connected gamepads
   */
  private trigger(durationMs: number, weak: number, strong: number) {
    if (!this.enabled || typeof navigator === 'undefined' || !navigator.getGamepads) {
      return;
    }

    try {
      const mult = this.getMultiplier();
      const w = Math.min(1.0, Math.max(0.0, weak * mult));
      const s = Math.min(1.0, Math.max(0.0, strong * mult));

      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp && gp.connected && gp.vibrationActuator) {
          if (typeof gp.vibrationActuator.playEffect === 'function') {
            gp.vibrationActuator
              .playEffect('dual-rumble', {
                startDelay: 0,
                duration: Math.max(10, durationMs),
                weakMagnitude: w,
                strongMagnitude: s,
              })
              .catch(() => {});
          } else if ((gp.vibrationActuator as any).pulse) {
            // Fallback for pulse API
            (gp.vibrationActuator as any).pulse(w, durationMs).catch(() => {});
          }
        }
      }
    } catch {
      // Gamepad actuator access may fail silently
    }
  }

  /** Crisp, subtle 15ms click for D-pad navigation and focus change */
  tick() {
    this.trigger(16, 0.35, 0.15);
  }

  /** Satisfying confirmation pulse for 'A' select */
  select() {
    this.trigger(32, 0.65, 0.35);
  }

  /** Gentle dampening pulse for 'B' back / dismiss */
  back() {
    this.trigger(24, 0.25, 0.4);
  }

  /** Crisp mechanical tick for roulette / slot machine spins */
  spinTick() {
    this.trigger(12, 0.45, 0.2);
  }

  /** Double celebration pulse on game roll or sync success */
  success() {
    this.trigger(35, 0.6, 0.4);
    setTimeout(() => {
      this.trigger(55, 0.8, 0.6);
    }, 80);
  }

  /** Warning or error rumble */
  warning() {
    this.trigger(90, 0.85, 0.95);
  }
}

export const hapticsService = new HapticsService();
