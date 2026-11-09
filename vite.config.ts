import { defineConfig } from 'vite';
import { appAssetsPlugin, applicationVersion } from './scripts/build-assets.ts';

const version = applicationVersion();

export default defineConfig({
    base: '/quiz/',
    publicDir: 'public',
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [appAssetsPlugin(version)],
    build: {
        target: 'es2022',
        outDir: 'dist',
        manifest: false,
        sourcemap: false
    }
});
