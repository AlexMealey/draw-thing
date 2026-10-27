import { beforeEach, describe, expect, it } from 'vitest';
import { activePalette, DEFAULT_PALETTE, MAX_PALETTE_COLORS, paletteStore } from './paletteStore';

const store = () => paletteStore.getState();
const names = () => store().palettes.map((p) => p.name);

describe('paletteStore', () => {
  beforeEach(() => paletteStore.setState(paletteStore.getInitialState(), true));

  it('starts with the default palette shown in the color panel', () => {
    expect(names()).toEqual(['Default']);
    expect(activePalette(store())?.colors).toEqual(DEFAULT_PALETTE);
  });

  it('numbers new palettes whose name is taken', () => {
    store().create('Palette');
    store().create('Palette');
    store().create('Default');
    expect(names()).toEqual(['Default', 'Palette', 'Palette 2', 'Default 2']);
  });

  it('renames without clashing with another palette', () => {
    const id = store().create('Skin');
    store().rename(id, 'Default');
    expect(names()).toEqual(['Default', 'Default 2']);
    store().rename(id, 'Default 2'); // its own name is free
    expect(names()).toEqual(['Default', 'Default 2']);
  });

  it('adds and removes colors, up to the limit', () => {
    const id = store().create('Mine', ['#ff0000']);
    store().addColor(id, '#00ff00');
    store().addColor(id, '#0000ff');
    store().removeColor(id, 0);
    const mine = () => store().palettes.find((p) => p.id === id)!;
    expect(mine().colors).toEqual(['#00ff00', '#0000ff']);

    const full = store().create(
      'Full',
      Array.from({ length: 300 }, () => '#123456'),
    );
    store().addColor(full, '#ffffff');
    expect(store().palettes.find((p) => p.id === full)!.colors).toHaveLength(MAX_PALETTE_COLORS);
  });

  it('shows the first palette left when the shown one is deleted', () => {
    const a = store().create('A');
    store().remove('default');
    expect(store().activeId).toBe(a);
    store().remove(a);
    expect(store().activeId).toBeNull();
    const b = store().create('B');
    expect(store().activeId).toBe(b); // the only palette is shown
  });

  it('imports palettes from a file', () => {
    const ids = store().importPalettes([
      { name: 'Sunset', colors: ['#ff8800'] },
      { name: 'Sunset', colors: ['#220044'] },
    ]);
    expect(ids).toHaveLength(2);
    expect(names()).toEqual(['Default', 'Sunset', 'Sunset 2']);
  });
});
