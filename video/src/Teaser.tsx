import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { CLIPS, SCENES, TRIM_PAD, type Caption } from './scenes';

// Frame budget (30 fps): title + 5 scenes + end card, minus 6 fade overlaps
// of 12 frames each = exactly 900 frames = 30.0s.
const FPS = 30;
export const TITLE_F = 105;
export const SCENE_F = 150;
export const END_F = 117;
export const FADE_F = 12;
export const TOTAL_F =
  TITLE_F + SCENES.length * SCENE_F + END_F - (SCENES.length + 1) * FADE_F;

const GOLD = '#ffd94d';
const INK = 'rgba(13, 17, 26, 0.88)';

const Clip: React.FC<{ id: string; from?: number }> = ({ id, from = 0 }) => {
  const clip = CLIPS[id];
  return (
    <OffthreadVideo
      muted
      src={staticFile(clip.file)}
      startFrom={Math.round((clip.start + TRIM_PAD + from) * FPS)}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
};

// Bottom-left caption bar in the game HUD's visual language.
const CaptionBar: React.FC<{ caption: Caption }> = ({ caption }) => {
  const frame = useCurrentFrame();
  const inA = interpolate(frame, [8, 22], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const outA = interpolate(frame, [SCENE_F - 18, SCENE_F - 6], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const a = Math.min(inA, outA);
  const parts = caption.text.split('*');
  return (
    <div
      style={{
        position: 'absolute',
        left: 48,
        bottom: 44,
        maxWidth: 760,
        opacity: a,
        transform: `translateY(${(1 - inA) * 18}px)`,
        background: INK,
        border: '1px solid rgba(122, 143, 176, 0.35)',
        borderRadius: 12,
        padding: '18px 26px 20px',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          color: GOLD,
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {caption.kicker}
      </div>
      <div style={{ color: '#e8eef7', fontSize: 30, fontWeight: 600, lineHeight: 1.3 }}>
        {parts.map((p, i) =>
          i % 2 === 1 ? (
            <span key={i} style={{ color: GOLD }}>
              {p}
            </span>
          ) : (
            <span key={i}>{p}</span>
          )
        )}
      </div>
    </div>
  );
};

const Scene: React.FC<{ id: string; caption: Caption; offset?: number }> = ({
  id,
  caption,
  offset,
}) => (
  <AbsoluteFill style={{ background: '#0d111a' }}>
    <Clip id={id} from={offset} />
    <CaptionBar caption={caption} />
  </AbsoluteFill>
);

// Opener: the game's own animated title screen, with a gentle push-in.
const TitleShot: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, TITLE_F], [1, 1.05]);
  return (
    <AbsoluteFill style={{ background: '#0d111a' }}>
      <div style={{ width: '100%', height: '100%', transform: `scale(${scale})` }}>
        <Clip id="title" />
      </div>
    </AbsoluteFill>
  );
};

// Closer: darkened title screen with the pitch and the call to action.
const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const a = (from: number, to: number) =>
    interpolate(frame, [from, to], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  return (
    <AbsoluteFill style={{ background: '#0d111a' }}>
      {/* the night shot's lantern glow makes a calm, text-free backdrop */}
      <div style={{ width: '100%', height: '100%', filter: 'brightness(0.55) saturate(0.9)' }}>
        <Clip id="nacht" from={4.5} />
      </div>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(ellipse at center, rgba(9,12,20,0.5) 0%, rgba(9,12,20,0.85) 100%)',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            opacity: a(4, 18),
            color: GOLD,
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: 110,
            fontWeight: 700,
            textShadow: '0 5px 0 rgba(122,72,20,0.9), 0 14px 40px rgba(0,0,0,0.6)',
            lineHeight: 1,
          }}
        >
          Smallhands
        </div>
        <div
          style={{
            opacity: a(12, 26),
            color: '#c8d4e8',
            fontSize: 26,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            marginTop: 22,
          }}
        >
          Kleine Hände · Große Pläne
        </div>
        <div
          style={{
            opacity: a(30, 44),
            color: '#ffffff',
            fontSize: 34,
            fontWeight: 700,
            marginTop: 54,
          }}
        >
          Jetzt kostenlos im Browser spielen
        </div>
        <div style={{ opacity: a(40, 54), color: '#93a5c4', fontSize: 21, marginTop: 16 }}>
          12 Level · Editor &amp; Level-Generator · Tägliche Challenge · Deutsch/Englisch
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Teaser: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  // Master audio: gentle duck at the very end (the WAV already fades).
  const vol = interpolate(frame, [durationInFrames - 30, durationInFrames - 4], [0.9, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const t = () => linearTiming({ durationInFrames: FADE_F });
  // TransitionSeries requires Sequence/Transition as *direct* children, so the
  // timeline is assembled as a flat array (no fragments).
  const timeline: React.ReactNode[] = [
    <TransitionSeries.Sequence key="title" durationInFrames={TITLE_F}>
      <TitleShot />
    </TransitionSeries.Sequence>,
  ];
  for (const s of SCENES) {
    timeline.push(
      <TransitionSeries.Transition key={`t-${s.id}`} presentation={fade()} timing={t()} />,
      <TransitionSeries.Sequence key={s.id} durationInFrames={SCENE_F}>
        <Scene id={s.id} caption={s.caption} />
      </TransitionSeries.Sequence>
    );
  }
  timeline.push(
    <TransitionSeries.Transition key="t-end" presentation={fade()} timing={t()} />,
    <TransitionSeries.Sequence key="end" durationInFrames={END_F}>
      <EndCard />
    </TransitionSeries.Sequence>
  );
  return (
    <AbsoluteFill style={{ background: '#0d111a' }}>
      <Audio src={staticFile('music.wav')} volume={vol} />
      <TransitionSeries>{timeline}</TransitionSeries>
    </AbsoluteFill>
  );
};
