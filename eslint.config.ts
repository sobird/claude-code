import sobird from 'eslint-config-sobird'

export default sobird({
  // ignores: ["src/**/*"]
  stylistic: {
    semi: false,
  },
  perfectionist: {
    rules: {
      'perfectionist/sort-jsx-props': 'off',
      'perfectionist/sort-named-imports': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-union-types': 'off',
    },
  },
  import: {
    rules: {
      'import/enforce-node-protocol-usage': 'off',
    },
  },
})
