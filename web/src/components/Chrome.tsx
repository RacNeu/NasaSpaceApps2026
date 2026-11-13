import { useEffect, useRef, useState } from "react";
import { audio } from "../audio";
import { useAudioOn } from "../hooks";

export interface SceneDef {
  id: string;
  label: string;
  code: string;
}

interface Props {
  scenes: SceneDef[];
  onSkip: () => void;
}

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export function Chrome({ scenes, onSkip }: Props) {
  const on = useAudioOn();
  const [active, setActive] = useState(scenes[0].id);
  const [menu, setMenu] = useState(false);
  const [showSkip, setShowSkip] = useState(true);
  const prev = useRef(scenes[0].id);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      let best = scenes[0].id;
      const line = window.innerHeight * 0.4;
      for (const s of scenes) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) best = s.id;
      }
      setActive((cur) => (cur === best ? cur : best));
      const first = document.getElementById(scenes[1].id);
      setShowSkip(!!first && first.getBoundingClientRect().top > window.innerHeight * 0.6);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scenes]);

  useEffect(() => {
    if (prev.current !== active) {
      prev.current = active;
      audio.sweep();
      audio.setIntensity(scenes.findIndex((s) => s.id === active) / (scenes.length - 1));
    }
  }, [active, scenes]);

  return (
    <>
      <div className="brackets" aria-hidden>
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      <div className="hud-left">
        <button className="hud-btn" onClick={() => setMenu((m) => !m)} aria-label="Scenes menu" aria-expanded={menu}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <button
          className={`hud-btn ${on ? "live" : ""}`}
          onClick={() => audio.toggle()}
          aria-label={on ? "Mute sound" : "Turn sound on"}
          aria-pressed={on}
          title={on ? "Sound on. Click to mute." : "Sound off. Click to enable."}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {on ? (
              <path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" />
            ) : (
              <>
                <path d="M2 12h20" />
                <path d="M5 5l14 14" />
              </>
            )}
          </svg>
        </button>
        {showSkip && (
          <button className="hud-skip" onClick={onSkip}>
            Skip intro
          </button>
        )}
      </div>

      {menu && (
        <nav className="menu-overlay" aria-label="Scenes" onClick={() => setMenu(false)}>
          <ul>
            {scenes.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    go(s.id);
                    setMenu(false);
                  }}
                >
                  <span className="mono">{s.code}</span>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <nav className="rail" aria-label="Scene progress">
        {scenes.map((s) => (
          <button key={s.id} className={active === s.id ? "on" : ""} onClick={() => go(s.id)} aria-label={s.label} aria-current={active === s.id}>
            <span className="rail-label mono">
              {s.code} {s.label}
            </span>
            <i />
          </button>
        ))}
      </nav>
    </>
  );
}
