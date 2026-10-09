import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  { ignores: ['.next/**','node_modules/**','test-results/**','playwright-report/**','next-env.d.ts','public/sw.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files:['**/*.{ts,tsx}'],plugins:{'react-hooks':hooks},rules:{'react-hooks/rules-of-hooks':'error','no-empty':['error',{allowEmptyCatch:true}] } }
);
