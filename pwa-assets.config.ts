import {
  AllAppleDeviceNames,
  combinePresetAndAppleSplashScreens,
  defineConfig,
  minimal2023Preset,
} from '@vite-pwa/assets-generator/config';

const BACKGROUND = '#1c1c1e';

// Icons, favicon and iPad launch screens are generated from public/logo.svg at build time.
// Opaque assets (maskable, apple-touch, splash) use the app's dark background instead of white.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: combinePresetAndAppleSplashScreens(
    {
      ...minimal2023Preset,
      maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: BACKGROUND } },
      apple: { ...minimal2023Preset.apple, resizeOptions: { background: BACKGROUND } },
    },
    { padding: 0.5, resizeOptions: { background: BACKGROUND, fit: 'contain' } },
    AllAppleDeviceNames.filter((name) => name.startsWith('iPad')),
  ),
  images: ['public/logo.svg'],
});
