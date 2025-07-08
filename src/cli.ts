#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import { AutoRefactor, RefactorResult } from './refactor';
import { logger } from './utils/logger';

const program = new Command();

program
  .name('auto-refactor')
  .description(
    'Intelligent code refactoring and context compression for AI-assisted development'
  )
  .version('1.0.0');

program
  .command('init')
  .description('Initialize auto-refactor in the current project')
  .option(
    '-f, --framework <framework>',
    'Target framework (react, nextjs, vue, svelte)'
  )
  .option('-y, --yes', 'Skip interactive prompts')
  .action(async (options) => {
    try {
      const refactor = new AutoRefactor();
      await refactor.init(options);
      logger.success('Auto-refactor initialized successfully!');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Initialization failed: ${message}`);
      process.exit(1);
    }
  });

program
  .command('scan')
  .description('Analyze codebase for files that need refactoring')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      const refactor = new AutoRefactor(options.config);
      if (options.verbose) logger.setVerbose(true);

      const results = await refactor.scan();
      logger.success(
        `Scan complete. Found ${results.length} files that need refactoring.`
      );

      if (results.length > 0) {
        logger.section('Files to refactor:');
        results.forEach((file) => {
          logger.listItem(`${file.path} (${file.lines} lines)`);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Scan failed: ${message}`);
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Execute refactoring')
  .option('-c, --config <path>', 'Path to config file')
  .option('--dry', 'Dry run - show what would be changed')
  .option('--no-backup', 'Skip creating backups')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      const refactor = new AutoRefactor(options.config);
      if (options.verbose) logger.setVerbose(true);

      const results = await refactor.run({
        dryRun: options.dry,
        createBackups: options.backup !== false,
        verbose: options.verbose,
      });

      if (options.dry) {
        logger.section('Refactoring Analysis Results:');
        results.forEach((result: RefactorResult) => {
          if (result.analysis) {
            result.analysis.forEach((line: string) => logger.info(line));
            logger.info(`📁 Suggested files: ${result.newFiles.length}`);
            result.newFiles.forEach((file: string) =>
              logger.listItem(path.basename(file))
            );
            logger.info(
              `📉 Estimated line reduction: ${Math.round(result.linesReduced)}`
            );
            logger.info(''); // Empty line for spacing
          }
        });
      }

      logger.success(
        `Refactoring complete. Processed ${results.length} files.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Refactoring failed: ${message}`);
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Monitor files for changes and auto-refactor')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      const refactor = new AutoRefactor(options.config);
      if (options.verbose) logger.setVerbose(true);

      logger.info('Starting watch mode...');
      await refactor.watch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Watch mode failed: ${message}`);
      process.exit(1);
    }
  });

program
  .command('compress')
  .description('Compress context files for AI token optimization')
  .argument('[file]', 'Specific file to compress')
  .option('-w, --watch', 'Watch context files continuously')
  .option(
    '--max-tokens <number>',
    'Maximum tokens per file (default: 4000)',
    '4000'
  )
  .option('-o, --output <path>', 'Output file path')
  .action(async (file, options) => {
    try {
      const refactor = new AutoRefactor();
      await refactor.compress(file, {
        watch: options.watch,
        maxTokens: parseInt(options.maxTokens),
        output: options.output,
      });
      logger.success('Context compression complete!');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Compression failed: ${message}`);
      process.exit(1);
    }
  });

program.parse();
