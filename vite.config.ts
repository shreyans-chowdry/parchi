import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// React and ReactDOM load from cdnjs as UMD globals (allowed by the artifact CSP),
// everything else is bundled into one self-contained HTML file.
export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  esbuild: { jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment' },
  build: {
    target: 'es2020',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client'],
      output: {
        format: 'iife',
        globals: { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' },
        inlineDynamicImports: true,
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
