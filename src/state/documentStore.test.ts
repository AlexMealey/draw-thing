import { beforeEach, describe, expect, it } from 'vitest';
import { activeIndex, documentStore } from './documentStore';

const store = () => documentStore.getState();
const names = () => store().layers.map((l) => l.name);

describe('documentStore', () => {
  beforeEach(() => store().reset({ width: 100, height: 100, maxLayers: 3 }));

  it('starts on the background it is given, white by default', () => {
    expect(store().background).toEqual({ color: '#ffffff', visible: true });
    store().reset({
      width: 10,
      height: 10,
      maxLayers: 1,
      background: { color: '#f4efe4', visible: false },
    });
    expect(store().background).toEqual({ color: '#f4efe4', visible: false });
  });

  it('starts with one selected layer', () => {
    expect(names()).toEqual(['Layer 1']);
    expect(activeIndex(store())).toBe(0);
  });

  it('adds layers above the active one, up to the budget', () => {
    expect(store().addLayer()).not.toBeNull();
    store().selectLayer(store().layers[0]!.id);
    expect(store().addLayer()).not.toBeNull();
    expect(names()).toEqual(['Layer 1', 'Layer 3', 'Layer 2']);
    expect(store().layers[activeIndex(store())]!.name).toBe('Layer 3');
    expect(store().addLayer()).toBeNull();
  });

  it('never removes the last layer, and selects the layer below a removed active one', () => {
    store().removeLayer(store().activeLayerId);
    expect(names()).toEqual(['Layer 1']);
    store().addLayer();
    store().addLayer();
    store().removeLayer(store().activeLayerId);
    expect(names()).toEqual(['Layer 1', 'Layer 2']);
    expect(store().layers[activeIndex(store())]!.name).toBe('Layer 2');
  });

  it('moves layers within bounds', () => {
    store().addLayer();
    store().addLayer();
    const top = store().layers[2]!.id;
    store().moveLayer(top, -5);
    expect(names()).toEqual(['Layer 3', 'Layer 1', 'Layer 2']);
  });

  it('updates layer properties immutably', () => {
    const before = store().layers;
    store().updateLayer(before[0]!.id, { opacity: 0.5, blendMode: 'multiply' });
    expect(store().layers).not.toBe(before);
    expect(store().layers[0]).toMatchObject({ opacity: 0.5, blendMode: 'multiply' });
  });
});
