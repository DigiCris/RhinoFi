'use strict';

const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

async function confirmStep(message) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('\n' + message);
    const answer = await rl.question('Press Enter to continue, or type q/quit/exit to abort: ');
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === 'q' || trimmed === 'quit' || trimmed === 'exit') {
      console.log('Aborted by user.');
      process.exit(0);
    }
  } finally {
    rl.close();
  }
}

module.exports = { confirmStep };
