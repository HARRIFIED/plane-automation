/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!main.ts', '!**/index.ts'],
  coverageDirectory: '../coverage',
  clearMocks: true,
};
