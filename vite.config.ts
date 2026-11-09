import { defineConfig } from 'vite';

export default defineConfig({
    base: '/quiz/',
    publicDir: false,
    build: {
        target: 'es2022',
        outDir: 'dist'
    }
});
