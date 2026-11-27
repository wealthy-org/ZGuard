"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Plays Perm's original 48-second ambient loop. Sound is enabled by default.
 * The component attempts autoplay immediately and, when a browser blocks
 * audible autoplay, starts on the visitor's first interaction instead.
 */
export default function AudioToggle() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const fadeFrame = useRef<number | null>(null);
  const enabledRef = useRef(true);
  const [enabled, setEnabled] = useState(true);
  const [blocked, setBlocked] = useState(false);

  const fade = (to: number, done?: () => void) => {
    const a = audio.current;
    if (!a) return;
    if (fadeFrame.current) cancelAnimationFrame(fadeFrame.current);
    const from = a.volume;
    const started = performance.now();
    const duration = 650;
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / duration);
      const eased = p * p * (3 - 2 * p);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * eased));
      if (p < 1) fadeFrame.current = requestAnimationFrame(tick);
      else done?.();
    };
    fadeFrame.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const a = new Audio("/audio/perm-circular-current.wav");
    a.loop = true;
    a.preload = "auto";
    a.volume = 0;
    audio.current = a;
    let disposed = false;

    const removeUnlockListeners = () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("wheel", unlock, true);
    };

    const start = async () => {
      if (disposed || !enabledRef.current || !a.paused) return;
      try {
        await a.play();
        if (disposed || !enabledRef.current) {
          a.pause();
          return;
        }
        fade(0.42);
        setBlocked(false);
        removeUnlockListeners();
      } catch {
        if (!disposed && enabledRef.current) setBlocked(true);
      }
    };

    const unlock = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".audio-toggle")) return;
      void start();
    };

    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("wheel", unlock, { capture: true, passive: true });
    void start();

    return () => {
      disposed = true;
      removeUnlockListeners();
      if (fadeFrame.current) cancelAnimationFrame(fadeFrame.current);
      a.pause();
      a.src = "";
      audio.current = null;
    };
  }, []);

  const toggle = async () => {
    const a = audio.current;
    if (!a) return;

    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      setBlocked(false);
      fade(0, () => a.pause());
      return;
    }

    enabledRef.current = true;
    setEnabled(true);
    try {
      await a.play();
      fade(0.42);
      setBlocked(false);
    } catch {
      setBlocked(true);
    }
  };

  return (
    <button
      className={`icon-button audio-toggle${enabled ? " is-playing" : ""}`}
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Turn off Perm background music" : "Turn on Perm background music"}
      title={blocked ? "Sound is on and will start after your first browser interaction" : "Perm original ambient loop · Circular Current"}
    >
      <span className="audio-bars" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span className="desktop-only">{enabled ? "Sound on" : "Sound off"}</span>
    </button>
  );
}
