import React from 'react';
import { Composition } from 'remotion';
import { Teaser, TOTAL_F } from './Teaser';

export const Root: React.FC = () => (
  <Composition
    id="Teaser"
    component={Teaser}
    durationInFrames={TOTAL_F}
    fps={30}
    width={1280}
    height={720}
  />
);
