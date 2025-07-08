import chalk from 'chalk';

export class Logger {
  private verbose: boolean = false;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  info(message: string): void {
    console.log(chalk.blue('ℹ️ '), message);
  }

  success(message: string): void {
    console.log(chalk.green('✅'), message);
  }

  warning(message: string): void {
    console.log(chalk.yellow('⚠️ '), message);
  }

  error(message: string): void {
    console.log(chalk.red('❌'), message);
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(chalk.gray('🔍'), message);
    }
  }

  progress(message: string): void {
    console.log(chalk.cyan('🔄'), message);
  }

  header(message: string): void {
    console.log('\n' + chalk.bold.blue('🚀 ' + message) + '\n');
  }

  section(title: string): void {
    console.log('\n' + chalk.bold(title));
  }

  listItem(item: string, checked: boolean = false): void {
    const symbol = checked ? '✅' : '•';
    console.log(`  ${symbol} ${item}`);
  }

  table(data: Array<{ [key: string]: string }>): void {
    if (data.length === 0) return;

    const keys = Object.keys(data[0]);
    const columnWidths = keys.map(key => 
      Math.max(key.length, ...data.map(row => String(row[key]).length))
    );

    // Header
    const header = keys.map((key, i) => key.padEnd(columnWidths[i])).join(' | ');
    console.log(chalk.bold(header));
    console.log(keys.map((_, i) => '-'.repeat(columnWidths[i])).join(' | '));

    // Rows
    data.forEach(row => {
      const rowStr = keys.map((key, i) => 
        String(row[key]).padEnd(columnWidths[i])
      ).join(' | ');
      console.log(rowStr);
    });
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }
}

export const logger = new Logger();