# Auto-Refactor

🚀 **Intelligent code refactoring and context compression for AI-assisted development**

A TypeScript CLI tool that automatically refactors large files into modular components and compresses context for better AI workflows. Perfect for projects using Cursor, Claude, ChatGPT, and other AI coding assistants.

## ✨ Features

- **🔧 Automatic Refactoring**: Intelligently splits large files into focused, modular components
- **🧠 Framework-Aware**: Smart detection and handling of React, Next.js, Vue, and more
- **📦 Component Extraction**: Separates types, hooks, utilities, and sub-components
- **💾 Context Compression**: Optimizes files and logs for AI token limits
- **👀 Watch Mode**: Real-time monitoring and automatic refactoring
- **🔄 CI/CD Integration**: GitHub Actions workflow templates
- **💽 Safe Operations**: Automatic backups and dry-run mode
- **📊 Analytics**: Track refactoring impact and code improvements

## 🚀 Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/aressanch/auto-refactor.git
cd auto-refactor

# Install dependencies
npm install

# Build the project
npm run build

# Link for global usage (optional)
npm link
```

### Usage

```bash
# Initialize in your project
auto-refactor init

# Scan for files that need refactoring
auto-refactor scan

# Run refactoring (dry run first)
auto-refactor run --dry

# Run actual refactoring
auto-refactor run
```

## 📖 CLI Commands

### `init` - Initialize Configuration
```bash
auto-refactor init [options]

Options:
  -f, --framework <framework>  Target framework (react, nextjs, vue, svelte)
  -y, --yes                   Skip interactive prompts
```

### `scan` - Analyze Codebase
```bash
auto-refactor scan [options]

Options:
  -c, --config <path>         Path to config file
  -v, --verbose              Verbose output
```

### `run` - Execute Refactoring
```bash
auto-refactor run [options]

Options:
  -c, --config <path>         Path to config file
  --dry                       Dry run - show what would be changed
  --no-backup                 Skip creating backups
  -v, --verbose              Verbose output
```

### `compress` - Context Compression
```bash
auto-refactor compress [file] [options]

Arguments:
  file                        Specific file to compress

Options:
  --max-tokens <number>       Maximum tokens per file (default: 4000)
  -o, --output <path>         Output file path
```

## ⚙️ Configuration

The tool creates a `.auto-refactor.json` config file:

```json
{
  "maxLines": 200,
  "targetDirectories": ["src", "components", "lib", "utils"],
  "fileExtensions": [".tsx", ".ts", ".jsx", ".js"],
  "excludePatterns": ["node_modules", ".next", "*.test.*"],
  "refactoring": {
    "createTypes": true,
    "extractHooks": true,
    "extractUtils": true,
    "splitComponents": true
  }
}
```

## 🏗️ How It Works

### React/Next.js Component Refactoring

**Before** - Large component (300+ lines):
```
MyLargeComponent.tsx
├── Imports
├── Types & Interfaces  
├── Custom Hooks
├── Utility Functions
├── Sub-components
└── Main Component
```

**After** - Modular structure:
```
MyLargeComponent/
├── index.tsx          # Main component
├── types.ts           # TypeScript definitions
├── hooks.ts           # Custom hooks
├── utils.ts           # Utility functions
└── SubComponent.tsx   # Extracted components
```

### Context Compression

Intelligently compresses files and logs for AI workflows:

- **Preserves**: Errors, warnings, important commands, recent content
- **Compresses**: Verbose output, redundant information, old logs
- **Optimizes**: For AI token limits and context windows

## 🔧 Framework Support

| Framework | Status | Features |
|-----------|--------|----------|
| **React** | ✅ Full | Components, hooks, utils extraction |
| **Next.js** | ✅ Full | App Router, Pages Router, API routes |
| **TypeScript** | ✅ Full | Type extraction, interface organization |
| **Vue** | 🚧 Planned | Components, composables |
| **Svelte** | 🚧 Planned | Components, stores, utilities |

## 🚀 CI/CD Integration

Add automated refactoring to your workflow:

```yaml
# .github/workflows/auto-refactor.yml
name: Auto Refactor

on:
  schedule:
    - cron: '0 2 * * 0'  # Weekly on Sundays

jobs:
  refactor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npm run refactor -- --dry
      - run: npm run refactor
      - uses: peter-evans/create-pull-request@v5
        with:
          title: '🤖 Auto-Refactor: Code Optimization'
```

## 💡 Benefits

- **Better AI Assistance**: Smaller files fit better in AI context windows
- **Improved Maintainability**: Modular code is easier to understand and modify
- **Enhanced Reusability**: Extracted hooks and utilities can be shared
- **Faster Development**: Better code organization speeds up development
- **Team Collaboration**: Smaller files are easier to review and merge

## 🛡️ Safety Features

- **Automatic Backups**: All files backed up before changes
- **Dry Run Mode**: Preview changes before applying
- **Git Integration**: Respects .gitignore patterns
- **Non-destructive**: Preserves original functionality

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

```bash
git clone https://github.com/aressanch/auto-refactor.git
cd auto-refactor
npm install
npm run dev
```

## 📄 License

MIT © [Ares Sanchez](https://github.com/aressanch)

## 🔗 Links

- **Repository**: [https://github.com/aressanch/auto-refactor](https://github.com/aressanch/auto-refactor)
- **Issues**: [GitHub Issues](https://github.com/aressanch/auto-refactor/issues)

---

**Built for the AI-assisted development community** 🤖❤️