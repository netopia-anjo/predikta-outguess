'use client';
import type { CSSProperties } from 'react';
import type { Ad, Board, ContentPayload } from '@/shared/types';
import { fmt, manilaTime } from '@/lib/hooks';

function PreviewAd({ ad, brand, label }: { ad: Ad; brand: string; label: string }) {
  const style = { '--b1': ad.b1, '--b2': ad.b2, '--k': ad.k, '--a': ad.a } as CSSProperties;
  return <figure className={`ad play-preview-ad ${ad.v}`} style={style} aria-label={`Ad ${label}`}>
    {ad.image ? <img className="adimg" src={ad.image} alt={ad.visual} decoding="async" /> : <>
      <i className="sh s1" aria-hidden="true" /><i className="sh s2" aria-hidden="true" /><i className="sh s3" aria-hidden="true" />
    </>}
    <span className="brand">{brand}</span><span className="lab">{label}</span>
    {!ad.image && <figcaption className="copy">{ad.copy}</figcaption>}
  </figure>;
}

function releaseTime(ms: number) {
  const day = (time: number) => new Date(time).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const date = day(ms) === day(Date.now()) ? 'today' : new Date(ms).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  return `${date} at ${manilaTime(ms)} (Manila time)`;
}

export function PhoneLanding({ content, board }: { content: ContentPayload; board?: Board | null }) {
  const audience = content.audiences[0];
  const preview = audience?.rounds[0];
  const gc = board?.gc;
  const rewardTitle = !gc ? 'Checking reward availability…' : gc.availableNow > 0
    ? `${fmt(gc.availableNow)} GCash ${gc.availableNow === 1 ? 'reward' : 'rewards'} available now`
    : gc.nextDropAt ? 'Next GCash release' : 'Rewards fully allocated.';
  const rewardDetail = !gc ? null : gc.availableNow > 0 ? 'Finish all 3 rounds, while supplies last.'
    : gc.nextDropAt ? releaseTime(gc.nextDropAt) : 'You can still play for your score.';
  return <>
    <div className="hero play-hero">
      <i className="orb" aria-hidden="true" /><i className="orb two" aria-hidden="true" />
      <span className="eyebrow">Back your instincts</span>
      <h1>Outguess<br /><em>the crowd.</em></h1>
      <p>Two ads. One audience.<br />Which one would you back?</p>
    </div>
    <p className="play-facts"><b>3 rounds</b><span aria-hidden="true">·</span><b>~3 minutes</b></p>
    {preview && <section className="play-preview" aria-labelledby="play-preview-title">
      <div className="play-preview-heading"><div><span className="eyebrow">{audience.name}</span><h2 id="play-preview-title">Predict their favorite.</h2></div><span className="play-preview-badge" aria-hidden="true">A or B?</span></div>
      <div className="play-preview-pair">
        <PreviewAd ad={preview.a} brand={preview.brand} label="A" />
        <span className="play-versus" aria-hidden="true">VS</span>
        <PreviewAd ad={preview.b} brand={preview.brand} label="B" />
      </div>
    </section>}
    <section className="play-rewards" aria-label="Reward availability">
      <span className="play-reward-icon" aria-hidden="true">₱</span><div><h2>{rewardTitle}</h2>{rewardDetail && <p>{rewardDetail}</p>}</div>
    </section>
    <details className="play-leaders">
      <summary>Today’s leaders</summary>
      {!board ? <p className="muted">Loading today’s leaders…</p> : board.leaderboard.length ?
        <ol>{board.leaderboard.slice(0, 3).map((player, i) => <li key={player.id}><span className="play-leader-rank" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><span className="play-leader-name">{player.name}</span><b>{fmt(player.score)}<small> pts</small></b></li>)}</ol>
        : <p className="muted">Be the first to finish today.</p>}
    </details>
    <p className="tagline play-tagline"><span><b className="pk">Predikta</b> informs the decision.</span><span><b className="as">AdSpark</b> activates the strategy.</span></p>
  </>;
}
