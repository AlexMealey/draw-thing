import { beforeEach, describe, expect, it } from 'vitest';
import { PRESETS } from '../engine/brush/presets';
import { brushSections, currentAdjustments, currentPreset, toolStore } from './toolStore';

const store = () => toolStore.getState();
const sectionNames = () => brushSections(store()).map((list) => list.map((p) => p.name));
const builtInNames = PRESETS.map((p) => p.name);

describe('custom brushes', () => {
  beforeEach(() => toolStore.setState(toolStore.getInitialState(), true));

  it('saves an edited built-in brush as a new one and resets the original', () => {
    store().setOverride('ink', { spacing: 0.3, hardness: 0.5 });
    store().adjust({ size: 42, smoothing: 0.8 });

    const id = store().saveAsNewBrush('ink');

    expect(store().presetIds.paint).toBe(id);
    expect(store().overrides.ink).toBeUndefined();
    const saved = currentPreset(store());
    expect(saved).toMatchObject({ id, name: 'Ink 2', spacing: 0.3, stabilization: 0.8 });
    expect(saved.tip.hardness).toBe(0.5);
    expect(currentAdjustments(store()).size).toBe(42);
    expect(store().adjustments['paint:ink']?.smoothing).toBe(PRESETS[0]!.stabilization);
  });

  it('numbers copies and edits custom brushes in place', () => {
    const a = store().saveAsNewBrush('ink');
    const b = store().saveAsNewBrush(a);
    expect(store().customBrushes.map((c) => c.preset.name)).toEqual(['Ink 2', 'Ink 3']);

    store().updateCustomBrush(b, { flow: 0.25 });
    expect(currentPreset(store()).flow).toBe(0.25);
    expect(store().overrides[b]).toBeUndefined();
  });

  it('lists pinned brushes above the built-in ones and the rest below', () => {
    const a = store().saveAsNewBrush('ink');
    store().saveAsNewBrush('pencil');
    expect(sectionNames()).toEqual([[], builtInNames, ['Ink 2', 'Pencil 2']]);

    store().togglePin(a);
    expect(sectionNames()).toEqual([['Ink 2'], builtInNames, ['Pencil 2']]);
  });

  it('falls back to the default brush when the selected custom one is deleted', () => {
    const id = store().saveAsNewBrush('marker');
    store().deleteCustomBrush(id);
    expect(store().customBrushes).toEqual([]);
    expect(store().presetIds.paint).toBe('ink');
    expect(store().adjustments[`paint:${id}`]).toBeUndefined();
  });
});
