/**
 * File type mappings adapted from OpenCode's FileIcon implementation.
 * Copyright (c) 2025 opencode; MIT license in public/licenses/opencode-file-icons.txt.
 * https://github.com/anomalyco/opencode/blob/dev/packages/ui/src/components/file-icon.tsx
 */
const fileNames: Record<string, string> = {
  // Documentation files
  'readme.md': 'Readme',
  'changelog.md': 'Changelog',
  'contributing.md': 'Contributing',
  'conduct.md': 'Conduct',
  license: 'Certificate',
  authors: 'Authors',
  credits: 'Credits',
  install: 'Installation',

  // Node.js files
  'package.json': 'Nodejs',
  'package-lock.json': 'Nodejs',
  'yarn.lock': 'Yarn',
  'pnpm-lock.yaml': 'Pnpm',
  'bun.lock': 'Bun',
  'bun.lockb': 'Bun',
  'bunfig.toml': 'Bun',
  '.nvmrc': 'Nodejs',
  '.node-version': 'Nodejs',

  // Docker files
  dockerfile: 'Docker',
  'docker-compose.yml': 'Docker',
  'docker-compose.yaml': 'Docker',
  '.dockerignore': 'Docker',

  // Config files
  'jest.config.js': 'Jest',
  'jest.config.ts': 'Jest',
  'jest.config.mjs': 'Jest',
  'vitest.config.js': 'Vitest',
  'vitest.config.ts': 'Vitest',
  'tailwind.config.js': 'Tailwindcss',
  'tailwind.config.ts': 'Tailwindcss',
  'turbo.json': 'Turborepo',
  'tsconfig.json': 'Tsconfig',
  'jsconfig.json': 'Jsconfig',
  '.eslintrc': 'Eslint',
  '.eslintrc.js': 'Eslint',
  '.eslintrc.json': 'Eslint',
  '.prettierrc': 'Prettier',
  '.prettierrc.js': 'Prettier',
  '.prettierrc.json': 'Prettier',
  'vite.config.js': 'Vite',
  'vite.config.ts': 'Vite',
  'webpack.config.js': 'Webpack',
  'rollup.config.js': 'Rollup',
  'astro.config.mjs': 'AstroConfig',
  'astro.config.js': 'AstroConfig',
  'next.config.js': 'Next',
  'next.config.mjs': 'Next',
  'nuxt.config.js': 'Nuxt',
  'nuxt.config.ts': 'Nuxt',
  'svelte.config.js': 'Svelte',
  'gatsby-config.js': 'Gatsby',
  'remix.config.js': 'Remix',
  'prisma.schema': 'Prisma',
  '.gitignore': 'Git',
  '.gitattributes': 'Git',
  makefile: 'Makefile',
  cmake: 'Cmake',
  'cargo.toml': 'Rust',
  'go.mod': 'GoMod',
  'go.sum': 'GoMod',
  'requirements.txt': 'Python',
  'pyproject.toml': 'Python',
  pipfile: 'Python',
  'poetry.lock': 'Poetry',
  gemfile: 'Gemfile',
  rakefile: 'Ruby',
  'composer.json': 'Php',
  'build.gradle': 'Gradle',
  'pom.xml': 'Maven',
  'deno.json': 'Deno',
  'deno.jsonc': 'Deno',
  'vercel.json': 'Vercel',
  'netlify.toml': 'Netlify',
  '.env': 'Tune',
  '.env.local': 'Tune',
  '.env.development': 'Tune',
  '.env.production': 'Tune',
  '.env.example': 'Tune',
  '.editorconfig': 'Editorconfig',
  'robots.txt': 'Robots',
  'favicon.ico': 'Favicon',
  browserlist: 'Browserlist',
  '.babelrc': 'Babel',
  'babel.config.js': 'Babel',
  'gulpfile.js': 'Gulp',
  'gruntfile.js': 'Grunt',
  'capacitor.config.json': 'Capacitor',
  'ionic.config.json': 'Ionic',
  'angular.json': 'Angular',
  '.storybook': 'Storybook',
  'storybook.config.js': 'Storybook',
  'cypress.config.js': 'Cypress',
  'playwright.config.js': 'Playwright',
  'puppeteer.config.js': 'Puppeteer',
  'wrangler.toml': 'Wrangler',
  'firebase.json': 'Firebase',
  supabase: 'Supabase',
  terraform: 'Terraform',
  kubernetes: 'Kubernetes',
  '.gitpod.yml': 'Gitpod',
  '.devcontainer': 'Vscode',
  'travis.yml': 'Travis',
  'appveyor.yml': 'Appveyor',
  '.circleci': 'Circleci',
  'renovate.json': 'Renovate',
  'dependabot.yml': 'Dependabot',
  'lerna.json': 'Lerna',
  'nx.json': 'Nx',
}

