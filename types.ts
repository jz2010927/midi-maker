/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
export interface Prompt {
  readonly promptId: string;
  text: string;
  weight: number;
  cc: number;
  color: string;
}

export interface ControlChange {
  channel: number;
  cc: number;
  value: number;
}

export type PlaybackState = 'stopped' | 'playing' | 'loading' | 'paused';

export interface Style {
  name: string;
  prompts: { color: string; text: string; }[];
}

export interface AnalysisResponse {
  prompts: { text: string; weight: number }[];
}