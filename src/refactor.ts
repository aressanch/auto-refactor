import * as fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import { ensureDirectoryExists, getFileLineCount } from './utils/fileUtils';
import { logger } from './utils/logger';

export interface RefactorConfig {
  maxLines: number;
  targetDirectories: string[];
  fileExtensions: string[];
  excludePatterns: string[];
  watchMode: boolean;
  contextCompression: {
    enabled: boolean;
    maxContextLines: number;
    compressionRatio: number;
  };
  refactoring: {
    createTypes: boolean;
    extractHooks: boolean;
    extractUtils: boolean;
    splitComponents: boolean;
  };
}

export interface FileToRefactor {
  path: string;
  lines: number;
  framework: string;
}

export interface RefactorResult {
  originalFile: string;
  newFiles: string[];
  linesReduced: number;
  success: boolean;
  error?: string;
  analysis?: string[];
}

export interface RunOptions {
  dryRun?: boolean;
  createBackups?: boolean;
  verbose?: boolean;
}

export interface CompressOptions {
  watch?: boolean;
  maxTokens?: number;
  output?: string;
}

export class AutoRefactor {
  private config: RefactorConfig;
  private configPath: string;
  private projectRoot: string;

  constructor(configPath?: string) {
    this.configPath = configPath || '.auto-refactor.json';
    this.projectRoot = process.cwd();
    this.config = this.loadConfig();
  }

  private loadConfig(): RefactorConfig {
    const defaultConfig: RefactorConfig = {
      maxLines: 200,
      targetDirectories: ['src', 'components', 'lib', 'utils'],
      fileExtensions: ['.tsx', '.ts', '.jsx', '.js'],
      excludePatterns: ['node_modules', '.next', '*.test.*', 'dist', 'build'],
      watchMode: true,
      contextCompression: {
        enabled: true,
        maxContextLines: 200,
        compressionRatio: 0.4,
      },
      refactoring: {
        createTypes: true,
        extractHooks: true,
        extractUtils: true,
        splitComponents: true,
      },
    };

    const configFile = path.join(this.projectRoot, this.configPath);
    if (fs.existsSync(configFile)) {
      try {
        const userConfig = fs.readJsonSync(configFile);
        return { ...defaultConfig, ...userConfig };
      } catch (error) {
        logger.warning(`Failed to load config file: ${error}`);
      }
    }

    return defaultConfig;
  }

  private saveConfig(): void {
    const configFile = path.join(this.projectRoot, this.configPath);
    try {
      fs.writeJsonSync(configFile, this.config, { spaces: 2 });
    } catch (error) {
      logger.error(`Failed to save config file: ${error}`);
    }
  }

  private detectFramework(): string {
    const packageJsonPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = fs.readJsonSync(packageJsonPath);
        const dependencies = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };

