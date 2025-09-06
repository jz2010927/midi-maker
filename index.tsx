/**
 * @fileoverview Control real time music with a MIDI controller
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnalysisResponse, PlaybackState, Prompt, Style } from './types';
import { GoogleGenAI, LiveMusicFilteredPrompt, Type } from '@google/genai';
import { PromptDjMidi } from './components/PromptDjMidi';
import { ToastMessage } from './components/ToastMessage';
import { LiveMusicHelper } from './utils/LiveMusicHelper';
import { AudioAnalyser } from './utils/AudioAnalyser';
import { t } from './utils/i18n';

// FIX: Initialized GoogleGenAI with the correct API key environment variable and removed deprecated options.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const model = 'lyria-realtime-exp';

let keyToEnglish: Map<string, string>;
let englishToKey: Map<string, string>;

async function analyzeImage(
  imageData: {data: string, mimeType: string}, 
  styles: Style[]
): Promise<AnalysisResponse> {
  const imagePart = {
    inlineData: {
      mimeType: imageData.mimeType,
      data: imageData.data,
    },
  };

  // Flatten all prompts into a single list for the model
  const allPrompts = styles.flatMap(style => style.prompts.map(p => keyToEnglish.get(p.text) || p.text));

  const textPart = {
    text: `Analyze the attached image to determine the most suitable musical mood for a soundtrack.

From the provided list of musical descriptions, choose between 4 and 8 that best match the image's mood, content, and style.
Assign a weight between 0.5 and 1.5 to each of your chosen prompts. Higher weights indicate a stronger match.

Return your response ONLY in JSON format according to the provided schema.

**CRITICAL INSTRUCTION:** The 'text' values for the prompts you return MUST EXACTLY match one of the descriptions from the provided list.

Available musical descriptions:
${JSON.stringify(allPrompts)}`
  };

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { parts: [imagePart, textPart] },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          prompts: {
            type: Type.ARRAY,
            description: 'An array of 4 to 8 suggested prompts with weights.',
            items: {
              type: Type.OBJECT,
              properties: {
                text: {
                  type: Type.STRING,
                  description: 'The text key of the prompt from the provided list.',
                },
                weight: {
                  type: Type.NUMBER,
                  description: 'A suggested weight between 0.5 and 1.5.',
                },
              },
              required: ['text', 'weight'],
            },
          },
        },
        required: ['prompts'],
      },
    },
  });

  const jsonText = response.text.trim();
  const parsedResponse = JSON.parse(jsonText);
  
  // Translate model response back to keys
  parsedResponse.prompts.forEach((p: {text: string}) => {
    p.text = englishToKey.get(p.text) || p.text;
  });

  return parsedResponse;
}

async function analyzeAudio(
  audioData: {data: string, mimeType: string}, 
  styles: Style[]
): Promise<AnalysisResponse> {
  const audioPart = {
    inlineData: {
      mimeType: audioData.mimeType,
      data: audioData.data,
    },
  };

  const allPrompts = styles.flatMap(style => style.prompts.map(p => keyToEnglish.get(p.text) || p.text));

  const textPart = {
    text: `Analyze the attached audio clip to determine its musical style, mood, and instrumentation.

From the provided list of musical descriptions, choose between 4 and 8 that best describe the audio.
Assign a weight between 0.5 and 1.5 to each of your chosen prompts. Higher weights indicate a stronger match.

Return your response ONLY in JSON format according to the provided schema.

**CRITICAL INSTRUCTION:** The 'text' values for the prompts you return MUST EXACTLY match one of the descriptions from the provided list.

Available musical descriptions:
${JSON.stringify(allPrompts)}`
  };

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { parts: [audioPart, textPart] },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          prompts: {
            type: Type.ARRAY,
            description: 'An array of 4 to 8 suggested prompts with weights.',
            items: {
              type: Type.OBJECT,
              properties: {
                text: {
                  type: Type.STRING,
                  description: 'The text key of the prompt from the provided list.',
                },
                weight: {
                  type: Type.NUMBER,
                  description: 'A suggested weight between 0.5 and 1.5.',
                },
              },
              required: ['text', 'weight'],
            },
          },
        },
        required: ['prompts'],
      },
    },
  });

  const jsonText = response.text.trim();
  const parsedResponse = JSON.parse(jsonText);
  
  // Translate model response back to keys
  parsedResponse.prompts.forEach((p: {text: string}) => {
    p.text = englishToKey.get(p.text) || p.text;
  });

  return parsedResponse;
}


async function main() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(registration => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      }).catch(error => {
        console.log('ServiceWorker registration failed: ', error);
      });
    });
  }

  const enTranslations = await (await fetch('/locales/en.json')).json();
  keyToEnglish = new Map(Object.entries(enTranslations));
  englishToKey = new Map();
  keyToEnglish.forEach((val, key) => {
    englishToKey.set(val, key);
  });

  const initialPrompts = buildInitialPrompts(STYLES[0].prompts);

  const pdjMidi = new PromptDjMidi(initialPrompts, STYLES);
  pdjMidi.analyzeImage = analyzeImage;
  pdjMidi.analyzeAudio = analyzeAudio;
  document.body.appendChild(pdjMidi);

  const toastMessage = new ToastMessage();
  document.body.appendChild(toastMessage);

  const liveMusicHelper = new LiveMusicHelper(ai, model);
  liveMusicHelper.setWeightedPrompts(initialPrompts);

  const audioAnalyser = new AudioAnalyser(liveMusicHelper.audioContext);
  liveMusicHelper.extraDestination = audioAnalyser.node;

  pdjMidi.addEventListener('prompts-changed', ((e: Event) => {
    const customEvent = e as CustomEvent<Map<string, Prompt>>;
    const prompts = customEvent.detail;
    
    // Translate prompt keys to English for the model
    const englishPrompts = new Map<string, Prompt>();
    prompts.forEach((p, id) => {
      const englishText = keyToEnglish.get(p.text) || p.text;
      englishPrompts.set(id, {...p, text: englishText });
    });
    
    liveMusicHelper.setWeightedPrompts(englishPrompts);
  }));

  pdjMidi.addEventListener('play-pause', () => {
    // Only disable download when we are about to start a new playback.
    if (pdjMidi.playbackState === 'stopped' || pdjMidi.playbackState === 'paused') {
      pdjMidi.isDownloadable = false; 
    }
    liveMusicHelper.playPause();
  });

  liveMusicHelper.addEventListener('playback-state-changed', ((e: Event) => {
    const customEvent = e as CustomEvent<PlaybackState>;
    const playbackState = customEvent.detail;
    pdjMidi.playbackState = playbackState;
    playbackState === 'playing' ? audioAnalyser.start() : audioAnalyser.stop();
  }));

  liveMusicHelper.addEventListener('recording-available', () => {
    pdjMidi.isDownloadable = true;
  });

  pdjMidi.addEventListener('download-requested', () => {
    const blob = liveMusicHelper.getRecordedAudioBlob();
    if (!blob) {
      toastMessage.show(t('noAudioRecorded'));
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'prompt-dj-music.wav';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  });

  pdjMidi.addEventListener('loop-download-requested', async () => {
    pdjMidi.startLoopDownload();
    try {
        const blob = await liveMusicHelper.downloadLoop(20); // 20-second loop
        if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'prompt-dj-loop.wav';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
        } else {
            toastMessage.show(t('loopDownloadFailed'));
        }
    } catch (e) {
        console.error(e);
        toastMessage.show(t('loopDownloadFailed'));
    } finally {
        pdjMidi.finishLoopDownload();
    }
  });

  liveMusicHelper.addEventListener('filtered-prompt', ((e: Event) => {
    const customEvent = e as CustomEvent<LiveMusicFilteredPrompt>;
    const filteredPrompt = customEvent.detail;
    toastMessage.show(filteredPrompt.filteredReason!)

    const promptKey = englishToKey.get(filteredPrompt.text!) || filteredPrompt.text!;
    pdjMidi.addFilteredPrompt(promptKey);
  }));

  const errorToast = ((e: Event) => {
    const customEvent = e as CustomEvent<string>;
    const errorKey = customEvent.detail;
    toastMessage.show(t(errorKey));
  });

  liveMusicHelper.addEventListener('error', errorToast);
  pdjMidi.addEventListener('error', errorToast);

  audioAnalyser.addEventListener('audio-level-changed', ((e: Event) => {
    const customEvent = e as CustomEvent<number>;
    const level = customEvent.detail;
    pdjMidi.audioLevel = level;
  }));

  audioAnalyser.addEventListener('audio-data-updated', ((e: Event) => {
    const customEvent = e as CustomEvent<Uint8Array>;
    pdjMidi.frequencyData = customEvent.detail;
  }));
}

function buildInitialPrompts(defaultPrompts: { color: string; text: string; }[]) {
  // Pick 3 random prompts to start at weight = 1
  const startOn = [...defaultPrompts]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  const prompts = new Map<string, Prompt>();

  for (let i = 0; i < defaultPrompts.length; i++) {
    const promptId = `prompt-${i}`;
    const prompt = defaultPrompts[i];
    const { text, color } = prompt;
    prompts.set(promptId, {
      promptId,
      text,
      weight: startOn.includes(prompt) ? 1 : 0,
      cc: i,
      color,
    });
  }

  return prompts;
}

const STYLES: Style[] = [
  {
    name: 'style_cozy_game',
    prompts: [
      { color: '#3dffab', text: 'prompt_cozy_village_theme' },
      { color: '#2af6de', text: 'prompt_2d_exploration' },
      { color: '#d9b2ff', text: 'prompt_quiet_puzzle_music' },
      { color: '#5200ff', text: 'prompt_calm_synth_pads' },
      { color: '#9900ff', text: 'prompt_soothing_atmosphere' },
      { color: '#d8ff3e', text: 'prompt_gentle_strings' },
      { color: '#ffdd28', text: 'prompt_simple_piano_melody' },
      { color: '#ff25f6', text: 'prompt_peaceful_flute' },
      { color: '#2af6de', text: 'prompt_relaxing_chiptune' },
      { color: '#3dffab', text: 'prompt_stardew_valley_inspired' },
      { color: '#d9b2ff', text: 'prompt_ghibli_esque_piano' },
      { color: '#9900ff', text: 'prompt_8_bit_lullaby' },
      { color: '#5200ff', text: 'prompt_underwater_level' },
      { color: '#d8ff3e', text: 'prompt_mysterious_forest' },
      { color: '#ffdd28', text: 'prompt_lofi_beats' },
      { color: '#ff25f6', text: 'prompt_ambient_soundscape' },
    ],
  },
  {
    name: 'style_cinematic_orchestra',
    prompts: [
        { color: '#c9a469', text: 'prompt_epic_strings_section' },
        { color: '#a98c5a', text: 'prompt_triumphant_brass_fanfare' },
        { color: '#e0d6c1', text: 'prompt_delicate_woodwinds' },
        { color: '#8b4513', text: 'prompt_thundering_timpani_drums' },
        { color: '#f0e68c', text: 'prompt_soaring_french_horns' },
        { color: '#d2b48c', text: 'prompt_mournful_cello_solo' },
        { color: '#bDB76B', text: 'prompt_glimmering_harp_arpeggios' },
        { color: '#eee8aa', text: 'prompt_mysterious_oboe_melody' },
        { color: '#d2b48c', text: 'prompt_powerful_orchestral_swell' },
        { color: '#c9a469', text: 'prompt_action_movie_soundtrack' },
        { color: '#a98c5a', text: 'prompt_cinematic_tension_building' },
        { color: '#e0d6c1', text: 'prompt_emotional_piano_and_strings' },
        { color: '#8b4513', text: 'prompt_marching_snare_drums' },
        { color: '#f0e68c', text: 'prompt_playful_pizzicato_strings' },
        { color: '#bDB76B', text: 'prompt_choir_singing_in_latin' },
        { color: '#eee8aa', text: 'prompt_sweeping_orchestral_theme' },
    ],
  },
  {
    name: 'style_electronic_dance',
    prompts: [
      { color: '#ff00ff', text: 'prompt_driving_techno_beat' },
      { color: '#00ffff', text: 'prompt_uplifting_trance_melody' },
      { color: '#ffff00', text: 'prompt_funky_house_bassline' },
      { color: '#ff0000', text: 'prompt_hardstyle_kick_drum' },
      { color: '#00ff00', text: 'prompt_wobbly_dubstep_bass' },
      { color: '#0000ff', text: 'prompt_progressive_house_synth' },
      { color: '#ff7f00', text: 'prompt_catchy_synthpop_arpeggio' },
      { color: '#7fff00', text: 'prompt_glitchy_idm_percussion' },
      { color: '#007fff', text: 'prompt_classic_90s_rave_stabs' },
      { color: '#ff007f', text: 'prompt_deep_house_chords' },
      { color: '#7f00ff', text: 'prompt_atmospheric_drum_and_bass' },
      { color: '#00ff7f', text: 'prompt_acid_house_303_bassline' },
      { color: '#ff4500', text: 'prompt_big_room_festival_synth' },
      { color: '#adff2f', text: 'prompt_synthwave_retro_pads' },
      { color: '#4169e1', text: 'prompt_minimal_techno_groove' },
      { color: '#da70d6', text: 'prompt_euphoric_hard_dance_melody' },
    ],
  },
  {
    name: 'style_ambient_chill',
    prompts: [
      { color: '#87ceeb', text: 'prompt_floating_synth_pads' },
      { color: '#f0e68c', text: 'prompt_gentle_electric_piano' },
      { color: '#98fb98', text: 'prompt_slow_echoing_guitar' },
      { color: '#dda0dd', text: 'prompt_soft_atmospheric_textures' },
      { color: '#b0c4de', text: 'prompt_minimalist_ambient_drone' },
      { color: '#e6e6fa', text: 'prompt_relaxing_nature_sounds' },
      { color: '#faebd7', text: 'prompt_warm_analog_synth_wash' },
      { color: '#afeeee', text: 'prompt_peaceful_meditative_tones' },
      { color: '#d3d3d3', text: 'prompt_subtle_sparse_percussion' },
      { color: '#fffacd', text: 'prompt_ethereal_vocal_pads' },
      { color: '#add8e6', text: 'prompt_calm_flowing_soundscape' },
      { color: '#f5f5dc', text: 'prompt_lofi_hip_hop_beat' },
      { color: '#e0ffff', text: 'prompt_dreamy_reverb_heavy_melody' },
      { color: '#faf0e6', text: 'prompt_soothing_background_noise' },
      { color: '#fff0f5', text: 'prompt_weightless_space_music' },
      { color: '#f0fff0', text: 'prompt_gentle_evolving_soundscape' },
    ]
  },
  {
    name: 'style_lofi_hip_hop',
    prompts: [
      { color: '#d4a373', text: 'prompt_dusty_vinyl_crackle' },
      { color: '#faedcd', text: 'prompt_jazzy_piano_chords' },
      { color: '#fefae0', text: 'prompt_chill_boom_bap_drum_beat' },
      { color: '#e9c46a', text: 'prompt_smooth_rhodes_keyboard' },
      { color: '#f4a261', text: 'prompt_mellow_bassline' },
      { color: '#e76f51', text: 'prompt_reverb_drenched_saxophone' },
      { color: '#d4a373', text: 'prompt_chopped_vocal_samples' },
      { color: '#faedcd', text: 'prompt_rainy_day_mood' },
      { color: '#fefae0', text: 'prompt_study_beats' },
      { color: '#e9c46a', text: 'prompt_warm_analog_synth_pad' },
      { color: '#f4a261', text: 'prompt_nostalgic_melody' },
      { color: '#e76f51', text: 'prompt_tape_hiss' },
      { color: '#d4a373', text: 'prompt_laid_back_guitar_lick' },
      { color: '#faedcd', text: 'prompt_soft_synth_arpeggio' },
      { color: '#fefae0', text: 'prompt_anime_opening_theme' },
      { color: '#e9c46a', text: 'prompt_cozy_coffee_shop_vibe' },
    ],
  },
  {
    name: 'style_solo_piano',
    prompts: [
      { color: '#f8f9fa', text: 'prompt_emotional_cinematic_piano' },
      { color: '#e9ecef', text: 'prompt_delicate_soft_melody' },
      { color: '#dee2e6', text: 'prompt_powerful_dramatic_chords' },
      { color: '#ced4da', text: 'prompt_classical_sonata_style' },
      { color: '#adb5bd', text: 'prompt_minimalist_piano_piece' },
      { color: '#6c757d', text: 'prompt_flowing_arpeggios' },
      { color: '#f8f9fa', text: 'prompt_melancholy_waltz' },
      { color: '#e9ecef', text: 'prompt_improvisational_jazz_piano' },
      { color: '#dee2e6', text: 'prompt_rippling_piano_runs' },
      { color: '#ced4da', text: 'prompt_sustained_pedal_resonance' },
      { color: '#adb5bd', text: 'prompt_joyful_upbeat_tune' },
      { color: '#6c757d', text: 'prompt_introspective_and_thoughtful' },
      { color: '#f8f9fa', text: 'prompt_modern_neo_classical' },
      { color: '#e9ecef', text: 'prompt_erik_satie_inspired' },
      { color: '#dee2e6', text: 'prompt_chopin_esque_nocturne' },
      { color: '#ced4da', text: 'prompt_sparse_haunting_notes' },
    ],
  },
  {
    name: 'style_funk_and_soul',
    prompts: [
      { color: '#ffbe0b', text: 'prompt_groovy_bassline' },
      { color: '#fb5607', text: 'prompt_tight_drum_break' },
      { color: '#ff006e', text: 'prompt_syncopated_rhythm_guitar' },
      { color: '#8338ec', text: 'prompt_funky_clavinet_riff' },
      { color: '#3a86ff', text: 'prompt_soulful_brass_section_stabs' },
      { color: '#ffbe0b', text: 'prompt_hammond_organ_swells' },
      { color: '#fb5607', text: 'prompt_classic_70s_soul' },
      { color: '#ff006e', text: 'prompt_upbeat_dance_floor_groove' },
      { color: '#8338ec', text: 'prompt_wah_wah_guitar' },
      { color: '#3a86ff', text: 'prompt_vibrant_horn_section' },
      { color: '#ffbe0b', text: 'prompt_james_brown_inspired' },
      { color: '#fb5607', text: 'prompt_driving_percussion' },
      { color: '#ff006e', text: 'prompt_slick_electric_piano' },
      { color: '#8338ec', text: 'prompt_catchy_vocal_ad_libs' },
      { color: '#3a86ff', text: 'prompt_in_the_pocket_rhythm' },
      { color: '#ffbe0b', text: 'prompt_disco_strings' },
    ],
  },
  {
    name: 'style_world_music',
    prompts: [
      { color: '#588157', text: 'prompt_african_tribal_drums' },
      { color: '#a3b18a', text: 'prompt_spanish_flamenco_guitar' },
      { color: '#dad7cd', text: 'prompt_indian_sitar_and_tabla' },
      { color: '#344e41', text: 'prompt_irish_folk_fiddle' },
      { color: '#3a5a40', text: 'prompt_caribbean_steel_drums' },
      { color: '#588157', text: 'prompt_japanese_koto_melody' },
      { color: '#a3b18a', text: 'prompt_arabic_oud' },
      { color: '#dad7cd', text: 'prompt_latin_american_percussion' },
      { color: '#344e41', text: 'prompt_australian_didgeridoo_drone' },
      { color: '#3a5a40', text: 'prompt_balkan_brass_band' },
      { color: '#588157', text: 'prompt_andean_pan_flute' },
      { color: '#a3b18a', text: 'prompt_celtic_harp' },
      { color: '#dad7cd', text: 'prompt_reggae_rhythm_section' },
      { color: '#344e41', text: 'prompt_mystical_throat_singing' },
      { color: '#3a5a40', text: 'prompt_global_fusion_beat' },
      { color: '#588157', text: 'prompt_energetic_samba_rhythm' },
    ],
  },
  {
    name: 'style_synthwave',
    prompts: [
      { color: '#ff00ff', text: 'prompt_retro_80s_synth_lead' },
      { color: '#ff69b4', text: 'prompt_gated_reverb_drums' },
      { color: '#da70d6', text: 'prompt_driving_arpeggiated_bassline' },
      { color: '#00ffff', text: 'prompt_dreamy_analog_pads' },
      { color: '#4169e1', text: 'prompt_nostalgic_saxophone_solo' },
      { color: '#ee82ee', text: 'prompt_outrun_driving_music' },
      { color: '#ff00ff', text: 'prompt_neon_soaked_atmosphere' },
      { color: '#ff69b4', text: 'prompt_classic_synth_brass_stabs' },
      { color: '#da70d6', text: 'prompt_linndrum_machine_beat' },
      { color: '#00ffff', text: 'prompt_blade_runner_inspired' },
      { color: '#4169e1', text: 'prompt_dark_synthwave_vibe' },
      { color: '#ee82ee', text: 'prompt_shimmering_synth_bells' },
      { color: '#ff00ff', text: 'prompt_electric_guitar_with_chorus' },
      { color: '#ff69b4', text: 'prompt_vhs_tape_aesthetic' },
      { color: '#da70d6', text: 'prompt_futuristic_sci_fi_soundtrack' },
      { color: '#00ffff', text: 'prompt_video_game_boss_music' },
    ],
  },
  {
    name: 'style_rock_anthem',
    prompts: [
      { color: '#d00000', text: 'prompt_powerful_electric_guitar_riff' },
      { color: '#ffba08', text: 'prompt_driving_stadium_drum_beat' },
      { color: '#370617', text: 'prompt_heavy_distorted_guitar_chords' },
      { color: '#6a040f', text: 'prompt_thundering_bass_line' },
      { color: '#9d0208', text: 'prompt_epic_guitar_solo' },
      { color: '#d00000', text: 'prompt_arena_rock_feel' },
      { color: '#ffba08', text: 'prompt_soaring_vocal_melody_instrumental' },
      { color: '#370617', text: 'prompt_classic_rock_organ' },
      { color: '#6a040f', text: 'prompt_hard_hitting_snare_drum' },
      { color: '#9d0208', text: 'prompt_energetic_and_upbeat' },
      { color: '#d00000', text: 'prompt_ac_dc_style' },
      { color: '#ffba08', text: 'prompt_queen_inspired' },
      { color: '#370617', text: 'prompt_gritty_raw_guitar_tone' },
      { color: '#6a040f', text: 'prompt_anthemic_chorus' },
      { color: '#9d0208', text: 'prompt_power_ballad' },
      { color: '#d00000', text: 'prompt_crunchy_rhythm_guitar' },
    ],
  },
  {
    name: 'style_jazz_club',
    prompts: [
      { color: '#1d3557', text: 'prompt_smoky_saxophone_solo' },
      { color: '#457b9d', text: 'prompt_walking_bassline' },
      { color: '#a8dadc', text: 'prompt_swinging_ride_cymbal' },
      { color: '#f1faee', text: 'prompt_cool_jazz_piano_chords' },
      { color: '#e63946', text: 'prompt_improvisational_trumpet' },
      { color: '#1d3557', text: 'prompt_late_night_jazz_club_vibe' },
      { color: '#457b9d', text: 'prompt_brushes_on_the_snare' },
      { color: '#a8dadc', text: 'prompt_bebop_melody' },
      { color: '#f1faee', text: 'prompt_smooth_jazz_guitar' },
      { color: '#e63946', text: 'prompt_muted_trumpet_sound' },
      { color: '#1d3557', text: 'prompt_relaxed_and_sophisticated' },
      { color: '#457b9d', text: 'prompt_intricate_drum_fills' },
      { color: '#a8dadc', text: 'prompt_vibraphone_solo' },
      { color: '#f1faee', text: 'prompt_classic_blue_note_feel' },
      { color: '#e63946', text: 'prompt_double_bass_solo' },
      { color: '#1d3557', text: 'prompt_warm_mellow_trombone' },
    ],
  },
  {
    name: 'style_reggae_dub',
    prompts: [
      { color: '#008000', text: 'prompt_deep_sub_bassline' },
      { color: '#ffff00', text: 'prompt_one_drop_drum_beat' },
      { color: '#ff0000', text: 'prompt_skanking_guitar_chops' },
      { color: '#008000', text: 'prompt_reggae_organ_bubble' },
      { color: '#ffff00', text: 'prompt_echoing_snare_hits' },
      { color: '#ff0000', text: 'prompt_melodica_lead' },
      { color: '#008000', text: 'prompt_heavy_reverb_and_delay' },
      { color: '#ffff00', text: 'prompt_dub_sirens_and_sfx' },
      { color: '#ff0000', text: 'prompt_roots_reggae_vibe' },
      { color: '#008000', text: 'prompt_positive_uplifting_feel' },
      { color: '#ffff00', text: 'prompt_steppers_rhythm' },
      { color: '#ff0000', text: 'prompt_brass_section_stabs' },
      { color: '#008000', text: 'prompt_rimshot_heavy_percussion' },
      { color: '#ffff00', text: 'prompt_tape_echo_effects' },
      { color: '#ff0000', text: 'prompt_irievibes' },
      { color: '#008000', text: 'prompt_chilled_out_groove' },
    ],
  },
  {
    name: 'style_epic_fantasy',
    prompts: [
      { color: '#ffd700', text: 'prompt_heroic_horn_melody' },
      { color: '#c0c0c0', text: 'prompt_sweeping_string_ensemble' },
      { color: '#b0e0e6', text: 'prompt_elven_choir' },
      { color: '#a52a2a', text: 'prompt_dwarven_war_drums' },
      { color: '#dda0dd', text: 'prompt_mystical_harp_arpeggios' },
      { color: '#228b22', text: 'prompt_enchanted_forest_ambience' },
      { color: '#98fb98', text: 'prompt_celtic_flute_solo' },
      { color: '#ff4500', text: 'prompt_grand_orchestral_crescendo' },
      { color: '#8b4513', text: 'prompt_ancient_battle_hymn' },
      { color: '#afeeee', text: 'prompt_magical_glockenspiel' },
      { color: '#dc143c', text: 'prompt_dragon_s_roar_sfx' },
      { color: '#4682b4', text: 'prompt_adventurous_theme' },
      { color: '#e6e6fa', text: 'prompt_haunting_vocal_lines' },
      { color: '#fafad2', text: 'prompt_majestic_triumphant_fanfare' },
      { color: '#4b0082', text: 'prompt_ominous_low_brass' },
      { color: '#daa520', text: 'prompt_quest_for_glory' },
    ],
  },
  {
    name: 'style_cyberpunk',
    prompts: [
      { color: '#ff00ff', text: 'prompt_distorted_synth_bass' },
      { color: '#00ffff', text: 'prompt_glitching_drum_machine' },
      { color: '#ffff00', text: 'prompt_neon_arpeggios' },
      { color: '#4b0082', text: 'prompt_dystopian_city_ambience' },
      { color: '#ff4500', text: 'prompt_aggressive_industrial_beat' },
      { color: '#7fffd4', text: 'prompt_cybernetic_vocal_fx' },
      { color: '#8a2be2', text: 'prompt_dark_atmospheric_pads' },
      { color: '#00ff00', text: 'prompt_high_tech_sound_design' },
      { color: '#ff1493', text: 'prompt_driving_electronic_sequence' },
      { color: '#1e90ff', text: 'prompt_futuristic_megacity_soundtrack' },
      { color: '#c71585', text: 'prompt_gritty_synth_leads' },
      { color: '#ff0000', text: 'prompt_computer_malfunction_sfx' },
      { color: '#00bfff', text: 'prompt_pulsating_bassline' },
      { color: '#696969', text: 'prompt_rainy_noir_atmosphere' },
      { color: '#f0e68c', text: 'prompt_corporate_espionage_mood' },
      { color: '#adff2f', text: 'prompt_transhumanist_theme' },
    ],
  },
  {
    name: 'style_acoustic_folk',
    prompts: [
      { color: '#cd853f', text: 'prompt_fingerpicked_acoustic_guitar' },
      { color: '#8fbc8f', text: 'prompt_gentle_harmonica' },
      { color: '#f4a460', text: 'prompt_strummed_mandolin' },
      { color: '#8b4513', text: 'prompt_warm_upright_bass' },
      { color: '#deb887', text: 'prompt_soft_vocal_harmonies_instrumental' },
      { color: '#556b2f', text: 'prompt_folk_fiddle_melody' },
      { color: '#d2b48c', text: 'prompt_simple_heartfelt_tune' },
      { color: '#daa520', text: 'prompt_banjo_roll' },
      { color: '#a0522d', text: 'prompt_foot_stomping_percussion' },
      { color: '#ff8c00', text: 'prompt_campfire_singalong_vibe' },
      { color: '#bdb76b', text: 'prompt_tambourine_and_shaker' },
      { color: '#bc8f8f', text: 'prompt_intimate_storytelling_mood' },
      { color: '#778899', text: 'prompt_melancholic_acoustic_ballad' },
      { color: '#2e8b57', text: 'prompt_rolling_hills_soundscape' },
      { color: '#b8860b', text: 'prompt_cajon_drum' },
      { color: '#rosybrown', text: 'prompt_nostalgic_and_wistful' },
    ],
  },
  {
    name: 'style_horror_ambience',
    prompts: [
      { color: '#8b0000', text: 'prompt_dissonant_strings' },
      { color: '#ffdead', text: 'prompt_creepy_music_box' },
      { color: '#2f4f4f', text: 'prompt_low_suspenseful_drone' },
      { color: '#ff0000', text: 'prompt_sudden_jump_scare_sfx' },
      { color: '#f5fffa', text: 'prompt_haunting_whispers' },
      { color: '#696969', text: 'prompt_unsettling_atonal_piano' },
      { color: '#00008b', text: 'prompt_eerie_soundscape' },
      { color: '#b22222', text: 'prompt_distant_screams' },
      { color: '#708090', text: 'prompt_building_tension' },
      { color: '#add8e6', text: 'prompt_ghostly_choir' },
      { color: '#a0522d', text: 'prompt_creaking_floorboards_sfx' },
      { color: '#483d8b', text: 'prompt_psychological_thriller_score' },
      { color: '#dc143c', text: 'prompt_heartbeat_rhythm' },
      { color: '#556b2f', text: 'prompt_scratching_sounds' },
      { color: '#800080', text: 'prompt_something_is_wrong_feel' },
      { color: '#4682b4', text: 'prompt_supernatural_presence' },
    ],
  }
];

main();