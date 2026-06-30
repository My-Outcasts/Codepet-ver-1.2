import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'next-env.d.ts'] },
  ...next,
  ...nextTs,
  // Turn off rules that conflict with Prettier formatting.
  prettier,
];

export default eslintConfig;
