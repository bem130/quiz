import { defineConfig } from 'vite';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appAssetsPlugin, applicationVersion } from './scripts/build-assets.ts';

const version = applicationVersion();
const scratch = fileURLToPath(new URL('./tmp/', import.meta.url));

export default defineConfig({
    base: '/quiz/',
    publicDir: 'public',
    server: { watch: { ignored: file => {
        const candidate = relative(scratch, file);
        return candidate === '' || (candidate !== '..' && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate));
    } } },
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [appAssetsPlugin(version)],
    build: {
        target: 'es2022',
        outDir: 'dist',
        manifest: false,
        sourcemap: false
    }
});
