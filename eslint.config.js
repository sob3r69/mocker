import antfu from '@antfu/eslint-config';

export default antfu({
  react: {
    overrides: {
      'node/prefer-global/process':           'off',
      'react-hooks/exhaustive-deps':          'off',
      'react/no-array-index-key':             'off',
      'react-refresh/only-export-components': 'off',
      'eslint-comments/no-unlimited-disable': 'off',
    },
  },
  stylistic: {
    semi:      true,
    overrides: {
      'style/key-spacing': [
        'error',
        {
          multiLine: { beforeColon: false, afterColon: true },
          align:     { beforeColon: false, afterColon: true, on: 'value' },
        },
      ],
      'style/no-multi-spaces': [
        'error',
        {
          exceptions: { Property: true, ImportAttribute: true, TSTypeAnnotation: true },
        },
      ],
    },
  },
}, {
  ignores: ['**/*.yml'],
});
