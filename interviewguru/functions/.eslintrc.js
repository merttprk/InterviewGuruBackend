module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    "indent": ["error", 2],
    // Google şablonunun 80 sütun ve zorunlu JSDoc kuralları bu kod tabanına uymuyor:
    // yorumlar Türkçe düz açıklama, tipler zaten TypeScript'te.
    "max-len": ["error", {"code": 120, "ignoreUrls": true, "ignoreStrings": true, "ignoreTemplateLiterals": true}],
    "require-jsdoc": "off",
    "valid-jsdoc": "off",
  },
};
