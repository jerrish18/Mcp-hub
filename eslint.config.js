import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'mobile/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
