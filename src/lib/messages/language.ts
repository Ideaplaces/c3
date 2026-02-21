const extensionMap: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  md: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  toml: 'toml',
  ini: 'ini',
  env: 'properties',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  vue: 'vue',
  svelte: 'svelte',
  tf: 'hcl',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  zig: 'zig',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure',
  scala: 'scala',
}

export function getLanguageFromPath(filePath: string): string {
  const parts = filePath.split('/')
  const fileName = parts[parts.length - 1].toLowerCase()

  // Handle special filenames
  if (fileName === 'dockerfile') return 'dockerfile'
  if (fileName === 'makefile') return 'makefile'
  if (fileName.endsWith('.config.ts') || fileName.endsWith('.config.js')) {
    return fileName.endsWith('.ts') ? 'typescript' : 'javascript'
  }

  const ext = fileName.split('.').pop() || ''
  return extensionMap[ext] || 'text'
}
