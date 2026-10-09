'use client';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { Ad, Side } from '../../shared/types';
import { fmt } from '../../lib/hooks';

interface AdCardProps {
  ad: Ad;
  brand: string;
  label: string;
  cls?: string;
  onClick?: () => void;
  pressed?: boolean;
  inert?: boolean;
}

export function AdCard({ ad, brand, label, cls = '', onClick, pressed, inert }: AdCardProps) {
  const style = { '--b1': ad.b1, '--b2': ad.b2, '--k': ad.k, '--a': ad.a } as Record<string, string>;
  return (
    <button
      type="button"
      disabled={inert}
      className={`ad ${ad.v} ${cls}`}
      style={style}
      onClick={onClick}
      aria-pressed={pressed}
      tabIndex={inert ? -1 : undefined}
      aria-label={`Ad ${label}: ${ad.copy}`}
    >
      {ad.image ? (
        <img className="adimg" src={ad.image} alt="" decoding="async" />
      ) : (
        <>
          <i className="sh s1" />
          <i className="sh s2" />
          <i className="sh s3" />
        </>
      )}
      <span className="brand">{brand}</span>
      <span className="lab">{label}</span>
      {!ad.image && (
        <>
          <span className="copy">{ad.copy}</span>
        </>
      )}
    </button>
  );
}

/** Points counter in the header; counts up with a pop when points land. */
export function Wallet({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (to <= from) {
      setShown(to);
      return;
    }
    const node = el.current;
    node?.classList.remove('pop');
    void node?.offsetWidth;
    node?.classList.add('pop');
    const t0 = performance.now() + 350;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - t0) / 900));
      setShown(Math.round(from + (to - from) * k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      setShown(to);
    };
  }, [value]);
  return (
    <span className="wallet" ref={el} aria-label={`${value} points`}>
      <i />
      <span>{fmt(shown)} pts</span>
    </span>
  );
}

export function Qr({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, text, { margin: 1, width: 320, color: { dark: '#10172A', light: '#FFFFFF' } }).catch(() => {});
  }, [text]);
  return <canvas ref={ref} role="img" aria-label={label} />;
}

export function SplitBar({ winner, split }: { winner: Side; split: Record<Side, number> }) {
  const lose: Side = winner === 'a' ? 'b' : 'a';
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(raf);
  }, [winner, split.a]);
  return (
    <div className="sbar">
      <div className="w" style={{ width: `${grown ? split[winner] : 50}%` }}>
        {winner.toUpperCase()} {split[winner]}%
      </div>
      <div className="l" style={{ width: `${grown ? split[lose] : 50}%` }}>
        {lose.toUpperCase()} {split[lose]}%
      </div>
    </div>
  );
}

export const Brand = () => (
  <span className="brandmark" aria-label="AdSpark and Predikta">
    <img src="/brand/adspark-white.png" alt="AdSpark" width={2160} height={720} />
    <span className="x" aria-hidden="true">×</span>
    <img src="/brand/predikta-white.png" alt="Predikta" width={1024} height={342} />
  </span>
);

export const Dots = ({ r }: { r: number }) => (
  <span className="dots">
    {[0, 1, 2].map((i) => (
      <i key={i} className={i <= r ? 'on' : ''} />
    ))}
  </span>
);