const fileExtensions: Record<string, string> = {
  // Test files
  'spec.ts': 'TestTs',
  'test.ts': 'TestTs',
  'spec.tsx': 'TestJsx',
  'test.tsx': 'TestJsx',
  'spec.js': 'TestJs',
  'test.js': 'TestJs',
  'spec.jsx': 'TestJsx',
  'test.jsx': 'TestJsx',

  // JavaScript/TypeScript
  'js.map': 'JavascriptMap',
  'd.ts': 'TypescriptDef',
  ts: 'Typescript',
  tsx: 'React_ts',
  js: 'Javascript',
  jsx: 'React',
  mjs: 'Javascript',
  cjs: 'Javascript',

  // Web languages
  html: 'Html',
  htm: 'Html',
  css: 'Css',
  scss: 'Sass',
  sass: 'Sass',
  less: 'Less',
  styl: 'Stylus',

  // Data formats
  json: 'Json',
  xml: 'Xml',
  yml: 'Yaml',
  yaml: 'Yaml',
  toml: 'Toml',
  hjson: 'Hjson',

  // Documentation
  md: 'Markdown',
  mdx: 'Mdx',
  tex: 'Tex',

  // Programming languages
  py: 'Python',
  pyx: 'Python',
  pyw: 'Python',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  kt: 'Kotlin',
  scala: 'Scala',
  php: 'Php',
  rb: 'Ruby',
  cs: 'Csharp',
  vb: 'Visualstudio',
  cpp: 'Cpp',
  cc: 'Cpp',
  cxx: 'Cpp',
  c: 'C',
  h: 'H',
  hpp: 'Hpp',
  swift: 'Swift',
  m: 'ObjectiveC',
  mm: 'ObjectiveCpp',
  dart: 'Dart',
  lua: 'Lua',
  pl: 'Perl',
  r: 'R',
  jl: 'Julia',
  hs: 'Haskell',
  elm: 'Elm',
  ml: 'Ocaml',
  clj: 'Clojure',
  cljs: 'Clojure',
  erl: 'Erlang',
  ex: 'Elixir',
  exs: 'Elixir',
  nim: 'Nim',
  zig: 'Zig',
  v: 'Vlang',
  odin: 'Odin',
  gleam: 'Gleam',
  grain: 'Grain',
  roc: 'Rocket',
  fs: 'Fsharp',

  // Shell scripts
  sh: 'Console',
  bash: 'Console',
  zsh: 'Console',
  fish: 'Console',
  ps1: 'Powershell',

  // Config/build files
  cfg: 'Settings',
  ini: 'Settings',
  conf: 'Settings',
  properties: 'Settings',

  // Media files
  svg: 'Svg',
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  gif: 'Image',
  webp: 'Image',
  bmp: 'Image',
  ico: 'Favicon',
  mp4: 'Video',
  mov: 'Video',
  avi: 'Video',
  webm: 'Video',
  mp3: 'Audio',
  wav: 'Audio',
  flac: 'Audio',

  // Archive files
  zip: 'Zip',
  tar: 'Zip',
  gz: 'Zip',
  rar: 'Zip',
  '7z': 'Zip',

  // Document files
  pdf: 'Pdf',
  doc: 'Word',
  docx: 'Word',
  ppt: 'Powerpoint',
  pptx: 'Powerpoint',
  xls: 'Document',
  xlsx: 'Document',

  // Database files
  sql: 'Database',
  db: 'Database',
  sqlite: 'Database',

  // Other
  env: 'Tune',
  log: 'Log',
  lock: 'Lock',
  key: 'Key',
  pem: 'Certificate',
  crt: 'Certificate',
  proto: 'Proto',
  graphql: 'Graphql',
  gql: 'Graphql',
  wasm: 'Webassembly',
  dockerfile: 'Docker',
}

function basenameOf(path: string) {
  return path.split('\\').join('/').split('/').filter(Boolean).pop() ?? ''
}

function dottedSuffixesDesc(name: string) {
  const suffixes = new Set([name])
  for (let index = 0; index < name.length; index++) {
    if (name[index] === '.' && index + 1 < name.length) {
      suffixes.add(name.slice(index + 1))
    }
  }
  return Array.from(suffixes).sort((left, right) => right.length - left.length)
}

export function projectFileIconName(path: string) {
  const base = basenameOf(path).toLowerCase()
  const byName = fileNames[base]
  if (byName) return byName

  for (const extension of dottedSuffixesDesc(base)) {
    const icon = fileExtensions[extension]
    if (icon) return icon
  }

  return 'Document'
}