        if (dependencies.next) return 'nextjs';
        if (dependencies.react) return 'react';
        if (dependencies.vue) return 'vue';
        if (dependencies.svelte) return 'svelte';
      } catch (error) {
        logger.debug(`Failed to read package.json: ${error}`);
      }
    }
    return 'unknown';
  }

  async init(
    options: { framework?: string; yes?: boolean } = {}
  ): Promise<void> {
    logger.header('Initializing Auto-Refactor');

    const framework = options.framework || this.detectFramework();
    logger.info(`Detected framework: ${framework}`);

    // Create config file
    this.saveConfig();
    logger.success('Created .auto-refactor.json configuration file');

    // Create backup directory
    const backupDir = path.join(this.projectRoot, '.refactor-backups');
    await ensureDirectoryExists(backupDir);
    logger.success('Created backup directory');

    // Add to .gitignore
    const gitignorePath = path.join(this.projectRoot, '.gitignore');
    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    }

    if (!gitignoreContent.includes('.refactor-backups')) {
      gitignoreContent += '\n# Auto-refactor backups\n.refactor-backups/\n';
      fs.writeFileSync(gitignorePath, gitignoreContent);
      logger.success('Updated .gitignore');
    }

    // Add NPM scripts
    const packageJsonPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = fs.readJsonSync(packageJsonPath);
      packageJson.scripts = {
        ...packageJson.scripts,
        refactor: 'auto-refactor run',
        'refactor:scan': 'auto-refactor scan',
        'refactor:watch': 'auto-refactor watch',
        'compress:context': 'auto-refactor compress',
        'compress:watch': 'auto-refactor compress --watch',
      };
      fs.writeJsonSync(packageJsonPath, packageJson, { spaces: 2 });
      logger.success('Added NPM scripts to package.json');
    }

    logger.success('Auto-refactor initialized successfully!');
  }

  async scan(): Promise<FileToRefactor[]> {
    logger.header('Scanning for files to refactor');

    const filesToRefactor: FileToRefactor[] = [];
    const framework = this.detectFramework();

    for (const dir of this.config.targetDirectories) {
      const targetDir = path.join(this.projectRoot, dir);
      if (!fs.existsSync(targetDir)) continue;

      const pattern = `${targetDir}/**/*{${this.config.fileExtensions.join(',')}}`;
      const files = await glob(pattern, {
        ignore: this.config.excludePatterns.map((pattern) =>
          path.join(this.projectRoot, pattern)
        ),
      });

      for (const file of files) {
        const lines = await getFileLineCount(file);
        if (lines > this.config.maxLines) {
          filesToRefactor.push({
            path: file,
            lines,
            framework,
          });
        }
      }
    }

    logger.info(`Found ${filesToRefactor.length} files that need refactoring`);
    return filesToRefactor;
  }

  async run(options: RunOptions = {}): Promise<RefactorResult[]> {
    logger.header('Running Auto-Refactor');

    const filesToRefactor = await this.scan();
    if (filesToRefactor.length === 0) {
      logger.info('No files need refactoring');
      return [];
    }

    const results: RefactorResult[] = [];

    for (const file of filesToRefactor) {
      try {
        if (options.dryRun) {
          logger.info(`[DRY RUN] Analyzing: ${file.path}`);
          const content = await fs.readFile(file.path, 'utf8');
          const suggestions = await this.analyzeFile(file.path, content);
          const result: RefactorResult = {
            originalFile: file.path,
            newFiles: suggestions.suggestedFiles,
            linesReduced: suggestions.estimatedReduction,
            success: true,
            analysis: suggestions.analysis,
          };
          results.push(result);
          continue;
        }

        logger.progress(`Refactoring: ${file.path}`);

        if (options.createBackups !== false) {
          await this.createBackup(file.path);
        }

        const result = await this.refactorFile(file);
        results.push(result);

        if (result.success) {
          logger.success(`✅ ${file.path} -> ${result.newFiles.length} files`);
        } else {
          logger.error(`❌ Failed to refactor ${file.path}: ${result.error}`);
        }
      } catch (error) {
        logger.error(`Error refactoring ${file.path}: ${error}`);
        results.push({
          originalFile: file.path,
          newFiles: [],
          linesReduced: 0,
          success: false,
          error: String(error),
        });
      }
    }

    return results;
  }

  async watch(): Promise<void> {
    logger.info('Watch mode is not implemented yet');
    // TODO: Implement file watching
  }

  async compress(file?: string, _options: CompressOptions = {}): Promise<void> {
    logger.info('Context compression is not implemented yet');
    // TODO: Implement context compression
  }

  // Helper methods for content extraction and file manipulation

  private extractFragments(content: string): string[] {
    const fragments: string[] = [];
    const lines = content.split('\n');
    let currentFragment = '';
    let inFragment = false;
    let backquoteCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Look for fragment declarations - constants that contain template literals
      if ((line.trim().startsWith('const ') || line.trim().startsWith('export const ')) &&
          (line.includes('Fragment') || line.includes('fragment')) &&
          line.includes('=') &&
          line.includes('`')) {
        inFragment = true;
        currentFragment = line;
        backquoteCount = (line.match(/`/g) || []).length;
      } else if ((line.trim().startsWith('const ') || line.trim().startsWith('export const ')) &&
                 line.includes('=') &&
                 line.includes('`') &&
                 !line.includes('GraphQlQuery') &&
                 !line.includes('query') &&
                 !line.includes('mutation') &&
                 !line.includes('subscription')) {
        // This is likely a fragment-like constant
        inFragment = true;
        currentFragment = line;
        backquoteCount = (line.match(/`/g) || []).length;
      } else if (inFragment) {
        currentFragment += '\n' + line;

        // Count backticks in this line
        const lineBackquotes = (line.match(/`/g) || []).length;
        backquoteCount += lineBackquotes;

        // If we have an even number of backticks and found a semicolon, we're done
        if (backquoteCount % 2 === 0 && line.includes(';')) {
          fragments.push(currentFragment.trim());
          currentFragment = '';
          inFragment = false;
          backquoteCount = 0;
        }
      }
    }

    return fragments;
  }

  private extractQueriesByPattern(content: string, pattern: RegExp): string[] {
    const queries: string[] = [];
    const lines = content.split('\n');
    let currentQuery = '';
    let inQuery = false;
    let braceCount = 0;
    let inGraphQlObject = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if we're inside the GraphQlQuery object
      if (line.includes('const GraphQlQuery = {')) {
        inGraphQlObject = true;
        continue;
      }

      // Skip if we're not in the GraphQlQuery object yet
      if (!inGraphQlObject) continue;

      // Check if we've reached the end of the GraphQlQuery object
      if (line.trim() === '};' && braceCount === 0) {
        inGraphQlObject = false;
        continue;
      }

      // Look for method declarations that match the pattern
      if (line.trim().match(/^\w+:\s*\(.*\)\s*=>\s*\{/) && pattern.test(line)) {
        inQuery = true;
        currentQuery = line;
        braceCount = 1; // We start with 1 because of the opening brace in the arrow function
      } else if (inQuery) {
        currentQuery += '\n' + line;

        // Count braces
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }

        // Check if we've reached the end of the method
        if (braceCount === 0) {
          // Look for the closing brace followed by comma or end
          if (line.trim().endsWith('},') || line.trim().endsWith('}')) {
            // Clean up the query - remove trailing comma if it's the last method
            let cleanQuery = currentQuery.trim();
            if (cleanQuery.endsWith('},')) {
              cleanQuery = cleanQuery.slice(0, -1); // Remove trailing comma
            }
            queries.push(cleanQuery);
            currentQuery = '';
            inQuery = false;
          }
        }
      }
    }

    return queries;
  }

  private extractRemainingQueries(content: string, excludePatterns: RegExp[]): string[] {
    const queries: string[] = [];
    const lines = content.split('\n');
    let currentQuery = '';
    let inQuery = false;
    let braceCount = 0;
    let inGraphQlObject = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if we're inside the GraphQlQuery object
      if (line.includes('const GraphQlQuery = {')) {
        inGraphQlObject = true;
        continue;
      }

      // Skip if we're not in the GraphQlQuery object yet
      if (!inGraphQlObject) continue;

      // Check if we've reached the end of the GraphQlQuery object
      if (line.trim() === '};' && braceCount === 0) {
        inGraphQlObject = false;
        continue;
      }

      // Look for method declarations that DON'T match any of the exclude patterns
      if (line.trim().match(/^\w+:\s*\(.*\)\s*=>\s*\{/) &&
          !excludePatterns.some(pattern => pattern.test(line))) {
        inQuery = true;
        currentQuery = line;
        braceCount = 1; // We start with 1 because of the opening brace in the arrow function
      } else if (inQuery) {
        currentQuery += '\n' + line;

        // Count braces
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }

        // Check if we've reached the end of the method
        if (braceCount === 0) {
          // Look for the closing brace followed by comma or end
          if (line.trim().endsWith('},') || line.trim().endsWith('}')) {
            queries.push(currentQuery.trim());
            currentQuery = '';
            inQuery = false;
          }
        }
      }
    }

    return queries;
  }

  private extractCommonTypes(content: string): string[] {
    const commonTypes: string[] = [];

    // Extract enums (these are usually common)
    const enumMatches = content.match(/export\s+enum\s+\w+[^}]+}/g);
    if (enumMatches) {
      commonTypes.push(...enumMatches);
    }

    // Extract basic utility types
    const basicTypes = [
      'string',
      'number',
      'boolean',
      'Date',
      'null',
      'undefined',
      'Pagination',
      'Response',
      'Error',
      'Status',
      'Config',
    ];

    const lines = content.split('\n');
    for (const line of lines) {
      if (
        (line.includes('export type') || line.includes('export interface')) &&
        basicTypes.some((type) =>
          line.toLowerCase().includes(type.toLowerCase())
        )
      ) {
        commonTypes.push(line.trim());
      }
    }

    return commonTypes;
  }

  private extractTypesByPattern(content: string, pattern: RegExp): string[] {
    const types: string[] = [];
    const lines = content.split('\n');
    let currentType = '';
    let inType = false;
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (
        (line.includes('export interface') ||
          line.includes('export type') ||
          line.includes('export enum')) &&
        pattern.test(line)
      ) {
        inType = true;
        currentType = line;
        braceCount = line.includes('{') ? 1 : 0;
      } else if (inType) {
        currentType += '\n' + line;

        // Count braces to find the end of the type definition
        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }

        if (braceCount <= 0 || line.includes(';')) {
          types.push(currentType.trim());
          currentType = '';
          inType = false;
        }
      }
    }

    return types;
  }

  private extractCommonTypeNames(commonTypes: string[]): string[] {
    const names: string[] = [];

    for (const type of commonTypes) {
      const match = type.match(/(?:export\s+)?(?:type|interface|enum)\s+(\w+)/);
      if (match) {
        names.push(match[1]);
      }
    }

    return names;
  }

  private splitContentIntoChunks(content: string, maxLines: number): string[] {
    const lines = content.split('\n');
    const chunks: string[] = [];
    let currentChunk = '';
    let currentLines = 0;

    for (const line of lines) {
      if (currentLines >= maxLines && line.trim() === '') {
        chunks.push(currentChunk.trim());
        currentChunk = '';
        currentLines = 0;
      } else {
        currentChunk += line + '\n';
        currentLines++;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  private createGraphQLIndexFile(baseName: string, newFiles: string[]): string {
    const imports = newFiles
      .filter((file) => !file.includes('index'))
      .map((file) => {
        const fileName = path.basename(file, '.ts');
        const exportName = fileName
          .replace(`${baseName}-`, '')
          .replace('-', '_');
        return `import * as ${exportName} from './${fileName}';`;
      })
      .join('\n');

    const exports = newFiles
      .filter((file) => !file.includes('index'))
      .map((file) => {
        const fileName = path.basename(file, '.ts');
        const exportName = fileName
          .replace(`${baseName}-`, '')
          .replace('-', '_');
        return `  ${exportName},`;
      })
      .join('\n');

    return `${imports}\n\nexport {\n${exports}\n};\n`;
  }

  private createGraphQLMainFile(baseName: string, newFiles: string[]): string {
    const imports = newFiles
      .filter((file) => !file.includes('index'))
      .map((file) => {
        const fileName = path.basename(file, '.ts');
        if (fileName.includes('fragments')) {
          return `import * as fragments from './${fileName}';`;
        } else if (fileName.includes('bot-queries')) {
          return `import { botQueries } from './${fileName}';`;
        } else if (fileName.includes('deal-queries')) {
          return `import { dealQueries } from './${fileName}';`;
        } else if (fileName.includes('user-queries')) {
          return `import { userQueries } from './${fileName}';`;
        } else if (fileName.includes('exchange-queries')) {
          return `import { exchangeQueries } from './${fileName}';`;
        } else if (fileName.includes('other-queries')) {
          return `import { otherQueries } from './${fileName}';`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');

    const exportParts = [];
    if (newFiles.some(file => file.includes('fragments'))) {
      exportParts.push('...fragments');
    }
    if (newFiles.some(file => file.includes('bot-queries'))) {
      exportParts.push('...botQueries');
    }
    if (newFiles.some(file => file.includes('deal-queries'))) {
      exportParts.push('...dealQueries');
    }
    if (newFiles.some(file => file.includes('user-queries'))) {
      exportParts.push('...userQueries');
    }
    if (newFiles.some(file => file.includes('exchange-queries'))) {
      exportParts.push('...exchangeQueries');
    }
    if (newFiles.some(file => file.includes('other-queries'))) {
      exportParts.push('...otherQueries');
    }

    // Ensure we have proper formatting with no trailing commas
    const formattedExportParts = exportParts.join(',\n  ');
    const combinedExport = `\nconst GraphQlQuery = {\n  ${formattedExportParts}\n};\n\nexport default GraphQlQuery;\n`;

    return `${imports}\n${combinedExport}`;
  }

  private createTypesIndexFile(newFiles: string[]): string {
    const exports = newFiles
      .filter((file) => !file.includes('index'))
      .map((file) => {
        const fileName = path.basename(file, '.ts');
        return `export * from './${fileName}';`;
      })
      .join('\n');

    return `${exports}\n`;
  }

  private createGenericIndexFile(baseName: string, newFiles: string[]): string {
    const exports = newFiles
      .filter((file) => !file.includes('index'))
      .map((file) => {
        const fileName = path.basename(file, '.ts');
        return `export * from './${fileName}';`;
      })
      .join('\n');

    return `${exports}\n`;
  }

  private async verifyRefactoring(
    originalFile: string,
    newFiles: string[]
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if all new files exist
      for (const file of newFiles) {
        if (!(await fs.pathExists(file))) {
          return {
            success: false,
            error: `Created file does not exist: ${file}`,
          };
        }
      }

      // Check if new files have content
      for (const file of newFiles) {
        const content = await fs.readFile(file, 'utf8');
        if (content.trim().length === 0) {
          return { success: false, error: `Created file is empty: ${file}` };
        }
      }

      // Basic syntax validation (check for balanced braces)
      for (const file of newFiles) {
        const content = await fs.readFile(file, 'utf8');
        const openBraces = (content.match(/{/g) || []).length;
        const closeBraces = (content.match(/}/g) || []).length;
        if (openBraces !== closeBraces) {
          return {
            success: false,
            error: `Syntax error in file: ${file} - unbalanced braces`,
          };
        }
      }

      logger.debug(`Verification successful for ${newFiles.length} files`);
      return { success: true };
    } catch (error) {
      return { success: false, error: `Verification failed: ${error}` };
    }
  }

  private async rollbackRefactoring(
    originalFile: string,
    createdFiles: string[],
    backupPath: string
  ): Promise<void> {
    logger.warning(`Rolling back refactoring for ${originalFile}`);

    try {
      // Remove created files
      for (const file of createdFiles) {
        if (await fs.pathExists(file)) {
          await fs.remove(file);
          logger.debug(`Removed created file: ${file}`);
        }
      }

      // Restore original file from backup
      if (await fs.pathExists(backupPath)) {
        await fs.copy(backupPath, originalFile);
        logger.debug(`Restored original file from backup: ${backupPath}`);
      }

      logger.success('Rollback completed successfully');
    } catch (error) {
      logger.error(`Rollback failed: ${error}`);
      throw error;
    }
  }

  private async createBackup(filePath: string): Promise<string> {
    const backupDir = path.join(this.projectRoot, '.refactor-backups');
    await ensureDirectoryExists(backupDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = path.basename(filePath);
    const backupName = `${fileName}-${timestamp}.backup`;
    const backupPath = path.join(backupDir, backupName);

    await fs.copy(filePath, backupPath);
    logger.debug(`Created backup: ${backupPath}`);
    return backupPath;
  }

  private async refactorFile(file: FileToRefactor): Promise<RefactorResult> {
    logger.progress(`Analyzing ${file.path}...`);

    const content = await fs.readFile(file.path, 'utf8');
    const suggestions = await this.analyzeFile(file.path, content);

    // Perform actual refactoring
    try {
      const result = await this.performRefactoring(
        file.path,
        content,
        suggestions
      );
      return result;
    } catch (error) {
      return {
        originalFile: file.path,
        newFiles: [],
        linesReduced: 0,
        success: false,
        error: String(error),
      };
    }
  }

  private async performRefactoring(
    filePath: string,
    content: string,
    suggestions: {
      suggestedFiles: string[];
      estimatedReduction: number;
      analysis: string[];
    }
  ): Promise<RefactorResult> {
    logger.progress(`Refactoring ${filePath}...`);

    const createdFiles: string[] = [];
    const backupPath = await this.createBackup(filePath);

    try {
      // Analyze file type and perform appropriate refactoring
      if (filePath.includes('GraphQLQueries') || filePath.includes('GraphQL')) {
        const result = await this.refactorGraphQLFile(filePath, content);
        createdFiles.push(...result.newFiles);
      } else if (filePath.includes('types') && filePath.includes('index.ts')) {
        const result = await this.refactorTypesFile(filePath, content);
        createdFiles.push(...result.newFiles);
      } else {
        // Generic refactoring
        const result = await this.refactorGenericFile(filePath, content);
        createdFiles.push(...result.newFiles);
      }

      // Verify refactoring worked
      const verificationResult = await this.verifyRefactoring(
        filePath,
        createdFiles
      );
      if (!verificationResult.success) {
        // Rollback if verification failed
        await this.rollbackRefactoring(filePath, createdFiles, backupPath);
        return {
          originalFile: filePath,
          newFiles: [],
          linesReduced: 0,
          success: false,
          error: verificationResult.error,
        };
      }

      logger.success(`✅ Successfully refactored ${path.basename(filePath)}`);
      return {
        originalFile: filePath,
        newFiles: createdFiles,
        linesReduced: suggestions.estimatedReduction,
        success: true,
      };
    } catch (error) {
      // Rollback on error
      await this.rollbackRefactoring(filePath, createdFiles, backupPath);
      throw error;
    }
  }

  private async refactorGraphQLFile(
    filePath: string,
    content: string
  ): Promise<{ newFiles: string[] }> {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.ts');
    const lines = content.split('\n');
    const newFiles: string[] = [];

    // Extract imports more carefully - look for the entire import block
    const importLines: string[] = [];
    let inImport = false;
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim().startsWith('import')) {
        inImport = true;
        importLines.push(line);

        // Count braces to handle multi-line imports
        braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      } else if (inImport) {
        importLines.push(line);
        braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

        // If we've closed all braces and hit a semicolon, we're done with this import
        if (braceCount <= 0 && line.includes(';')) {
          inImport = false;
          braceCount = 0;
        }
      } else if (importLines.length > 0 && !line.trim().startsWith('import')) {
        // We've moved past all imports
        break;
      }
    }

    const allImportedTypes = this.extractImportedTypes(importLines);
    const typeImportSource = '../types'; // Default type import source

    // Extract fragments first
    const fragmentsContent = this.extractFragments(content);
    let fragmentNames: string[] = [];

    if (fragmentsContent.length > 0) {
      const fragmentsFile = path.join(dir, `${baseName}-fragments.ts`);
      fragmentNames = this.extractFragmentNames(fragmentsContent);

      // Only include types used in fragments
      const usedTypesInFragments = this.filterUsedTypes(allImportedTypes, fragmentsContent.join('\n'));
      const fragmentTypeImports = this.createTypeImports(usedTypesInFragments, typeImportSource);

      // Clean up fragments to avoid duplicate exports
      const cleanedFragments = fragmentsContent.map(fragment => {
        // Remove export keyword from individual fragments since we'll export them all at the end
        return fragment.replace(/^export\s+/, '');
      });

      const fragmentsFileContent = `${fragmentTypeImports}\n\n${cleanedFragments.join('\n\n')}\n\n// Export all fragments\nexport {\n  ${fragmentNames.join(',\n  ')}\n};\n`;
      await fs.writeFile(fragmentsFile, fragmentsFileContent);
      newFiles.push(fragmentsFile);
      logger.debug(`Created fragments file: ${fragmentsFile}`);
    }

    // Extract bot-related queries
    const botQueries = this.extractQueriesByPattern(
      content,
      /bot|dca|grid|combo|hedge/i
    );
    if (botQueries.length > 0) {
      const botFile = path.join(dir, `${baseName}-bot-queries.ts`);
      const botQueriesContent = this.joinQueries(botQueries);
      const usedFragments = this.extractUsedFragments(botQueriesContent);
      const usedTypes = this.filterUsedTypes(allImportedTypes, botQueriesContent);

      const typeImports = this.createTypeImports(usedTypes, typeImportSource);
      const fragmentImports = usedFragments.length > 0
        ? `import {\n  ${usedFragments.join(',\n  ')}\n} from './${baseName}-fragments';\n`
        : '';

      const botFileContent = `${typeImports}${fragmentImports ? '\n' + fragmentImports : ''}\n\nexport const botQueries = {\n${botQueriesContent}\n};\n`;
      await fs.writeFile(botFile, botFileContent);
      newFiles.push(botFile);
      logger.debug(`Created bot queries file: ${botFile}`);
    }

    // Extract deal-related queries
    const dealQueries = this.extractQueriesByPattern(content, /deal/i);
    if (dealQueries.length > 0) {
      const dealFile = path.join(dir, `${baseName}-deal-queries.ts`);
      const dealQueriesContent = this.joinQueries(dealQueries);
      const usedFragments = this.extractUsedFragments(dealQueriesContent);
      const usedTypes = this.filterUsedTypes(allImportedTypes, dealQueriesContent);

      const typeImports = this.createTypeImports(usedTypes, typeImportSource);
      const fragmentImports = usedFragments.length > 0
        ? `import {\n  ${usedFragments.join(',\n  ')}\n} from './${baseName}-fragments';\n`
        : '';

      const dealFileContent = `${typeImports}${fragmentImports ? '\n' + fragmentImports : ''}\n\nexport const dealQueries = {\n${dealQueriesContent}\n};\n`;
      await fs.writeFile(dealFile, dealFileContent);
      newFiles.push(dealFile);
      logger.debug(`Created deal queries file: ${dealFile}`);
    }

    // Extract user-related queries
    const userQueries = this.extractQueriesByPattern(
      content,
      /user|notification|subscription/i
    );
    if (userQueries.length > 0) {
      const userFile = path.join(dir, `${baseName}-user-queries.ts`);
      const userQueriesContent = this.joinQueries(userQueries);
      const usedFragments = this.extractUsedFragments(userQueriesContent);
      const usedTypes = this.filterUsedTypes(allImportedTypes, userQueriesContent);

      const typeImports = this.createTypeImports(usedTypes, typeImportSource);
      const fragmentImports = usedFragments.length > 0
        ? `import {\n  ${usedFragments.join(',\n  ')}\n} from './${baseName}-fragments';\n`
        : '';

      const userFileContent = `${typeImports}${fragmentImports ? '\n' + fragmentImports : ''}\n\nexport const userQueries = {\n${userQueriesContent}\n};\n`;
      await fs.writeFile(userFile, userFileContent);
      newFiles.push(userFile);
      logger.debug(`Created user queries file: ${userFile}`);
    }

    // Extract exchange-related queries
    const exchangeQueries = this.extractQueriesByPattern(content, /exchange/i);
    if (exchangeQueries.length > 0) {
      const exchangeFile = path.join(dir, `${baseName}-exchange-queries.ts`);
      const exchangeQueriesContent = this.joinQueries(exchangeQueries);
      const usedFragments = this.extractUsedFragments(exchangeQueriesContent);
      const usedTypes = this.filterUsedTypes(allImportedTypes, exchangeQueriesContent);

      const typeImports = this.createTypeImports(usedTypes, typeImportSource);
      const fragmentImports = usedFragments.length > 0
        ? `import {\n  ${usedFragments.join(',\n  ')}\n} from './${baseName}-fragments';\n`
        : '';

      const exchangeFileContent = `${typeImports}${fragmentImports ? '\n' + fragmentImports : ''}\n\nexport const exchangeQueries = {\n${exchangeQueriesContent}\n};\n`;
      await fs.writeFile(exchangeFile, exchangeFileContent);
      newFiles.push(exchangeFile);
      logger.debug(`Created exchange queries file: ${exchangeFile}`);
    }

    // Extract remaining queries (those that don't match the above patterns)
    const remainingQueries = this.extractRemainingQueries(content, [
      /bot|dca|grid|combo|hedge/i,
      /deal/i,
      /user|notification|subscription/i,
      /exchange/i
    ]);
    if (remainingQueries.length > 0) {
      const remainingFile = path.join(dir, `${baseName}-other-queries.ts`);
      const remainingQueriesContent = this.joinQueries(remainingQueries);
      const usedFragments = this.extractUsedFragments(remainingQueriesContent);
      const usedTypes = this.filterUsedTypes(allImportedTypes, remainingQueriesContent);

      const typeImports = this.createTypeImports(usedTypes, typeImportSource);
      const fragmentImports = usedFragments.length > 0
        ? `import {\n  ${usedFragments.join(',\n  ')}\n} from './${baseName}-fragments';\n`
        : '';

      const remainingFileContent = `${typeImports}${fragmentImports ? '\n' + fragmentImports : ''}\n\nexport const otherQueries = {\n${remainingQueriesContent}\n};\n`;
      await fs.writeFile(remainingFile, remainingFileContent);
      newFiles.push(remainingFile);
      logger.debug(`Created other queries file: ${remainingFile}`);
    }

    // Create index file that combines all modules
    const indexFile = path.join(dir, `${baseName}-index.ts`);
    const indexContent = this.createGraphQLIndexFile(baseName, newFiles);
    await fs.writeFile(indexFile, indexContent);
    newFiles.push(indexFile);

    // Update original file to use the new modular structure
    const updatedOriginalContent = this.createGraphQLMainFile(
      baseName,
      newFiles
    );
    await fs.writeFile(filePath, updatedOriginalContent);

    return { newFiles };
  }

  private async refactorTypesFile(
    filePath: string,
    content: string
  ): Promise<{ newFiles: string[] }> {
    const dir = path.dirname(filePath);
    const newFiles: string[] = [];

    // Extract common types and enums
    const commonTypes = this.extractCommonTypes(content);
    if (commonTypes.length > 0) {
      const commonFile = path.join(dir, 'common.ts');
      await fs.writeFile(commonFile, commonTypes.join('\n\n'));
      newFiles.push(commonFile);
      logger.debug(`Created common types file: ${commonFile}`);
    }

    // Extract bot-related types
    const botTypes = this.extractTypesByPattern(
      content,
      /bot|dca|grid|combo|hedge/i
    );
    if (botTypes.length > 0) {
      const botFile = path.join(dir, 'bot.ts');
      const botFileContent = `import { ${this.extractCommonTypeNames(commonTypes).join(', ')} } from './common';\n\n${botTypes.join('\n\n')}`;
      await fs.writeFile(botFile, botFileContent);
      newFiles.push(botFile);
      logger.debug(`Created bot types file: ${botFile}`);
    }

    // Extract deal-related types
    const dealTypes = this.extractTypesByPattern(content, /deal/i);
    if (dealTypes.length > 0) {
      const dealFile = path.join(dir, 'deal.ts');
      const dealFileContent = `import { ${this.extractCommonTypeNames(commonTypes).join(', ')} } from './common';\n\n${dealTypes.join('\n\n')}`;
      await fs.writeFile(dealFile, dealFileContent);
      newFiles.push(dealFile);
      logger.debug(`Created deal types file: ${dealFile}`);
    }

    // Extract exchange-related types
    const exchangeTypes = this.extractTypesByPattern(content, /exchange/i);
    if (exchangeTypes.length > 0) {
      const exchangeFile = path.join(dir, 'exchange.ts');
      const exchangeFileContent = `import { ${this.extractCommonTypeNames(commonTypes).join(', ')} } from './common';\n\n${exchangeTypes.join('\n\n')}`;
      await fs.writeFile(exchangeFile, exchangeFileContent);
      newFiles.push(exchangeFile);
      logger.debug(`Created exchange types file: ${exchangeFile}`);
    }

    // Extract user-related types
    const userTypes = this.extractTypesByPattern(content, /user/i);
    if (userTypes.length > 0) {
      const userFile = path.join(dir, 'user.ts');
      const userFileContent = `import { ${this.extractCommonTypeNames(commonTypes).join(', ')} } from './common';\n\n${userTypes.join('\n\n')}`;
      await fs.writeFile(userFile, userFileContent);
      newFiles.push(userFile);
      logger.debug(`Created user types file: ${userFile}`);
    }

    // Extract API-related types
    const apiTypes = this.extractTypesByPattern(
      content,
      /api|input|payload|response/i
    );
    if (apiTypes.length > 0) {
      const apiFile = path.join(dir, 'api.ts');
      const apiFileContent = `import { ${this.extractCommonTypeNames(commonTypes).join(', ')} } from './common';\n\n${apiTypes.join('\n\n')}`;
      await fs.writeFile(apiFile, apiFileContent);
      newFiles.push(apiFile);
      logger.debug(`Created API types file: ${apiFile}`);
    }

    // Create index file that exports all types
    const indexFile = path.join(dir, 'index.ts');
    const indexContent = this.createTypesIndexFile(newFiles);
    await fs.writeFile(indexFile, indexContent);
    newFiles.push(indexFile);

    return { newFiles };
  }

  private async refactorGenericFile(
    filePath: string,
    content: string
  ): Promise<{ newFiles: string[] }> {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const newFiles: string[] = [];

    // Simple splitting by function/class boundaries
    const chunks = this.splitContentIntoChunks(content, this.config.maxLines);

    for (let i = 0; i < chunks.length; i++) {
      const chunkFile = path.join(dir, `${baseName}-part${i + 1}.ts`);
      await fs.writeFile(chunkFile, chunks[i]);
      newFiles.push(chunkFile);
      logger.debug(`Created chunk file: ${chunkFile}`);
    }

    // Create index file
    const indexFile = path.join(dir, `${baseName}-index.ts`);
    const indexContent = this.createGenericIndexFile(baseName, newFiles);
    await fs.writeFile(indexFile, indexContent);
    newFiles.push(indexFile);

    return { newFiles };
  }

  private extractUsedFragments(content: string): string[] {
    // Look for both ${fragmentName} and plain fragmentName usage
    const fragmentMatches1 = content.match(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
    const fragmentMatches2 = content.match(/\b([a-zA-Z_][a-zA-Z0-9_]*Fragment)\b/g);

    const allMatches = [];

    if (fragmentMatches1) {
      allMatches.push(...fragmentMatches1.map(match => match.slice(2, -1))); // Remove ${ and }
    }

    if (fragmentMatches2) {
      allMatches.push(...fragmentMatches2);
    }

    const fragmentNames = [...new Set(allMatches)]; // Remove duplicates
    return fragmentNames;
  }

  private extractUsedTypes(content: string): string[] {
    const typeMatches = content.match(/:\s*([A-Z][a-zA-Z0-9_]*)/g);
    if (!typeMatches) return [];

    const types = typeMatches.map(match => match.slice(2)); // Remove ': '
    return [...new Set(types)]; // Remove duplicates
  }

  private extractImportedTypes(importLines: string[]): string[] {
    const typeNames: string[] = [];
    const importContent = importLines.join('\n');

    // Extract all imported type names from import statements
    const importMatches = importContent.match(/import\s+type\s*\{([^}]+)\}/g);
    if (importMatches) {
      for (const match of importMatches) {
        const typesString = match.replace(/import\s+type\s*\{/, '').replace(/\}/, '');
        const types = typesString.split(',').map(t => t.trim()).filter(t => t);
        typeNames.push(...types);
      }
    }

    // Also extract regular imports that might be types
    const regularImports = importContent.match(/import\s*\{([^}]+)\}/g);
    if (regularImports) {
      for (const match of regularImports) {
        const typesString = match.replace(/import\s*\{/, '').replace(/\}/, '');
        const types = typesString.split(',').map(t => t.trim()).filter(t => t);
        typeNames.push(...types);
      }
    }

    return [...new Set(typeNames)]; // Remove duplicates
  }

  private filterUsedTypes(allTypes: string[], contentToAnalyze: string): string[] {
    const usedTypes: string[] = [];

    for (const type of allTypes) {
      // Check if type is used in the content
      const typeRegex = new RegExp(`\\b${type}\\b`, 'g');
      if (typeRegex.test(contentToAnalyze)) {
        usedTypes.push(type);
      }
    }

    return usedTypes;
  }

  private createTypeImports(usedTypes: string[], sourcePath: string): string {
    if (usedTypes.length === 0) return '';

    // Adjust path for API directory to types directory
    const actualSourcePath = sourcePath === '../types' ? '../../types' : sourcePath;

    // Group imports by their likely source
    const typeImports: string[] = [];

    if (usedTypes.length > 0) {
      const sortedTypes = usedTypes.sort();
      typeImports.push(`import type {\n  ${sortedTypes.join(',\n  ')}\n} from '${actualSourcePath}';`);
    }

    return typeImports.join('\n');
  }

  private cleanupQueriesArray(queries: string[]): string[] {
    return queries.map(query => {
      // Remove trailing commas from individual queries
      let cleanQuery = query.trim();
      if (cleanQuery.endsWith(',')) {
        cleanQuery = cleanQuery.slice(0, -1);
      }
      return cleanQuery;
    });
  }

  private joinQueries(queries: string[]): string {
    const cleanQueries = this.cleanupQueriesArray(queries);
    return cleanQueries.join(',\n\n');
  }

  private async analyzeFile(
    filePath: string,
    content: string
  ): Promise<{
    suggestedFiles: string[];
    estimatedReduction: number;
    analysis: string[];
  }> {
    const analysis: string[] = [];
    const suggestedFiles: string[] = [];
    const lines = content.split('\n');

    analysis.push(`📊 File Analysis for ${path.basename(filePath)}`);
    analysis.push(`   Total lines: ${lines.length}`);

    // Analyze based on file type and content
    if (filePath.includes('GraphQLQueries') || filePath.includes('GraphQL')) {
      return this.analyzeGraphQLFile(filePath, content, lines);
    }

    if (filePath.includes('types') && filePath.includes('index.ts')) {
      return this.analyzeTypesFile(filePath, content, lines);
    }

    // Generic analysis
    const imports = lines.filter((line) => line.trim().startsWith('import'));
    const exports = lines.filter((line) => line.trim().startsWith('export'));
    const functions = lines.filter(
      (line) =>
        line.includes('function ') ||
        (line.includes('const ') && line.includes('=>')) ||
        line.includes('class ')
    );

    analysis.push(`   Imports: ${imports.length}`);
    analysis.push(`   Exports: ${exports.length}`);
    analysis.push(`   Functions/Constants: ${functions.length}`);

    // Suggest splitting by functionality
    const functionsPerFile = Math.ceil(functions.length / 3);
    const estimatedFiles = Math.min(
      Math.ceil(functions.length / functionsPerFile),
      5
    );

    for (let i = 0; i < estimatedFiles; i++) {
      const baseName = path.basename(filePath, path.extname(filePath));
      const dir = path.dirname(filePath);
      suggestedFiles.push(`${dir}/${baseName}-part${i + 1}.ts`);
    }

    analysis.push(`💡 Suggested approach: Split into ${estimatedFiles} files`);
    analysis.push(
      `   Each file would have ~${Math.ceil(lines.length / estimatedFiles)} lines`
    );

    return {
      suggestedFiles,
      estimatedReduction: lines.length * 0.7, // Estimate 70% reduction due to modularity
      analysis,
    };
  }

  private async analyzeGraphQLFile(
    filePath: string,
    content: string,
    lines: string[]
  ): Promise<{
    suggestedFiles: string[];
    estimatedReduction: number;
    analysis: string[];
  }> {
    const analysis: string[] = [];
    const suggestedFiles: string[] = [];

    analysis.push(`📊 GraphQL File Analysis for ${path.basename(filePath)}`);
    analysis.push(`   Total lines: ${lines.length}`);

    // Count different types of operations
    const queries = (content.match(/query\s+\w+/g) || []).length;
    const mutations = (content.match(/mutation\s+\w+/g) || []).length;
    const fragments = (content.match(/const\s+\w+Fragment/g) || []).length;
    const subscriptions = (content.match(/subscription\s+\w+/g) || []).length;

    analysis.push(`   Queries: ${queries}`);
    analysis.push(`   Mutations: ${mutations}`);
    analysis.push(`   Fragments: ${fragments}`);
    analysis.push(`   Subscriptions: ${subscriptions}`);

    // Analyze query categories
    const botQueries = (content.match(/bot\w*(?:Query|List|Stats)/gi) || [])
      .length;
    const dealQueries = (content.match(/deal\w*(?:Query|List|Stats)/gi) || [])
      .length;
    const exchangeQueries = (
      content.match(/exchange\w*(?:Query|List|Stats)/gi) || []
    ).length;
    const userQueries = (content.match(/user\w*(?:Query|List|Stats)/gi) || [])
      .length;

    analysis.push(`   Bot-related: ${botQueries}`);
    analysis.push(`   Deal-related: ${dealQueries}`);
    analysis.push(`   Exchange-related: ${exchangeQueries}`);
    analysis.push(`   User-related: ${userQueries}`);

    // Suggest file structure
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.ts');

    // Create suggested file structure
    const categories = [
      { name: 'fragments', count: fragments, suffix: 'fragments' },
      { name: 'bot-queries', count: botQueries, suffix: 'bot-queries' },
      { name: 'deal-queries', count: dealQueries, suffix: 'deal-queries' },
      {
        name: 'exchange-queries',
        count: exchangeQueries,
        suffix: 'exchange-queries',
      },
      { name: 'user-queries', count: userQueries, suffix: 'user-queries' },
      {
        name: 'subscription-queries',
        count: 0,
        suffix: 'subscription-queries',
      },
      { name: 'index', count: 0, suffix: 'index' },
    ];

    categories.forEach((category) => {
      if (category.count > 0 || category.name === 'index') {
        suggestedFiles.push(`${dir}/${baseName}-${category.suffix}.ts`);
      }
    });

    analysis.push(
      `💡 Suggested approach: Split into ${suggestedFiles.length} domain-specific files`
    );
    analysis.push(`   📁 ${baseName}-fragments.ts - Shared GraphQL fragments`);
    analysis.push(
      `   📁 ${baseName}-bot-queries.ts - Bot-related queries & mutations`
    );
    analysis.push(
      `   📁 ${baseName}-deal-queries.ts - Deal-related queries & mutations`
    );
    analysis.push(
      `   📁 ${baseName}-exchange-queries.ts - Exchange-related queries & mutations`
    );
    analysis.push(
      `   📁 ${baseName}-user-queries.ts - User-related queries & mutations`
    );
    analysis.push(
      `   📁 ${baseName}-subscription-queries.ts - Subscription-related queries`
    );
    analysis.push(
      `   📁 ${baseName}-index.ts - Main export combining all modules`
    );

    const estimatedReduction = lines.length * 0.8; // 80% reduction due to better organization

    return {
      suggestedFiles,
      estimatedReduction,
      analysis,
    };
  }

  private async analyzeTypesFile(
    filePath: string,
    content: string,
    lines: string[]
  ): Promise<{
    suggestedFiles: string[];
    estimatedReduction: number;
    analysis: string[];
  }> {
    const analysis: string[] = [];
    const suggestedFiles: string[] = [];

    analysis.push(`📊 Types File Analysis for ${path.basename(filePath)}`);
    analysis.push(`   Total lines: ${lines.length}`);

    // Count different types of type definitions
    const interfaces = (content.match(/interface\s+\w+/g) || []).length;
    const types = (content.match(/type\s+\w+/g) || []).length;
    const enums = (content.match(/enum\s+\w+/g) || []).length;
    const imports = (content.match(/import.*from/g) || []).length;

    analysis.push(`   Interfaces: ${interfaces}`);
    analysis.push(`   Type aliases: ${types}`);
    analysis.push(`   Enums: ${enums}`);
    analysis.push(`   Imports: ${imports}`);

    // Analyze type categories
    const botTypes = (
      content.match(
        /\b(?:Bot|DCA|GRID|Combo|Hedge)\w*(?:Type|Interface|Enum)/gi
      ) || []
    ).length;
    const dealTypes = (
      content.match(/\bDeal\w*(?:Type|Interface|Enum)/gi) || []
    ).length;
    const exchangeTypes = (
      content.match(/\bExchange\w*(?:Type|Interface|Enum)/gi) || []
    ).length;
    const userTypes = (
      content.match(/\bUser\w*(?:Type|Interface|Enum)/gi) || []
    ).length;

    analysis.push(`   Bot-related types: ${botTypes}`);
    analysis.push(`   Deal-related types: ${dealTypes}`);
    analysis.push(`   Exchange-related types: ${exchangeTypes}`);
    analysis.push(`   User-related types: ${userTypes}`);

    // Suggest file structure
    const dir = path.dirname(filePath);

    const categories = [
      { name: 'common', suffix: 'common' },
      { name: 'bot', suffix: 'bot' },
      { name: 'deal', suffix: 'deal' },
      { name: 'exchange', suffix: 'exchange' },
      { name: 'user', suffix: 'user' },
      { name: 'api', suffix: 'api' },
      { name: 'index', suffix: 'index' },
    ];

    categories.forEach((category) => {
      suggestedFiles.push(`${dir}/${category.suffix}.ts`);
    });

    analysis.push(
      `💡 Suggested approach: Split into ${suggestedFiles.length} domain-specific type files`
    );
    analysis.push(`   📁 common.ts - Common types, enums, and utilities`);
    analysis.push(`   📁 bot.ts - Bot-related types and interfaces`);
    analysis.push(`   📁 deal.ts - Deal-related types and interfaces`);
    analysis.push(`   📁 exchange.ts - Exchange-related types and interfaces`);
    analysis.push(`   📁 user.ts - User-related types and interfaces`);
    analysis.push(`   📁 api.ts - API-related types and interfaces`);
    analysis.push(`   📁 index.ts - Main export combining all type modules`);

    const estimatedReduction = lines.length * 0.75; // 75% reduction due to better organization

    return {
      suggestedFiles,
      estimatedReduction,
      analysis,
    };
  }

  private extractFragmentNames(fragmentsContent: string[]): string[] {
    const names: string[] = [];
    for (const fragment of fragmentsContent) {
      const match = fragment.match(/(?:export\s+)?const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/m);
      if (match) {
        names.push(match[1]);
      }
    }
    return names;
  }
}
