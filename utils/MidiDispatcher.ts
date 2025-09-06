/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import type { ControlChange } from '../types';

/** Simple class for dispatching MIDI CC messages as events. */
export class MidiDispatcher extends EventTarget {
  private access: MIDIAccess | null = null;
  activeMidiInputId: string | null = null;

  private readonly onMidiMessage = (event: MIDIMessageEvent) => {
    const input = event.target as MIDIInput;
    if (input.id !== this.activeMidiInputId) return;

    const { data } = event;
    if (!data) {
      console.error('MIDI message has no data');
      return;
    }

    const statusByte = data[0];
    const channel = statusByte & 0x0f;
    const messageType = statusByte & 0xf0;

    const isControlChange = messageType === 0xb0;
    if (!isControlChange) return;

    const detail: ControlChange = { cc: data[1], value: data[2], channel };
    this.dispatchEvent(
      new CustomEvent<ControlChange>('cc-message', { detail }),
    );
  };

  private readonly onStateChange = () => {
    if (!this.access) return;

    const inputIds = [...this.access.inputs.keys()];
    if (this.activeMidiInputId && !this.access.inputs.has(this.activeMidiInputId)) {
      this.activeMidiInputId = inputIds.length > 0 ? inputIds[0] : null;
    }

    for (const input of this.access.inputs.values()) {
      input.onmidimessage = this.onMidiMessage;
    }
    
    this.dispatchEvent(new CustomEvent('midi-devices-changed'));
  };

  async getMidiAccess(): Promise<string[]> {

    if (this.access) {
      return [...this.access.inputs.keys()];
    }

    if (!navigator.requestMIDIAccess) {
      throw new Error('unsupportedMidiError');
    }

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      throw new Error('midiAccessError');
    }

    this.access.onstatechange = this.onStateChange;

    for (const input of this.access.inputs.values()) {
      input.onmidimessage = this.onMidiMessage;
    }

    const inputIds = [...this.access.inputs.keys()];

    if (inputIds.length > 0 && this.activeMidiInputId === null) {
      this.activeMidiInputId = inputIds[0];
    }

    return inputIds;
  }

  getDeviceName(id: string): string | null {
    if (!this.access) {
      return null;
    }
    const input = this.access.inputs.get(id);
    return input ? input.name : null;
  }
}