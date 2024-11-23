import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import terser from '@rollup/plugin-terser'
import copy from 'rollup-plugin-copy'

const createConfig = (input, output, name) => ({
  input,
  output: {
    file: `dist/${output}`,
    format: 'iife',
    name,
    sourcemap: true,
    globals: {
      'nostr-tools': 'NostrTools'
    }
  },
  external: ['nostr-tools'],
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false,
      mainFields: ['browser', 'module', 'main']
    }),
    commonjs({
      include: /node_modules/,
      transformMixedEsModules: true
    }),
    terser(),
    copy({
      targets: [
        { src: 'src/popup.html', dest: 'dist' },
        { src: 'src/style.css', dest: 'dist' },
        { src: 'src/manifest.json', dest: 'dist' },
        { src: 'src/sounds/*', dest: 'dist/sounds' },
        { src: 'src/icons/Logo.png', dest: 'dist/icons' },
        { src: 'src/icons/default-avatar.png', dest: 'dist/icons' },
        { 
          src: 'node_modules/nostr-tools/lib/nostr.bundle.js',
          dest: 'dist/lib',
          rename: 'nostr-tools.js'
        }
      ]
    })
  ]
});

export default [
  createConfig('src/background.js', 'background.js', 'Background'),
  {
    input: 'src/background-wrapper.js',
    output: {
      file: 'dist/background-wrapper.js',
      format: 'iife'
    }
  },
  createConfig('src/popup.js', 'popup.js', 'Popup'),
  createConfig('src/shared.js', 'shared.js', 'Shared'),
  createConfig('src/auth.js', 'auth.js', 'Auth'),
  createConfig('src/contact.js', 'contact.js', 'Contact'),
  createConfig('src/messages.js', 'messages.js', 'Messages'),
  createConfig('src/nip89.js', 'nip89.js', 'Nip89'),
  createConfig('src/userMetadata.js', 'userMetadata.js', 'UserMetadata'),
  createConfig('src/utils.js', 'utils.js', 'Utils')
];